import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const PLAYER = 'a'.repeat(32);
import { createGameStore, listWorlds, newPlayerId, readWorldRules } from '../src/game-store.mjs';

async function makeWorld(worldsRoot, slug, { withPlayers = true, title, blurb } = {}) {
  const directory = path.join(worldsRoot, slug);
  await mkdir(path.join(directory, 'game'), { recursive: true });
  await mkdir(path.join(directory, 'world', 'characters'), { recursive: true });
  await writeFile(path.join(directory, 'game', 'state.md'), `# Game State\n\n${slug} Day 1\n`);
  await writeFile(path.join(directory, 'game', 'log.md'), '# Chronicle\n');
  await writeFile(path.join(directory, 'world', 'Village.md'), '# Village\n');
  await writeFile(path.join(directory, 'world', 'characters', 'Mara.md'), '# Mara\n');
  if (title || blurb) {
    await writeFile(
      path.join(directory, 'world.json'),
      JSON.stringify({ slug, title, blurb })
    );
  }
  if (withPlayers) {
    await mkdir(path.join(directory, 'world', 'player'));
    await writeFile(
      path.join(directory, 'world', 'player', 'Rook.md'),
      '# Rook\n\n- **Concept:** A wandering courier\n'
    );
  }
  return directory;
}

async function fixture({ withPlayers = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-store-'));
  const worlds = path.join(root, 'worlds');
  const saves = path.join(root, 'saves');
  await makeWorld(worlds, 'merrowdale', { withPlayers, title: 'Merrowdale' });
  return { worlds, saves, template: path.join(worlds, 'merrowdale') };
}

test('each new game receives an independent copy of game/ and world/', async () => {
  const { worlds, saves, template } = await fixture();
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  const first = await store.createGame(PLAYER);
  const second = await store.createGame(PLAYER);
  assert.notEqual(first.id, second.id);

  const firstFiles = store.pathsFor(first.id).filesDir;
  const secondFiles = store.pathsFor(second.id).filesDir;
  assert.equal(await readFile(path.join(firstFiles, 'world', 'characters', 'Mara.md'), 'utf8'), '# Mara\n');
  await writeFile(path.join(firstFiles, 'game', 'state.md'), '# Game State\n\nmerrowdale Day 2\n');
  assert.equal(await readFile(path.join(secondFiles, 'game', 'state.md'), 'utf8'), '# Game State\n\nmerrowdale Day 1\n');
  assert.equal(await readFile(path.join(template, 'game', 'state.md'), 'utf8'), '# Game State\n\nmerrowdale Day 1\n');
});

test('the opening lists selectable player characters, or promises a random one', async () => {
  const withPlayers = await fixture();
  const store = createGameStore({ saveRoot: withPlayers.saves, worldsRoot: withPlayers.worlds });

  // A world with one player character states who you are instead of offering a choice.
  const only = await store.createGame(PLAYER);
  assert.match(only.messages[0].content, /You play Rook — A wandering courier/u);
  assert.doesNotMatch(only.messages[0].content, /Choose your character/u);

  await writeFile(
    path.join(withPlayers.worlds, 'merrowdale', 'world', 'player', 'Vale.md'),
    '# Vale\n\n- **Concept:** A blacksmith with a debt\n'
  );
  const game = await store.createGame(newPlayerId());
  assert.match(game.messages[0].content, /1\. Rook — A wandering courier/u);
  assert.match(game.messages[0].content, /2\. Vale — A blacksmith with a debt/u);

  const withoutPlayers = await fixture({ withPlayers: false });
  const randomStore = createGameStore({
    saveRoot: withoutPlayers.saves,
    worldsRoot: withoutPlayers.worlds
  });
  const randomGame = await randomStore.createGame(PLAYER);
  assert.match(randomGame.messages[0].content, /chosen for you at random/u);
});

test('the active campaign survives browser storage loss and server restart', async () => {
  const { worlds, saves, template } = await fixture();
  const firstStore = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  await firstStore.createGame(PLAYER);
  const active = await firstStore.createGame(PLAYER);

  const restartedStore = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  assert.equal((await restartedStore.loadCurrentGame(PLAYER)).id, active.id);

  await rename(path.join(saves, 'players', `${PLAYER}.json`), path.join(saves, 'moved.json'));
  assert.equal((await restartedStore.loadCurrentGame(PLAYER)).id, active.id);
});

test('a player cannot reach another player\'s game', async () => {
  const { worlds, saves, template } = await fixture();
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
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
  const { worlds, saves, template } = await fixture();
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  await store.createGame(newPlayerId());
  await store.createGame(newPlayerId());
  await assert.rejects(store.loadCurrentGame(newPlayerId()), { code: 'NOT_FOUND' });
});

test('saves from an older format are treated as missing', async () => {
  const { worlds, saves, template } = await fixture();
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  const session = await store.createGame(PLAYER);
  const { sessionFile } = store.pathsFor(session.id);
  const outdated = { ...session };
  delete outdated.format;
  await writeFile(sessionFile, JSON.stringify(outdated));
  await assert.rejects(store.loadGame(session.id, PLAYER), { code: 'NOT_FOUND' });
  await assert.rejects(store.loadCurrentGame(PLAYER), { code: 'NOT_FOUND' });
});

test('a staged turn can be committed atomically', async () => {
  const { worlds, saves, template } = await fixture();
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  const session = await store.createGame(PLAYER);
  const staging = await store.beginTurn(session.id);
  await writeFile(path.join(staging, 'game', 'state.md'), '# Game State\n\nmerrowdale Day 2\n');
  session.messages.push({ role: 'user', content: 'I wait.' });
  await store.commitTurn(session.id, staging, session);

  const { filesDir } = store.pathsFor(session.id);
  assert.equal(await readFile(path.join(filesDir, 'game', 'state.md'), 'utf8'), '# Game State\n\nmerrowdale Day 2\n');
  assert.equal((await store.loadGame(session.id, PLAYER)).messages.length, 2);
});

test('an interrupted commit rolls forward from its journal', async () => {
  const { worlds, saves, template } = await fixture();
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  const session = await store.createGame(PLAYER);
  const { gameDir, filesDir, sessionFile, commitFile } = store.pathsFor(session.id);
  const staging = await store.beginTurn(session.id);
  await writeFile(path.join(staging, 'game', 'state.md'), '# Game State\n\nmerrowdale Day 2\n');

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
  assert.equal(await readFile(path.join(filesDir, 'game', 'state.md'), 'utf8'), '# Game State\n\nmerrowdale Day 2\n');
});

test('worlds are listed with their titles and blurbs', async () => {
  const { worlds } = await fixture();
  await makeWorld(worlds, 'ashfall', { title: 'Ashfall', blurb: 'A mountain burns.' });
  const listed = await listWorlds(worlds);
  assert.deepEqual(listed.map((world) => world.slug), ['ashfall', 'merrowdale']);
  assert.equal(listed[0].blurb, 'A mountain burns.');
});

test('a folder without a game state is not offered as a world', async () => {
  const { worlds } = await fixture();
  await mkdir(path.join(worlds, 'half-built', 'world'), { recursive: true });
  const listed = await listWorlds(worlds);
  assert.deepEqual(listed.map((world) => world.slug), ['merrowdale']);
});

test('a game is created from the chosen world and records it', async () => {
  const { worlds, saves } = await fixture();
  await makeWorld(worlds, 'ashfall', { title: 'Ashfall' });
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  const session = await store.createGame(PLAYER, 'ashfall');

  assert.equal(session.world, 'ashfall');
  assert.equal(session.worldTitle, 'Ashfall');
  const state = await readFile(
    path.join(store.pathsFor(session.id).filesDir, 'game', 'state.md'),
    'utf8'
  );
  assert.match(state, /ashfall Day 1/u);
});

test('an unknown world is refused, and the only world may be implied', async () => {
  const { worlds, saves } = await fixture();
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });
  await assert.rejects(store.createGame(PLAYER, 'nowhere'), { code: 'NO_WORLD' });
  assert.equal((await store.createGame(PLAYER)).world, 'merrowdale');

  await makeWorld(worlds, 'ashfall', { title: 'Ashfall' });
  await assert.rejects(store.createGame(newPlayerId()), { code: 'NO_WORLD' });
});

test('a world may script the first message the player reads', async () => {
  const { worlds, saves } = await fixture();
  await writeFile(
    path.join(worlds, 'merrowdale', 'opening.md'),
    'You wake in the reeds.\n\n**What do you do?**\n'
  );
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });

  const game = await store.createGame(PLAYER, 'merrowdale');
  assert.equal(game.messages.length, 1);
  assert.equal(game.messages[0].role, 'assistant');
  assert.equal(game.messages[0].content, 'You wake in the reeds.\n\n**What do you do?**');
  assert.doesNotMatch(game.messages[0].content, /Choose your character|You play/u);
});

test('a world may add its own rules, and worlds without them are fine', async () => {
  const { worlds, saves } = await fixture();
  await writeFile(path.join(worlds, 'merrowdale', 'rules.md'), '# Merrowdale rules\n\nRain never falls.\n');
  await makeWorld(worlds, 'ashfall', { title: 'Ashfall' });
  const store = createGameStore({ saveRoot: saves, worldsRoot: worlds });

  assert.match(await store.worldRules('merrowdale'), /Rain never falls\./u);
  assert.equal(await store.worldRules('ashfall'), '');
  assert.equal(await store.worldRules('../escape'), '');
  assert.equal(await readWorldRules(worlds, undefined), '');

  // The rules stay beside the world; a save never carries a copy.
  const game = await store.createGame(PLAYER, 'merrowdale');
  await assert.rejects(access(path.join(store.pathsFor(game.id).filesDir, 'world', 'rules.md')));
});
