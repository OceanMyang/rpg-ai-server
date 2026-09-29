import { randomBytes, randomUUID } from 'node:crypto';
import {
  copyFile,
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
const SAVE_FORMAT = 6;
const WORLD_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const PLAYER_ID_PATTERN = /^[0-9a-f]{32}$/u;
// A world package: these files and the world/ folder are copied into each save.
// rules.md sits outside them: it is prompt material, not world state, so it is
// never copied into a save and the host cannot read or rewrite it mid-game.
const TEMPLATE_FILES = ['game/state.md', 'game/log.md'];
const TEMPLATE_FOLDER = 'world';
const PLAYER_FOLDER = 'world/player/';
const locks = new Map();

// A world is a self-contained folder: world.json plus the game/ and world/
// templates that get copied into each new save.
export async function listWorlds(worldsRoot) {
  let entries;
  try {
    entries = await readdir(worldsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !WORLD_SLUG_PATTERN.test(entry.name)) continue;
    const directory = path.join(worldsRoot, entry.name);
    try {
      await readFile(path.join(directory, 'game', 'state.md'));
    } catch {
      continue; // Not a playable world; skip it rather than offering a broken game.
    }
    let meta = {};
    try {
      meta = JSON.parse(await readFile(path.join(directory, 'world.json'), 'utf8'));
    } catch { /* world.json is optional. */ }
    worlds.push({
      slug: entry.name,
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : entry.name,
      blurb: typeof meta.blurb === 'string' ? meta.blurb.trim() : ''
    });
  }
  worlds.sort((a, b) => a.title.localeCompare(b.title));
  return worlds;
}

// A world may ship rules of its own, appended to the shared ones at turn time.
// A world's own rules live beside the world, never in a save: they are appended to the
// system prompt for that game's turns, so editing them reaches games already in progress.
// A world may script the first message the player reads. It is shown before any model
// request, so there is always something to answer even if the provider is down.
export async function readWorldOpening(worldsRoot, slug) {
  if (!WORLD_SLUG_PATTERN.test(slug ?? '')) return '';
  try {
    return (await readFile(path.join(worldsRoot, slug, 'opening.md'), 'utf8')).trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export async function readWorldRules(worldsRoot, slug) {
  if (!WORLD_SLUG_PATTERN.test(slug ?? '')) return '';
  try {
    return (await readFile(path.join(worldsRoot, slug, 'rules.md'), 'utf8')).trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export function newPlayerId() {
  return randomBytes(16).toString('hex');
}

export function isPlayerId(value) {
  return typeof value === 'string' && PLAYER_ID_PATTERN.test(value);
}

function assertPlayerId(playerId) {
  if (!isPlayerId(playerId)) {
    const error = new Error('Game not found.');
    error.code = 'NOT_FOUND';
    throw error;
  }
}

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
  const described = [];
  for (const file of players) {
    const name = file.path.slice(PLAYER_FOLDER.length, -'.md'.length);
    const { content } = await readWorldFile(filesDir, file.path);
    const concept = /^\s*-\s*\*\*Concept:\*\*\s*(.+?)\s*$/imu.exec(content)?.[1];
    described.push({ name, concept });
  }
  // A world with a single character has nothing to choose.
  if (described.length === 1) {
    const { name, concept } = described[0];
    return `A new story begins. You play ${name}${concept ? ` — ${concept}` : ''}.\n\nSend any message to begin.`;
  }
  const choices = described.map(({ name, concept }, index) => (
    `${index + 1}. ${name}${concept ? ` — ${concept}` : ''}`
  ));
  return `A new story begins. Choose your character:\n\n${choices.join('\n')}\n\nReply with a name or number to begin.`;
}

export function createGameStore({ saveRoot, worldsRoot }) {
  // Each player keeps their own pointer, so no visitor can land in another's story.
  const playerDir = path.join(saveRoot, 'players');
  const activeFileFor = (playerId) => {
    assertPlayerId(playerId);
    return path.join(playerDir, `${playerId}.json`);
  };

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

  async function setActiveGame(playerId, gameId) {
    assertGameId(gameId);
    const pointerFile = activeFileFor(playerId);
    await mkdir(playerDir, { recursive: true, mode: 0o700 });
    await atomicJsonWrite(pointerFile, {
      gameId,
      updatedAt: new Date().toISOString()
    });
  }

  async function createGame(playerId, worldSlug) {
    assertPlayerId(playerId);
    const worlds = await listWorlds(worldsRoot);
    const world = worlds.find((candidate) => candidate.slug === worldSlug)
      ?? (worlds.length === 1 && !worldSlug ? worlds[0] : null);
    if (!world) {
      const error = new Error(
        worlds.length === 0 ? 'No worlds are installed.' : 'That world does not exist.'
      );
      error.code = 'NO_WORLD';
      error.status = 400;
      throw error;
    }
    await mkdir(saveRoot, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const { gameDir, filesDir, sessionFile } = pathsFor(id);
    await mkdir(gameDir, { mode: 0o700 });
    await mkdir(filesDir, { mode: 0o700 });
    const source = path.join(worldsRoot, world.slug);
    await copyWorld(path.join(source, TEMPLATE_FOLDER), path.join(filesDir, TEMPLATE_FOLDER));
    await mkdir(path.join(filesDir, 'game'), { mode: 0o700 });
    for (const name of TEMPLATE_FILES) {
      await copyFile(path.join(source, name), path.join(filesDir, name));
    }
    const opening = (await readWorldOpening(worldsRoot, world.slug))
      || await openingMessage(filesDir);
    const now = new Date().toISOString();
    const session = {
      id,
      playerId,
      world: world.slug,
      worldTitle: world.title,
      format: SAVE_FORMAT,
      status: 'playing',
      createdAt: now,
      updatedAt: now,
      messages: [{ role: 'assistant', content: opening }],
      completedTurns: {}
    };
    await atomicJsonWrite(sessionFile, session);
    await setActiveGame(playerId, id);
    return session;
  }

  async function loadGame(gameId, playerId) {
    assertPlayerId(playerId);
    await recoverGame(gameId);
    const { sessionFile } = pathsFor(gameId);
    try {
      const raw = await readFile(sessionFile, 'utf8');
      const session = JSON.parse(raw);
      if (session.id !== gameId || !Array.isArray(session.messages)) {
        throw new Error('Invalid save data.');
      }
      // An unowned or other player's save is simply not found for this player.
      if (session.format !== SAVE_FORMAT || session.playerId !== playerId) {
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

  async function loadCurrentGame(playerId) {
    assertPlayerId(playerId);
    try {
      const pointer = JSON.parse(await readFile(activeFileFor(playerId), 'utf8'));
      assertGameId(pointer.gameId);
      return await withGameLock(pointer.gameId, () => loadGame(pointer.gameId, playerId));
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
        const session = await withGameLock(entry.name, () => loadGame(entry.name, playerId));
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
      const current = await loadGame(latest.id, playerId);
      await setActiveGame(playerId, current.id);
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
    await setActiveGame(session.playerId, gameId).catch(() => {});
  }

  return {
    listWorlds: () => listWorlds(worldsRoot),
    worldRules: (slug) => readWorldRules(worldsRoot, slug),
    worldOpening: (slug) => readWorldOpening(worldsRoot, slug),
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
