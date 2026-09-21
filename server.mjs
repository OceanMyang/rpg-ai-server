import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/env.mjs';
import { createGameStore } from './src/game-store.mjs';
import { runHostTurn } from './src/host.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
await loadEnv(path.join(ROOT, '.env'));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const MODEL = process.env.RPG_MODEL || 'inclusionai/ling-3.0-flash-vl:free';
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.API_KEY || '';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const ACCESS_TOKEN = ACCESS_PASSWORD
  ? createHash('sha256').update(`rpg-ai:${ACCESS_PASSWORD}`).digest('hex')
  : '';
const MAX_BODY_BYTES = 16 * 1024;
const TURN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

// Refuse to expose an unprotected game to the network.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
if (!LOOPBACK.has(HOST) && !ACCESS_PASSWORD) {
  throw new Error(
    `Refusing to listen on ${HOST} without a password. Set ACCESS_PASSWORD in .env, or bind to 127.0.0.1.`
  );
}

const basePrompt = [
  await readFile(path.join(ROOT, 'system_prompt.md'), 'utf8'),
  await readFile(path.join(ROOT, 'host_rules.md'), 'utf8')
].map((part) => part.trim()).join('\n\n---\n\n');
const store = createGameStore({
  saveRoot: path.join(ROOT, 'saves'),
  templateRoot: ROOT
});

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);

function tokenMatches(candidate) {
  if (typeof candidate !== 'string' || candidate.length !== ACCESS_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(ACCESS_TOKEN, 'utf8'));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function headers(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, headers('application/json; charset=utf-8'));
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function publicSession(session) {
  return {
    id: session.id,
    status: session.status,
    messages: session.messages
  };
}

async function playTurn(gameId, action, turnId) {
  return store.withGameLock(gameId, async () => {
    const session = await store.loadGame(gameId);
    const actionHash = createHash('sha256').update(action, 'utf8').digest('hex');
    const completed = session.completedTurns?.[turnId];
    if (completed) {
      if (completed.actionHash !== actionHash) {
        throw new HttpError(409, 'That turn id belongs to a different action.');
      }
      return completed.result;
    }
    const stagingDir = await store.beginTurn(gameId);
    try {
      const history = [...session.messages, { role: 'user', content: action }];
      const narration = await runHostTurn({
        apiKey: API_KEY,
        model: MODEL,
        basePrompt,
        worldDir: stagingDir,
        publicHistory: history,
        turnId
      });
      const result = { narration, status: 'playing' };
      session.messages = [...history, { role: 'assistant', content: narration }];
      session.status = result.status;
      session.updatedAt = new Date().toISOString();
      session.completedTurns ??= {};
      session.completedTurns[turnId] = { actionHash, result };
      const turnIds = Object.keys(session.completedTurns);
      for (const oldId of turnIds.slice(0, Math.max(0, turnIds.length - 24))) {
        delete session.completedTurns[oldId];
      }
      await store.commitTurn(gameId, stagingDir, session);
      return result;
    } catch (error) {
      await store.discardTurn(stagingDir).catch(() => {});
      throw error;
    }
  });
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, {
      configured: Boolean(API_KEY),
      model: MODEL,
      requiresPassword: Boolean(ACCESS_TOKEN)
    });
    return;
  }
  if (ACCESS_TOKEN) {
    if (request.method === 'POST' && url.pathname === '/api/session') {
      const body = await readJson(request);
      const password = typeof body.password === 'string' ? body.password : '';
      const candidate = createHash('sha256').update(`rpg-ai:${password}`).digest('hex');
      // A wrong password costs a second, which makes guessing over the network impractical.
      if (!tokenMatches(candidate)) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        throw new HttpError(401, 'Wrong password.');
      }
      sendJson(response, 200, { token: ACCESS_TOKEN });
      return;
    }
    if (!tokenMatches(request.headers['x-access-token'])) {
      throw new HttpError(401, 'This game is password-protected.');
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/games') {
    const session = await store.createGame();
    sendJson(response, 201, publicSession(session));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/games/current') {
    const session = await store.loadCurrentGame();
    sendJson(response, 200, publicSession(session));
    return;
  }

  const gameMatch = /^\/api\/games\/([0-9a-f-]+)$/u.exec(url.pathname);
  if (request.method === 'GET' && gameMatch) {
    const session = await store.withGameLock(gameMatch[1], async () => {
      const loaded = await store.loadGame(gameMatch[1]);
      await store.setActiveGame(loaded.id);
      return loaded;
    });
    sendJson(response, 200, publicSession(session));
    return;
  }

  const messageMatch = /^\/api\/games\/([0-9a-f-]+)\/messages$/u.exec(url.pathname);
  if (request.method === 'POST' && messageMatch) {
    if (!API_KEY) throw new HttpError(503, 'The RPG host is not configured yet.');
    const body = await readJson(request);
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    if (!action || action.length > 2_000) {
      throw new HttpError(400, 'Enter an action between 1 and 2000 characters.');
    }
    if (typeof body.turnId !== 'string' || !TURN_ID_PATTERN.test(body.turnId)) {
      throw new HttpError(400, 'Turn id is invalid.');
    }
    const result = await playTurn(messageMatch[1], action, body.turnId);
    sendJson(response, 200, result);
    return;
  }

  throw new HttpError(404, 'Not found.');
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    const staticEntry = staticFiles.get(url.pathname);
    if (!staticEntry || request.method !== 'GET') throw new HttpError(404, 'Not found.');
    const [fileName, contentType] = staticEntry;
    const content = await readFile(path.join(ROOT, 'public', fileName));
    response.writeHead(200, {
      ...headers(contentType),
      'Cache-Control': 'public, max-age=300'
    });
    response.end(content);
  } catch (error) {
    const status = error.status || (error.code === 'NOT_FOUND' ? 404 : 500);
    if (status >= 500) console.error(error);
    sendJson(response, status, {
      error: status >= 500 && error.expose !== true && error.status === undefined
        ? 'The RPG host could not complete that request.'
        : error.message,
      retryable: error.retryable === true
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RPG AI is running at http://${HOST}:${PORT}`);
  console.log(API_KEY ? `Model: ${MODEL}` : 'Model unavailable: add API_KEY to .env');
  console.log(ACCESS_TOKEN ? 'Access: password required' : 'Access: open (set ACCESS_PASSWORD to require one)');
});
