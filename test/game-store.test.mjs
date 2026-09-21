import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const PLAYER = 'a'.repeat(32);
import { createGameStore, newPlayerId } from '../src/game-store.mjs';

async function fixture({ withPlayers = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-store-'));
  const template = path.join(root, 'template');
  const saves = path.join(root, 'saves');
  await mkdir(path.join(template, 'game'), { recursive: true });
  await mkdir(path.join(template, 'world', 'characters'), { recursive: true });
  await writeFile(path.join(template, 'game', 'state.md'), '# Game State\n\nDay 1\n');
  await writeFile(path.join(template, 'game', 'log.md'), '# Chronicle\n');
  await writeFile(path.join(template, 'world', 'Village.md'), '# Village\n');
  await writeFile(path.join(template, 'world', 'characters', 'Mara.md'), '# Mara\n');
  if (withPlayers) {
    await mkdir(path.join(template, 'world', 'player'));
    await writeFile(
      path.join(template, 'world', 'player', 'Rook.md'),
      '# Rook\n\n- **Concept:** A wandering courier\n'
    );
  }
  return { template, saves };
}

test('each new game receives an independent copy of game/ and world/', async () => {
  const { template, saves } = await fixture();
  const store = createGameStore({ saveRoot: saves, templateRoot: template });
  const first = await store.createGame(PLAYER);
  const second = await store.createGame(PLAYER);
  assert.notEqual(first.id, second.id);

  const firstFiles = store.pathsFor(first.id).filesDir;
  const secondFiles = store.pathsFor(second.id).filesDir;
  assert.equal(await readFile(path.join(firstFiles, 'world', 'characters', 'Mara.md'), 'utf8'), '# Mara\n');
  await writeFile(path.join(firstFiles, 'game', 'state.md'), '# Game State\n\nDay 2\n');
  assert.equal(await readFile(path.join(secondFiles, 'game', 'state.md'), 'utf8'), '# Game State\n\nDay 1\n');
  assert.equal(await readFile(path.join(template, 'game', 'state.md'), 'utf8'), '# Game State\n\nDay 1\n');
});

test('the opening lists selectable player characters, or promises a random one', async () => {
  const withPlayers = await fixture();
  const store = createGameStore({ saveRoot: withPlayers.saves, templateRoot: withPlayers.template });
  const game = await store.createGame(PLAYER);
  assert.match(game.messages[0].content, /1\. Rook — A wandering courier/u);

  const withoutPlayers = await fixture({ withPlayers: false });
  const randomStore = createGameStore({
    saveRoot: withoutPlayers.saves,
    templateRoot: withoutPlayers.template
  });
  const randomGame = await randomStore.createGame(PLAYER);
  assert.match(randomGame.messages[0].content, /chosen for you at random/u);
});

test('the active campaign survives browser storage loss and server restart', async () => {
  const { template, saves } = await fixture();
  const firstStore = createGameStore({ saveRoot: saves, templateRoot: template });
  await firstStore.createGame(PLAYER);
  const active = await firstStore.createGame(PLAYER);

  const restartedStore = createGameStore({ saveRoot: saves, templateRoot: template });
  assert.equal((await restartedStore.loadCurrentGame(PLAYER)).id, active.id);

  await rename(path.join(saves, 'players', `${PLAYER}.json`), path.join(saves, 'moved.json'));
  assert.equal((await restartedStore.loadCurrentGame(PLAYER)).id, active.id);
});

test('a player cannot reach another player\'s game', async () => {
  const { template, saves } = await fixture();
  const store = createGameStore({ saveRoot: saves, templateRoot: template });
  const alice = newPlayerId();
  const bob = newPlayerId();
  const hers = await store.createGame(alice);

  await assert.rejects(store.loadGame(hers.id, bob), { code: 'NOT_FOUND' });
  await assert.rejects(store.loadCurrentGame(bob), { code: 'NOT_FOUND' });
  assert.equal((await store.loadGame(hers.id, alice)).id, hers.id);

  const his = await store.createGame(bob);
  assert.notEqual(his.id, hers.id);
  assert.equal((await store.loadCurrentGame(bob)).id, his.id);
  assert.equal((await store.loadCurrentGame(alice)).id, hers.id);
});

test('a new player never inherits an existing story', async () => {
  const { template, saves } = await fixture();
  const store = createGameStore({ saveRoot: saves, templateRoot: template });
  await store.createGame(newPlayerId());
  await store.createGame(newPlayerId());
  await assert.rejects(store.loadCurrentGame(newPlayerId()), { code: 'NOT_FOUND' });
});

test('saves from an older format are treated as missing', async () => {
  const { template, saves } = await fixture();
  const store = createGameStore({ saveRoot: saves, templateRoot: template });
  const session = await store.createGame(PLAYER);
  const { sessionFile } = store.pathsFor(session.id);
  const outdated = { ...session };
  delete outdated.format;
  await writeFile(sessionFile, JSON.stringify(outdated));
  await assert.rejects(store.loadGame(session.id, PLAYER), { code: 'NOT_FOUND' });
  await assert.rejects(store.loadCurrentGame(PLAYER), { code: 'NOT_FOUND' });
});

test('a staged turn can be committed atomically', async () => {
  const { template, saves } = await fixture();
  const store = createGameStore({ saveRoot: saves, templateRoot: template });
  const session = await store.createGame(PLAYER);
  const staging = await store.beginTurn(session.id);
  await writeFile(path.join(staging, 'game', 'state.md'), '# Game State\n\nDay 2\n');
  session.messages.push({ role: 'user', content: 'I wait.' });
  await store.commitTurn(session.id, staging, session);

  const { filesDir } = store.pathsFor(session.id);
  assert.equal(await readFile(path.join(filesDir, 'game', 'state.md'), 'utf8'), '# Game State\n\nDay 2\n');
  assert.equal((await store.loadGame(session.id, PLAYER)).messages.length, 2);
});

test('an interrupted commit rolls forward from its journal', async () => {
  const { template, saves } = await fixture();
  const store = createGameStore({ saveRoot: saves, templateRoot: template });
  const session = await store.createGame(PLAYER);
  const { gameDir, filesDir, sessionFile, commitFile } = store.pathsFor(session.id);
  const staging = await store.beginTurn(session.id);
  await writeFile(path.join(staging, 'game', 'state.md'), '# Game State\n\nDay 2\n');

  const backup = path.join(gameDir, '.previous-test');
  const nextSession = path.join(gameDir, '.session-next-test.json');
  const advanced = { ...session, messages: [...session.messages, { role: 'user', content: 'I wait.' }] };
  await writeFile(nextSession, JSON.stringify(advanced));
  await writeFile(commitFile, JSON.stringify({
    version: 1,
    staging: path.basename(staging),
    backup: path.basename(backup),
    nextSession: path.basename(nextSession)
  }));
  await rename(filesDir, backup);
  await rename(staging, filesDir);

  assert.equal((await store.loadGame(session.id, PLAYER)).messages.length, 2);
  await assert.rejects(access(commitFile), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(sessionFile, 'utf8')).messages.length, 2);
  assert.equal(await readFile(path.join(filesDir, 'game', 'state.md'), 'utf8'), '# Game State\n\nDay 2\n');
});
