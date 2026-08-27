'use strict';

/**
 * Reading and writing the crumb file itself, plus the few odds and ends every
 * command needs (local timestamps, the agent id). Commands go through here so
 * "missing" and "malformed" are one shape everywhere.
 */

const fs = require('fs');
const crumb = require('./crumb');
const { crumbPath, CRUMB_FILE } = require('./config');
const { read, write } = require('./files');

/**
 * Load and parse the crumb.
 * Returns { state: 'ok'|'missing'|'malformed', doc, text, error }.
 */
function load(root) {
  const p = crumbPath(root);
  const text = read(p);
  if (text === null) return { state: 'missing', path: p };
  try {
    return { state: 'ok', path: p, text, doc: crumb.parse(text) };
  } catch (err) {
    return { state: 'malformed', path: p, text, error: err.message };
  }
}

function save(root, doc, { dryRun = false } = {}) {
  return write(crumbPath(root), crumb.stringify(doc), { dryRun });
}

/**
 * ISO-8601 with the machine's own UTC offset. Deliberately local rather than
 * Z: a human reading the crumb wants their own wall clock, and the offset
 * keeps it unambiguous for anyone else.
 */
function localIso(date = new Date()) {
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -date.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

/**
 * Who is writing. Agents pass --agent; REPOCRUMB_AGENT lets a harness set it
 * once. We never guess — a wrong id is worse than "unknown".
 */
function agentId(explicit) {
  return explicit || process.env.REPOCRUMB_AGENT || 'unknown';
}

/** Paths named in `## Key files`, from the leading backtick span of each bullet. */
function keyFiles(doc) {
  const body = doc.sections.get('Key files');
  if (!body) return [];
  const paths = [];
  for (const line of body.split('\n')) {
    const m = /^[-*]\s+`([^`]+)`/.exec(line.trim());
    if (m) paths.push(m[1]);
  }
  return paths;
}

const exists = (p) => fs.existsSync(p);

module.exports = { load, save, localIso, agentId, keyFiles, exists, CRUMB_FILE };
