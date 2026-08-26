'use strict';

// Colour only when we're attached to a TTY that isn't in NO_COLOR mode.
const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const ESC = '\u001b';
const paint = (code, s) => (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s);

const dim = (s) => paint('2', s);
const bold = (s) => paint('1', s);
const green = (s) => paint('32', s);
const yellow = (s) => paint('33', s);
const red = (s) => paint('31', s);
const cyan = (s) => paint('36', s);

// Per-file outcomes. Padded so a run reads as a column, not a ransom note.
const label = (word, colour) => colour(word.padEnd(8));

const created = (p) => console.log(`  ${label('create', green)}${p}`);
const updated = (p) => console.log(`  ${label('update', cyan)}${p}`);
const skipped = (p, why) =>
  console.log(`  ${label('skip', dim)}${dim(p)}${why ? dim(`  (${why})`) : ''}`);
const planned = (p, what) => console.log(`  ${label(what, yellow)}${p}`);

const info = (msg) => console.log(msg);
const warn = (msg) => console.warn(`${yellow('warning')}  ${msg}`);
const error = (msg) => console.error(`${red('error')}  ${msg}`);

module.exports = {
  bold,
  dim,
  green,
  yellow,
  cyan,
  created,
  updated,
  skipped,
  planned,
  info,
  warn,
  error,
};
