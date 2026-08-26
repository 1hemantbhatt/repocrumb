'use strict';

const fs = require('fs');
const path = require('path');

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

const exists = (p) => fs.existsSync(p);

/**
 * Read a file that ships with the package. A missing one is a broken install,
 * not a condition to route around: write() treats null content as "no change",
 * so without this the installer would report success having written nothing.
 */
function readRequired(absPath) {
  const content = read(absPath);
  if (content === null) {
    throw new Error(`missing package template: ${absPath}\nThis is a broken handoffkit install — try reinstalling.`);
  }
  return content;
}

/**
 * Write a file, creating parent directories. Honours dry-run by doing nothing.
 * Returns 'create' | 'update' | 'same' so the caller can report accurately
 * rather than claiming it wrote something it didn't.
 */
function write(absPath, content, { dryRun = false } = {}) {
  const before = read(absPath);
  if (before === content) return 'same';
  const outcome = before === null ? 'create' : 'update';
  if (!dryRun) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }
  return outcome;
}

/**
 * Write only when the file does not already exist. For anything the user owns
 * and edits — last_handoff.md is live state, not a template, and clobbering it
 * would destroy the very thing this tool exists to preserve.
 */
function writeIfAbsent(absPath, content, { dryRun = false } = {}) {
  if (exists(absPath)) return 'same';
  return write(absPath, content, { dryRun });
}

/**
 * Add a line to a gitignore-style file if no existing line already matches it.
 * Comparison ignores surrounding whitespace and leading "/" so we don't add a
 * near-duplicate of a rule that's already doing the job.
 */
function ensureIgnoreLine(absPath, entry, comment, { dryRun = false } = {}) {
  const normalize = (s) => s.trim().replace(/^\/+/, '');
  const current = read(absPath);
  const lines = current === null ? [] : current.split(/\r?\n/);

  if (lines.some((l) => normalize(l) === normalize(entry))) return 'same';

  const block = [comment ? `# ${comment}` : null, entry]
    .filter(Boolean)
    .join('\n');

  let next;
  if (current === null) {
    next = `${block}\n`;
  } else {
    const sep = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    next = `${current}${sep}${block}\n`;
  }
  return write(absPath, next, { dryRun });
}

/**
 * Insert or replace a marker-delimited block in a markdown file.
 *
 * Markers are what make re-running safe: on the second run we replace our own
 * block in place instead of appending a second copy. Anything outside the
 * markers is never touched, which matters for files like AGENTS.md that other
 * tools also write to.
 */
function upsertBlock(absPath, id, body, { dryRun = false } = {}) {
  const begin = `<!-- BEGIN ${id} -->`;
  const end = `<!-- END ${id} -->`;
  const block = `${begin}\n${body.trim()}\n${end}`;

  const current = read(absPath);
  if (current === null) return write(absPath, `${block}\n`, { dryRun });

  const bi = current.indexOf(begin);
  const ei = current.indexOf(end);

  if (bi !== -1 && ei !== -1 && ei > bi) {
    const next = current.slice(0, bi) + block + current.slice(ei + end.length);
    return write(absPath, next, { dryRun });
  }

  // No existing block. Append, leaving one blank line of breathing room.
  const sep = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  return write(absPath, `${current}${sep}${block}\n`, { dryRun });
}

/**
 * Read JSON, tolerating a missing file. Throws on malformed JSON — silently
 * replacing a settings file we failed to parse would discard the user's config.
 */
function readJson(absPath) {
  const raw = read(absPath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${absPath} is not valid JSON (${err.message})`);
  }
}

function writeJson(absPath, value, { dryRun = false } = {}) {
  return write(absPath, `${JSON.stringify(value, null, 2)}\n`, { dryRun });
}

module.exports = {
  read,
  readRequired,
  exists,
  write,
  writeIfAbsent,
  ensureIgnoreLine,
  upsertBlock,
  readJson,
  writeJson,
};
