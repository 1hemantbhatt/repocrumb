#!/usr/bin/env node
'use strict';

/**
 * The reference "crumb filter" — the one behaviour the conformance suite
 * exercises. Reads a crumb document on stdin, writes the canonical
 * re-serialisation on stdout, exits 0 for a valid document and 4 for an
 * invalid one.
 *
 * Any implementation in any language can pass the suite by providing a command
 * that does exactly this. It is the smallest thing that proves parsing,
 * preservation and serialisation all work together.
 */

const fs = require('fs');
const crumb = require('../src/lib/crumb');

let input = '';
try {
  input = fs.readFileSync(0, 'utf8');
} catch {
  input = '';
}

let doc;
try {
  doc = crumb.parse(input);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(4);
}

const check = crumb.validate(doc);
process.stdout.write(crumb.stringify(doc));

if (!check.ok) {
  for (const e of check.errors) process.stderr.write(`${e}\n`);
  process.exit(4);
}
process.exit(0);
