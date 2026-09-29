import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkWorld, checkWorlds } from '../src/check-worlds.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every installed world is playable', async () => {
  const reports = await checkWorlds(path.join(ROOT, 'worlds'));
  assert.ok(reports.length > 0, 'no worlds are installed');
  for (const report of reports) {
    assert.deepEqual(report.errors, [], `${report.slug} has errors`);
    assert.ok(report.counts.entities > 0);
  }
});

test('a broken world reports each problem', async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-check-')), 'broken');
  await mkdir(path.join(directory, 'game'), { recursive: true });
  await mkdir(path.join(directory, 'world', 'player'), { recursive: true });

  // No "## Player Character" section, no Present line, and a link to nothing.
  await writeFile(path.join(directory, 'game', 'state.md'), '# Game State\n\nDay 1 at [[Nowhere]].\n');
  await writeFile(path.join(directory, 'world', 'Place.md'), '# Place\n\nRoll with `roll.py` here.\n');
  await writeFile(path.join(directory, 'world', 'notes.txt'), 'not markdown');
  await writeFile(path.join(directory, 'world', 'player', 'Hero.md'), '# Hero\n');
  await writeFile(path.join(directory, 'world.json'), JSON.stringify({ slug: 'elsewhere', title: 'Broken' }));

  const report = await checkWorld(directory, 'broken');
  const errors = report.errors.join('\n');
  const warnings = report.warnings.join('\n');

  assert.match(errors, /game\/log\.md is missing/u);
  assert.match(errors, /no "## Player Character" section/u);
  assert.match(errors, /\[\[Nowhere\]\] has no file/u);
  assert.match(errors, /notes\.txt is not Markdown/u);
  assert.match(errors, /slug "elsewhere" does not match/u);
  assert.match(warnings, /no "Present:" line/u);
  assert.match(warnings, /Hero\.md has no "\*\*Concept:\*\*" line/u);
  assert.match(warnings, /roll\.py/u);
});

test('a world with a duplicate entity name is flagged', async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-dupe-')), 'dupe');
  await mkdir(path.join(directory, 'game'), { recursive: true });
  await mkdir(path.join(directory, 'world', 'characters'), { recursive: true });
  await writeFile(
    path.join(directory, 'game', 'state.md'),
    '# Game State\n\n## Player Character\n- **PC:** none\n- **Present:** none\n'
  );
  await writeFile(path.join(directory, 'game', 'log.md'), '# Chronicle\n');
  await writeFile(path.join(directory, 'world', 'Mara.md'), '# Mara\n');
  await writeFile(path.join(directory, 'world', 'characters', 'Mara.md'), '# Mara\n');

  const report = await checkWorld(directory, 'dupe');
  assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /Two files are both called "Mara"/u);
});
