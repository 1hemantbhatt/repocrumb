#!/usr/bin/env node
'use strict';

/**
 * Crumb v1 conformance suite.
 *
 *   node conformance/run.js --cmd "<your crumb filter command>"
 *
 * The command under test reads a crumb document on stdin and MUST write the
 * canonical re-serialisation on stdout, exiting 0 for a valid document and 4
 * for an invalid one. That single contract exercises everything the spec
 * actually requires of a writer: the frontmatter grammar, section ordering,
 * journal parsing, and — the clause that matters most for interoperability —
 * preservation of unknown keys and unknown sections.
 *
 * This runner is deliberately implementation-agnostic. It shells out. Nothing
 * here requires the implementation to be JavaScript.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CASES_DIR = path.join(__dirname, 'cases');

function parseArgs(argv) {
  let cmd = null;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cmd') cmd = argv[++i];
    else if (argv[i] === '--verbose') verbose = true;
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (!cmd) {
    console.error('usage: node conformance/run.js --cmd "<crumb filter command>"');
    process.exit(2);
  }
  return { cmd, verbose };
}

/** Run the implementation over one input. Returns { code, stdout }. */
function filter(cmd, input) {
  try {
    const stdout = execSync(cmd, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status === undefined ? 1 : err.status, stdout: err.stdout || '' };
  }
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// --- §3 frontmatter, §4 sections ------------------------------------------

test('accepts a minimal valid crumb', ({ cmd, fixture }) => {
  const { code } = filter(cmd, fixture('valid.md'));
  if (code !== 0) throw new Error(`expected exit 0, got ${code}`);
});

test('output is idempotent — filtering twice changes nothing', ({ cmd, fixture }) => {
  const once = filter(cmd, fixture('valid.md')).stdout;
  const twice = filter(cmd, once).stdout;
  if (once !== twice) throw new Error('second pass produced different output');
});

test('emits the required sections in canonical order', ({ cmd, fixture }) => {
  const { stdout } = filter(cmd, fixture('valid.md'));
  const order = (stdout.match(/^## .+$/gm) || []).map((h) => h.slice(3));
  const objective = order.indexOf('Objective');
  const state = order.indexOf('State');
  if (objective === -1 || state === -1) throw new Error('required sections missing from output');
  if (!(objective < state)) throw new Error('Objective must precede State');
  if (order[order.length - 1] !== 'Journal') throw new Error('Journal must be last');
});

// --- §6 preservation, the interoperability clause --------------------------

test('preserves an unknown frontmatter key', ({ cmd, fixture }) => {
  const { stdout } = filter(cmd, fixture('unknown.md'));
  if (!/^x_othertool_id: abc123$/m.test(stdout)) {
    throw new Error('unknown frontmatter key was dropped');
  }
});

test('preserves an unknown section verbatim', ({ cmd, fixture }) => {
  const { stdout } = filter(cmd, fixture('unknown.md'));
  if (!/^## Other tool notes$/m.test(stdout)) throw new Error('unknown section heading was dropped');
  if (!stdout.includes('- something only the other tool cares about')) {
    throw new Error('unknown section body was dropped');
  }
});

test('places unknown sections before the journal', ({ cmd, fixture }) => {
  const { stdout } = filter(cmd, fixture('unknown.md'));
  if (stdout.indexOf('## Other tool notes') > stdout.indexOf('## Journal')) {
    throw new Error('unknown section emitted after the journal');
  }
});

// --- §5 journal ------------------------------------------------------------

test('preserves every journal entry and their order', ({ cmd, fixture }) => {
  const { stdout } = filter(cmd, fixture('journal.md'));
  const heads = (stdout.match(/^- \S+ \S+ @\S+$/gm) || []);
  if (heads.length !== 3) throw new Error(`expected 3 journal entries, got ${heads.length}`);
  if (!heads[0].includes('@aaa1111')) throw new Error('journal is not newest-first');
});

test('keeps did and next on their entries', ({ cmd, fixture }) => {
  const { stdout } = filter(cmd, fixture('journal.md'));
  if (!/ {2}did: wrote the parser/.test(stdout)) throw new Error('did line lost');
  if (!/ {2}next: the cli/.test(stdout)) throw new Error('next line lost');
});

// --- §8 versioning, invalid input ------------------------------------------

test('rejects a document with no frontmatter', ({ cmd, fixture }) => {
  const { code } = filter(cmd, fixture('v0.md'));
  if (code !== 4) throw new Error(`expected exit 4, got ${code}`);
});

test('rejects an unrecognised spec version rather than guessing', ({ cmd, fixture }) => {
  const { code } = filter(cmd, fixture('future.md'));
  if (code !== 4) throw new Error(`expected exit 4, got ${code}`);
});

test('rejects a crumb missing a required section', ({ cmd, fixture }) => {
  const { code } = filter(cmd, fixture('incomplete.md'));
  if (code !== 4) throw new Error(`expected exit 4, got ${code}`);
});

test('rejects unterminated frontmatter', ({ cmd, fixture }) => {
  const { code } = filter(cmd, fixture('unterminated.md'));
  if (code !== 4) throw new Error(`expected exit 4, got ${code}`);
});

// --- runner ----------------------------------------------------------------

function main() {
  const { cmd, verbose } = parseArgs(process.argv.slice(2));
  const fixture = (name) => fs.readFileSync(path.join(CASES_DIR, name), 'utf8');

  let passed = 0;
  const failures = [];

  for (const c of cases) {
    try {
      c.fn({ cmd, fixture });
      passed++;
      if (verbose) console.log(`  ok    ${c.name}`);
    } catch (err) {
      failures.push({ name: c.name, message: err.message });
      console.error(`  FAIL  ${c.name}\n          ${err.message}`);
    }
  }

  console.log(
    `\ncrumb/1 conformance: ${passed}/${cases.length} passed` +
      (failures.length ? ` — ${failures.length} failed` : '')
  );
  process.exit(failures.length ? 1 : 0);
}

main();
