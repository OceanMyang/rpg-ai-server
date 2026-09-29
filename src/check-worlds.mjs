import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE_BYTES = 64 * 1024;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const LINK_PATTERN = /\[\[([^\]\n]+)\]\]/gu;
const STALE_REFERENCES = [/roll\.py/u, /CLAUDE\.md/u, /finish_turn/u];
const COPIED_FOLDERS = ['game', 'world'];

// Walks a folder, reporting every file with its path relative to the world.
async function walk(root, relative = '') {
  const directory = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
    const info = await lstat(path.join(root, entryPath));
    if (info.isSymbolicLink()) {
      files.push({ path: entryPath, symlink: true, bytes: 0 });
    } else if (info.isDirectory()) {
      files.push(...await walk(root, entryPath));
    } else if (info.isFile()) {
      files.push({ path: entryPath, symlink: false, bytes: info.size });
    }
  }
  return files;
}

export async function checkWorld(directory, slug = path.basename(directory)) {
  const errors = [];
  const warnings = [];
  const note = (list, message) => list.push(message);

  if (!SLUG_PATTERN.test(slug)) {
    note(errors, `Folder name "${slug}" is not a valid slug (lower-case letters, digits, hyphens).`);
  }

  const files = [];
  for (const folder of COPIED_FOLDERS) files.push(...await walk(directory, folder));
  const rootEntries = await walk(directory).catch(() => []);
  const rules = rootEntries.find((file) => file.path === 'rules.md');
  const opening = rootEntries.find((file) => file.path === 'opening.md');

  // opening.md is player-facing: it is shown verbatim, before the model is ever called.
  if (opening) {
    const text = await readFile(path.join(directory, 'opening.md'), 'utf8').catch(() => '');
    if (!text.trim()) note(errors, 'opening.md is empty; it is shown to the player as the first message.');
    if (LINK_PATTERN.test(text)) {
      note(errors, 'opening.md contains [[links]]; the player would see the brackets. Write names plainly.');
    }
    LINK_PATTERN.lastIndex = 0;
  }
  if (!rules) {
    note(warnings, 'rules.md is missing; this world gives the host no dice, tables, harm or time rules.');
  }
  if (files.some((file) => file.path === 'world/rules.md')) {
    note(errors, "world/rules.md is not a thing; this world's rules belong at rules.md, beside game/ and world/.");
  }

  const markdown = files.filter((file) => file.path.endsWith('.md'));
  const byPath = new Map(markdown.map((file) => [file.path, file]));

  // Anything that is not Markdown is silently dropped when a save is copied.
  for (const file of files) {
    if (file.symlink) {
      note(errors, `${file.path} is a symbolic link; saves may not contain links.`);
    } else if (!file.path.endsWith('.md')) {
      note(errors, `${file.path} is not Markdown and would be left out of every save.`);
    } else if (file.bytes > MAX_FILE_BYTES) {
      note(errors, `${file.path} is ${Math.round(file.bytes / 1024)} KB; the limit is 64 KB.`);
    }
  }

  for (const required of ['game/state.md', 'game/log.md']) {
    if (!byPath.has(required)) note(errors, `${required} is missing.`);
  }

  const entities = markdown.filter((file) => file.path.startsWith('world/'));
  if (entities.length === 0) note(errors, 'world/ has no entity files.');

  const players = entities.filter((file) => (
    file.path.startsWith('world/player/') && file.path.split('/').length === 3
  ));

  // Entity names are how [[links]] resolve, so duplicates are ambiguous.
  const names = new Map();
  for (const file of entities) {
    const name = path.basename(file.path, '.md');
    names.set(name, [...(names.get(name) ?? []), file.path]);
  }
  for (const [name, paths] of names) {
    if (paths.length > 1) note(warnings, `Two files are both called "${name}": ${paths.join(', ')}.`);
  }

  const readable = [...markdown, ...(rules ? [rules] : [])];
  const missingLinks = new Map();
  for (const file of readable) {
    let text;
    try {
      text = await readFile(path.join(directory, file.path), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(LINK_PATTERN)) {
      const name = match[1].trim();
      if (names.has(name)) continue;
      missingLinks.set(name, [...(missingLinks.get(name) ?? new Set())].concat(file.path));
    }
    for (const pattern of STALE_REFERENCES) {
      if (pattern.test(text)) {
        note(warnings, `${file.path} mentions ${pattern.source.replace(/\\/gu, '')}, which no longer exists.`);
      }
    }
    if (file.path === 'game/state.md') {
      if (!/^##\s*Player Character\s*$/imu.test(text)) {
        note(errors, 'game/state.md has no "## Player Character" section; the host pins the files linked there.');
      }
      if (!/^\s*[-*]?\s*(?:\*\*)?Present(?:\*\*)?:/imu.test(text)) {
        note(warnings, 'game/state.md has no "Present:" line; characters in a scene will not be pinned.');
      }
    }
    if (players.some((player) => player.path === file.path) && !/\*\*Concept:\*\*/u.test(text)) {
      note(warnings, `${file.path} has no "**Concept:**" line; the character picker will show only its name.`);
    }
  }
  for (const [name, sources] of missingLinks) {
    note(errors, `[[${name}]] has no file (linked from ${[...new Set(sources)].join(', ')}).`);
  }

  let title = slug;
  const metaPath = path.join(directory, 'world.json');
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    if (typeof meta.title === 'string' && meta.title.trim()) title = meta.title.trim();
    else note(warnings, 'world.json has no title; the picker will show the slug.');
    if (meta.slug !== undefined && meta.slug !== slug) {
      note(errors, `world.json slug "${meta.slug}" does not match the folder name "${slug}".`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') note(warnings, 'world.json is missing; the picker will show the slug.');
    else note(errors, `world.json is not valid JSON: ${error.message}`);
  }

  return {
    slug,
    title,
    counts: { files: markdown.length, entities: entities.length, players: players.length },
    errors,
    warnings
  };
}

export async function checkWorlds(worldsRoot) {
  let entries;
  try {
    entries = await readdir(worldsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const reports = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    reports.push(await checkWorld(path.join(worldsRoot, entry.name), entry.name));
  }
  return reports;
}
