import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { copyWorld, listWorldFiles, readWorldFile } from './world-files.mjs';

const GAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAVE_FORMAT = 2;
const TEMPLATE_FOLDERS = ['game', 'world'];
const PLAYER_FOLDER = 'world/player/';
const locks = new Map();

function assertGameId(gameId) {
  if (typeof gameId !== 'string' || !GAME_ID_PATTERN.test(gameId)) {
    const error = new Error('Game not found.');
    error.code = 'NOT_FOUND';
    throw error;
  }
}

async function atomicJsonWrite(filePath, value) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function openingMessage(filesDir) {
  const players = (await listWorldFiles(filesDir))
    .filter((file) => file.path.startsWith(PLAYER_FOLDER) && !file.path.slice(PLAYER_FOLDER.length).includes('/'));
  if (players.length === 0) {
    return 'A new story begins.\n\nSend any message to begin, and a character will be chosen for you at random.';
  }
  const choices = [];
  for (const [index, file] of players.entries()) {
    const name = file.path.slice(PLAYER_FOLDER.length, -'.md'.length);
    const { content } = await readWorldFile(filesDir, file.path);
    const concept = /^\s*-\s*\*\*Concept:\*\*\s*(.+?)\s*$/imu.exec(content)?.[1];
    choices.push(`${index + 1}. ${name}${concept ? ` — ${concept}` : ''}`);
  }
  return `A new story begins. Choose your character:\n\n${choices.join('\n')}\n\nReply with a name or number to begin.`;
}

export function createGameStore({ saveRoot, templateRoot }) {
  const activeFile = path.join(saveRoot, 'active-game.json');

  const pathsFor = (gameId) => {
    assertGameId(gameId);
    const gameDir = path.join(saveRoot, gameId);
    return {
      gameDir,
      filesDir: path.join(gameDir, 'files'),
      sessionFile: path.join(gameDir, 'session.json'),
      commitFile: path.join(gameDir, '.commit.json')
    };
  };

  async function exists(filePath) {
    try {
      await readFile(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        if (error.code === 'EISDIR') return true;
        return false;
      }
      throw error;
    }
  }

  async function recoverGame(gameId) {
    const { gameDir, filesDir, sessionFile, commitFile } = pathsFor(gameId);
    let transaction;
    try {
      transaction = JSON.parse(await readFile(commitFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const validName = (name, prefix, suffix = '') => (
      typeof name === 'string'
      && name.startsWith(prefix)
      && name.endsWith(suffix)
      && !name.includes('/')
      && !name.includes('\\')
    );
    if (
      transaction?.version !== 1
      || !validName(transaction.staging, '.turn-')
      || !validName(transaction.backup, '.previous-')
      || !validName(transaction.nextSession, '.session-next-', '.json')
    ) {
      throw new Error('Invalid commit journal.');
    }

    const stagingDir = path.join(gameDir, transaction.staging);
    const backupDir = path.join(gameDir, transaction.backup);
    const nextSessionFile = path.join(gameDir, transaction.nextSession);
    const worldExists = await exists(filesDir);
    const backupExists = await exists(backupDir);
    const nextSessionExists = await exists(nextSessionFile);

    if (worldExists && backupExists) {
      if (nextSessionExists) await rename(nextSessionFile, sessionFile);
      await rm(backupDir, { recursive: true, force: true });
    } else if (!worldExists && backupExists) {
      await rename(backupDir, filesDir);
      await rm(stagingDir, { recursive: true, force: true });
      await rm(nextSessionFile, { force: true });
    } else if (worldExists && !backupExists) {
      await rm(stagingDir, { recursive: true, force: true });
      await rm(nextSessionFile, { force: true });
    } else {
      throw new Error('The game save could not recover its world.');
    }
    await rm(commitFile, { force: true });
  }

  async function setActiveGame(gameId) {
    assertGameId(gameId);
    await mkdir(saveRoot, { recursive: true, mode: 0o700 });
    await atomicJsonWrite(activeFile, {
      gameId,
      updatedAt: new Date().toISOString()
    });
  }

  async function createGame() {
    await mkdir(saveRoot, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const { gameDir, filesDir, sessionFile } = pathsFor(id);
    await mkdir(gameDir, { mode: 0o700 });
    await mkdir(filesDir, { mode: 0o700 });
    for (const folder of TEMPLATE_FOLDERS) {
      await copyWorld(path.join(templateRoot, folder), path.join(filesDir, folder));
    }
    const opening = await openingMessage(filesDir);
    const now = new Date().toISOString();
    const session = {
      id,
      format: SAVE_FORMAT,
      status: 'playing',
      createdAt: now,
      updatedAt: now,
      messages: [{ role: 'assistant', content: opening }],
      completedTurns: {}
    };
    await atomicJsonWrite(sessionFile, session);
    await setActiveGame(id);
    return session;
  }

  async function loadGame(gameId) {
    await recoverGame(gameId);
    const { sessionFile } = pathsFor(gameId);
    try {
      const raw = await readFile(sessionFile, 'utf8');
      const session = JSON.parse(raw);
      if (session.id !== gameId || !Array.isArray(session.messages)) {
        throw new Error('Invalid save data.');
      }
      if (session.format !== SAVE_FORMAT) {
        const outdated = new Error('Game not found.');
        outdated.code = 'NOT_FOUND';
        throw outdated;
      }
      return session;
    } catch (error) {
      if (error.code === 'ENOENT') {
        const notFound = new Error('Game not found.');
        notFound.code = 'NOT_FOUND';
        throw notFound;
      }
      throw error;
    }
  }

  async function loadCurrentGame() {
    try {
      const pointer = JSON.parse(await readFile(activeFile, 'utf8'));
      assertGameId(pointer.gameId);
      return await withGameLock(pointer.gameId, () => loadGame(pointer.gameId));
    } catch (error) {
      if (
        error.code !== 'ENOENT'
        && error.code !== 'NOT_FOUND'
        && !(error instanceof SyntaxError)
      ) {
        throw error;
      }
    }

    let entries;
    try {
      entries = await readdir(saveRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        const notFound = new Error('No saved game exists.');
        notFound.code = 'NOT_FOUND';
        throw notFound;
      }
      throw error;
    }

    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !GAME_ID_PATTERN.test(entry.name)) continue;
      try {
        const session = await withGameLock(entry.name, () => loadGame(entry.name));
        const timestamp = Date.parse(session.updatedAt || session.createdAt || '') || 0;
        candidates.push({ session, timestamp });
      } catch { /* Ignore incomplete or invalid save directories. */ }
    }
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    const latest = candidates[0]?.session;
    if (!latest) {
      const notFound = new Error('No saved game exists.');
      notFound.code = 'NOT_FOUND';
      throw notFound;
    }
    return withGameLock(latest.id, async () => {
      const current = await loadGame(latest.id);
      await setActiveGame(current.id);
      return current;
    });
  }

  async function withGameLock(gameId, operation) {
    assertGameId(gameId);
    const previous = (locks.get(gameId) ?? Promise.resolve()).catch(() => {});
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    locks.set(gameId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(gameId) === queued) locks.delete(gameId);
    }
  }

  async function beginTurn(gameId) {
    await recoverGame(gameId);
    const { gameDir, filesDir } = pathsFor(gameId);
    const stagingDir = path.join(gameDir, `.turn-${randomUUID()}`);
    await copyWorld(filesDir, stagingDir);
    return stagingDir;
  }

  async function discardTurn(stagingDir) {
    await rm(stagingDir, { recursive: true, force: true });
  }

  async function commitTurn(gameId, stagingDir, session) {
    await recoverGame(gameId);
    const { gameDir, filesDir, sessionFile, commitFile } = pathsFor(gameId);
    const backupDir = path.join(gameDir, `.previous-${randomUUID()}`);
    const nextSessionFile = path.join(gameDir, `.session-next-${randomUUID()}.json`);
    await atomicJsonWrite(nextSessionFile, session);
    await atomicJsonWrite(commitFile, {
      version: 1,
      staging: path.basename(stagingDir),
      backup: path.basename(backupDir),
      nextSession: path.basename(nextSessionFile)
    });
    try {
      await rename(filesDir, backupDir);
      await rename(stagingDir, filesDir);
      await rename(nextSessionFile, sessionFile);
      await rm(backupDir, { recursive: true, force: true });
      await rm(commitFile, { force: true });
    } catch (error) {
      await recoverGame(gameId).catch(() => {});
      throw error;
    }
    await setActiveGame(gameId).catch(() => {});
  }

  return {
    createGame,
    loadGame,
    loadCurrentGame,
    setActiveGame,
    withGameLock,
    beginTurn,
    discardTurn,
    commitTurn,
    pathsFor
  };
}
