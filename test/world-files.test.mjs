import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  copyWorld,
  readWorldFile,
  rollDice,
  validateWorldPath,
  writeWorldFile,
  WorldFileError
} from '../src/world-files.mjs';

test('world paths accept nested Markdown and reject traversal', () => {
  assert.equal(validateWorldPath('characters/Mara Venn.md'), path.join('characters', 'Mara Venn.md'));
  for (const invalid of ['../secret.md', '/tmp/secret.md', 'C:\\secret.md', 'notes.txt', 'a//b.md']) {
    assert.throws(() => validateWorldPath(invalid), WorldFileError);
  }
});

test('read and revision-checked write stay inside a world', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-world-'));
  await mkdir(path.join(root, 'characters'));
  await writeFile(path.join(root, 'characters', 'Mara.md'), '# Mara\n');

  const first = await readWorldFile(root, 'characters/Mara.md');
  assert.match(first.revision, /^[a-f0-9]{64}$/u);
  const written = await writeWorldFile(root, {
    path: 'characters/Mara.md',
    content: '# Mara\n\nChanged.\n',
    expectedRevision: first.revision
  });
  assert.equal(written.ok, true);
  assert.equal(await readFile(path.join(root, 'characters', 'Mara.md'), 'utf8'), '# Mara\n\nChanged.\n');

  await assert.rejects(
    writeWorldFile(root, {
      path: 'characters/Mara.md',
      content: 'stale',
      expectedRevision: first.revision
    }),
    (error) => error.code === 'REVISION_CONFLICT'
  );
});

test('read rejects a symbolic-link escape', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-link-'));
  const outside = path.join(root, '..', `outside-${Date.now()}.md`);
  await writeFile(outside, 'secret');
  try {
    await symlink(outside, path.join(root, 'escape.md'));
  } catch (error) {
    context.skip(`symlinks unavailable: ${error.code}`);
    return;
  }
  await assert.rejects(
    readWorldFile(root, 'escape.md'),
    (error) => error.code === 'INVALID_PATH'
  );
});

test('read rejects a symbolic-link world root', async (context) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-root-link-'));
  const outside = path.join(parent, 'outside');
  const linked = path.join(parent, 'linked-world');
  await mkdir(outside);
  await writeFile(path.join(outside, 'World.md'), 'secret');
  try {
    await symlink(outside, linked);
  } catch (error) {
    context.skip(`symlinks unavailable: ${error.code}`);
    return;
  }
  await assert.rejects(
    readWorldFile(linked, 'World.md'),
    (error) => error.code === 'INVALID_WORLD'
  );
});

test('copyWorld copies Markdown and ignores unrelated regular files', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-copy-'));
  const source = path.join(parent, 'source');
  const destination = path.join(parent, 'destination');
  await mkdir(source);
  await writeFile(path.join(source, 'World.md'), '# World\n');
  await writeFile(path.join(source, 'ignored.txt'), 'ignored');
  await copyWorld(source, destination);
  assert.equal(await readFile(path.join(destination, 'World.md'), 'utf8'), '# World\n');
  await assert.rejects(readFile(path.join(destination, 'ignored.txt')), { code: 'ENOENT' });
});

test('rollDice returns bounded individual rolls and a correct total', () => {
  for (let index = 0; index < 100; index += 1) {
    const result = rollDice({ count: 2, sides: 20, modifier: 3, reason: 'A test' });
    assert.equal(result.rolls.length, 2);
    assert.ok(result.rolls.every((roll) => roll >= 1 && roll <= 20));
    assert.equal(result.total, result.rolls[0] + result.rolls[1] + 3);
  }
});
