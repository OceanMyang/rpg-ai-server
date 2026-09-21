import { readFile } from 'node:fs/promises';

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export async function loadEnv(filePath) {
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (process.env[name] === undefined) {
      process.env[name] = unquote(rawValue.trim());
    }
  }
}
