import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm
} from 'node:fs/promises';
import path from 'node:path';

const MAX_PATH_LENGTH = 240;
const MAX_FILE_BYTES = 64 * 1024;
const ALLOWED_DICE = new Set([4, 6, 8, 10, 12, 20, 100]);

export class WorldFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorldFileError';
    this.code = code;
  }
}

export function revisionFor(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function validateWorldPath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PATH_LENGTH) {
    throw new WorldFileError('INVALID_PATH', 'Path must be a short, non-empty string.');
  }
  if (
    input.includes('\0')
    || input.includes('\\')
    || path.posix.isAbsolute(input)
    || path.win32.isAbsolute(input)
    || /^[A-Za-z]:/u.test(input)
  ) {
    throw new WorldFileError('INVALID_PATH', 'Only relative world paths are allowed.');
  }

  const segments = input.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new WorldFileError('INVALID_PATH', 'Path traversal is not allowed.');
  }
  if (path.posix.extname(input).toLowerCase() !== '.md') {
    throw new WorldFileError('INVALID_PATH', 'World tools may access Markdown files only.');
  }
  return segments.join(path.sep);
}

async function verifiedRoot(worldDir) {
  const declaredInfo = await lstat(worldDir);
  if (!declaredInfo.isDirectory() || declaredInfo.isSymbolicLink()) {
    throw new WorldFileError('INVALID_WORLD', 'The world save is not a regular directory.');
  }
  const root = await realpath(worldDir);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WorldFileError('INVALID_WORLD', 'The world save is not a regular directory.');
  }
  return root;
}

async function verifiedExistingFile(worldDir, relativePath) {
  const safeRelative = validateWorldPath(relativePath);
  const root = await verifiedRoot(worldDir);
  const lexicalTarget = path.resolve(root, safeRelative);
  if (!isContained(root, lexicalTarget)) {
    throw new WorldFileError('INVALID_PATH', 'Path is outside the world save.');
  }

  let target;
  try {
    target = await realpath(lexicalTarget);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new WorldFileError('NOT_FOUND', 'That world file does not exist.');
    }
    throw error;
  }
  if (!isContained(root, target)) {
    throw new WorldFileError('INVALID_PATH', 'Path is outside the world save.');
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new WorldFileError('INVALID_FILE', 'World tools may access regular files only.');
  }
  if (info.size > MAX_FILE_BYTES) {
    throw new WorldFileError('FILE_TOO_LARGE', 'That world file is too large to read.');
  }
  return target;
}

export async function readWorldFile(worldDir, relativePath) {
  const target = await verifiedExistingFile(worldDir, relativePath);
  const content = await readFile(target, 'utf8');
  return {
    ok: true,
    path: relativePath,
    content,
    revision: revisionFor(content)
  };
}

export async function writeWorldFile(
  worldDir,
  { path: relativePath, content, expectedRevision }
) {
  if (typeof content !== 'string') {
    throw new WorldFileError('INVALID_CONTENT', 'File content must be text.');
  }
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_FILE_BYTES) {
    throw new WorldFileError('FILE_TOO_LARGE', 'World files may not exceed 64 KiB.');
  }
  if (
    expectedRevision !== null
    && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedRevision))
  ) {
    throw new WorldFileError('INVALID_REVISION', 'Expected revision is invalid.');
  }

  const safeRelative = validateWorldPath(relativePath);
  const root = await verifiedRoot(worldDir);
  const target = path.resolve(root, safeRelative);
  if (!isContained(root, target)) {
    throw new WorldFileError('INVALID_PATH', 'Path is outside the world save.');
  }

  const parent = await realpath(path.dirname(target)).catch((error) => {
    if (error.code === 'ENOENT') {
      throw new WorldFileError('NOT_FOUND', 'The destination directory does not exist.');
    }
    throw error;
  });
  if (parent !== root && !isContained(root, parent)) {
    throw new WorldFileError('INVALID_PATH', 'Destination is outside the world save.');
  }
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new WorldFileError('INVALID_PATH', 'Destination directory is not valid.');
  }

  let currentRevision = null;
  try {
    const targetInfo = await lstat(target);
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
      throw new WorldFileError('INVALID_FILE', 'Destination must be a regular file.');
    }
    const current = await readFile(target, 'utf8');
    currentRevision = revisionFor(current);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (currentRevision !== expectedRevision) {
    throw new WorldFileError(
      'REVISION_CONFLICT',
      currentRevision === null
        ? 'The file does not exist; create it with expected_revision set to null.'
        : 'The file changed. Read it again before writing.'
    );
  }

  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }

  return {
    ok: true,
    path: relativePath,
    revision: revisionFor(content),
    bytes: byteLength
  };
}

export async function listWorldFiles(worldDir) {
  const root = await verifiedRoot(worldDir);
  const files = [];

  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        throw new WorldFileError('INVALID_WORLD', 'World saves may not contain symbolic links.');
      }
      if (info.isDirectory()) {
        await visit(absolute, relative);
      } else if (info.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        if (info.size > MAX_FILE_BYTES) {
          throw new WorldFileError('FILE_TOO_LARGE', `${relative} exceeds the file limit.`);
        }
        files.push({ path: relative, bytes: info.size });
      }
    }
  }

  await visit(root);
  return files;
}

export async function copyWorld(sourceDir, destinationDir) {
  const source = await realpath(sourceDir);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new WorldFileError('INVALID_WORLD', 'World template must be a regular directory.');
  }
  await mkdir(destinationDir, { recursive: false, mode: 0o700 });

  async function copyDirectory(from, to) {
    const entries = await readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(from, entry.name);
      const destinationPath = path.join(to, entry.name);
      const info = await lstat(sourcePath);
      if (info.isSymbolicLink()) {
        throw new WorldFileError('INVALID_WORLD', 'World templates may not contain symbolic links.');
      }
      if (info.isDirectory()) {
        await mkdir(destinationPath, { mode: 0o700 });
        await copyDirectory(sourcePath, destinationPath);
      } else if (info.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        if (info.size > MAX_FILE_BYTES) {
          throw new WorldFileError('FILE_TOO_LARGE', `${entry.name} exceeds the file limit.`);
        }
        await copyFile(sourcePath, destinationPath);
      }
    }
  }

  await copyDirectory(source, destinationDir);
}

export function rollDice({ count, sides, modifier, reason }, randomInteger = randomInt) {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new WorldFileError('INVALID_DICE', 'Dice count must be between 1 and 20.');
  }
  if (!Number.isInteger(sides) || !ALLOWED_DICE.has(sides)) {
    throw new WorldFileError('INVALID_DICE', 'Unsupported die size.');
  }
  if (!Number.isInteger(modifier) || modifier < -100 || modifier > 100) {
    throw new WorldFileError('INVALID_DICE', 'Modifier must be between -100 and 100.');
  }
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 160) {
    throw new WorldFileError('INVALID_DICE', 'A short reason is required.');
  }

  const rolls = Array.from({ length: count }, () => randomInteger(1, sides + 1));
  return {
    ok: true,
    notation: `${count}d${sides}${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`,
    rolls,
    modifier,
    total: rolls.reduce((sum, roll) => sum + roll, modifier),
    reason
  };
}
