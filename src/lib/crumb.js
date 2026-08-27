'use strict';

/**
 * Crumb v1 — parse, validate and serialise a handoff file.
 *
 * This module is the reference implementation of the format described in
 * SPEC.md. It is deliberately dependency-free and small enough to port: the
 * frontmatter grammar is a flat `key: value` subset of YAML, and the body is
 * plain `##` sections. Nothing here knows about git, agents or the CLI.
 *
 * The one rule that makes the format a protocol rather than a template:
 * unknown frontmatter keys and unknown sections survive a parse/stringify
 * round-trip untouched, so another tool can extend the file without us
 * silently deleting its data.
 */

const SPEC = 'crumb/1';
const FENCE = '---';

// Canonical frontmatter order. Unknown keys are emitted after these, in the
// order they were first seen.
//
// These fields are an anchor, not a mirror of the repo. Git can answer any
// question about the present; what it cannot answer is *when these notes were
// written*, so `branch` and `head` record that one point and everything else
// — what landed since, what moved — is derived from it on demand. A field
// that merely restates the repo's current state does not belong here.
const KNOWN_KEYS = [
  'spec',
  'updated',
  'agent',
  'branch',
  'head',
  'tests',
  'tests_cmd',
];

// Canonical section order, most urgent first — a reader that stops after
// Objective and State already has the answer. Journal is always last because
// it is the least often needed and the only unbounded part.
const SECTION_ORDER = [
  'Objective',
  'State',
  'Decisions',
  'Key files',
  'Gotchas',
  'Environment',
];
const JOURNAL = 'Journal';

const REQUIRED_SECTIONS = ['Objective', 'State', JOURNAL];

const TEST_STATES = ['pass', 'fail', 'unknown', 'skipped'];

const MAX_LINES = 120;
const DEFAULT_JOURNAL_MAX = 8;

const TITLE = '# Crumb';

const NOTE = [
  '> Snapshot of current state, for an incoming agent with no prior context.',
  '> Durable sections are rewritten only when they change; the journal is appended to.',
].join('\n');

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * Split `---` fenced frontmatter off the top of a document.
 * Returns { keys: [[k, v], ...], body } with keys in source order. A document
 * with no fence is a v0 crumb and yields an empty key list.
 */
function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== FENCE) return { keys: [], body: text };

  const end = lines.indexOf(FENCE, 1);
  if (end === -1) {
    throw new Error('unterminated frontmatter: opening --- has no closing ---');
  }

  const keys = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const at = line.indexOf(':');
    if (at === -1) {
      throw new Error(
        `invalid frontmatter line ${i + 1}: expected "key: value", got ${JSON.stringify(line)}`
      );
    }
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!key) throw new Error(`invalid frontmatter line ${i + 1}: empty key`);
    keys.push([key, value]);
  }

  return { keys, body: lines.slice(end + 1).join('\n') };
}

function trimBlank(lines) {
  const out = lines.slice();
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/**
 * Split a body into a leading preamble plus `##` sections, preserving the
 * order sections appeared in so unknown ones can be re-emitted in place.
 */
function splitSections(body) {
  const lines = body.split(/\r?\n/);
  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      current = { heading: m[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  for (const s of sections) s.body = trimBlank(s.lines).join('\n');
  return { preamble: trimBlank(preamble).join('\n'), sections };
}

/**
 * Parse a journal body into entries.
 *
 *   - 2026-08-27T14:02 claude-opus-5 @9c04cca
 *     did: ...
 *     next: ...
 *
 * Anything that doesn't match the header shape is kept on the preceding entry
 * as a raw line, so a hand-edited journal is never silently dropped.
 */
function parseJournal(body) {
  const entries = [];
  let current = null;

  for (const line of body.split('\n')) {
    const head = /^-\s+(\S+)\s+(\S+)\s+@(\S+)\s*$/.exec(line);
    if (head) {
      current = { ts: head[1], agent: head[2], head: head[3], did: null, next: null, extra: [] };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^\s+(did|next):\s*(.*)$/.exec(line);
    if (field) current[field[1]] = field[2];
    else if (line.trim()) current.extra.push(line.trim());
  }

  return entries;
}

/**
 * Parse a crumb document. Never throws on a merely incomplete file — that is
 * validate()'s job — only on syntax it cannot make sense of at all.
 */
function parse(text) {
  const { keys, body } = splitFrontmatter(text == null ? '' : text);
  const { preamble, sections } = splitSections(body);

  const frontmatter = {};
  const keyOrder = [];
  for (const [k, v] of keys) {
    if (!(k in frontmatter)) keyOrder.push(k);
    frontmatter[k] = v;
  }

  const known = new Map();
  const unknownSections = [];
  let journal = [];
  let hasJournal = false;

  for (const s of sections) {
    if (s.heading === JOURNAL) {
      hasJournal = true;
      journal = parseJournal(s.body);
    } else if (SECTION_ORDER.includes(s.heading)) {
      known.set(s.heading, s.body);
    } else {
      unknownSections.push({ heading: s.heading, body: s.body });
    }
  }

  return {
    spec: frontmatter.spec || null,
    frontmatter,
    keyOrder,
    preamble,
    sections: known,
    unknownSections,
    journal,
    hasJournal,
  };
}

// ---------------------------------------------------------------------------
// stringify
// ---------------------------------------------------------------------------

function formatEntry(e) {
  const lines = [`- ${e.ts} ${e.agent} @${e.head}`];
  if (e.did) lines.push(`  did: ${e.did}`);
  if (e.next) lines.push(`  next: ${e.next}`);
  for (const x of e.extra || []) lines.push(`  ${x}`);
  return lines.join('\n');
}

/** Serialise a crumb back to canonical text. Round-trips unknown data. */
function stringify(crumb) {
  const fm = Object.assign({}, crumb.frontmatter);
  fm.spec = fm.spec || SPEC;

  const emitted = new Set();
  const fmLines = [];
  const emit = (k) => {
    if (emitted.has(k)) return;
    const v = fm[k];
    if (v === undefined || v === null || v === '') return;
    fmLines.push(`${k}: ${v}`);
    emitted.add(k);
  };

  KNOWN_KEYS.forEach(emit);
  (crumb.keyOrder || []).forEach(emit);
  Object.keys(fm).forEach(emit);

  const parts = [FENCE, ...fmLines, FENCE, '', TITLE, '', NOTE, ''];

  for (const heading of SECTION_ORDER) {
    if (!crumb.sections.has(heading)) continue;
    parts.push(`## ${heading}`, crumb.sections.get(heading), '');
  }
  for (const s of crumb.unknownSections || []) {
    parts.push(`## ${s.heading}`, s.body, '');
  }

  parts.push(`## ${JOURNAL}`);
  parts.push((crumb.journal || []).map(formatEntry).join('\n'));

  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

/** Structural check. Returns { ok, errors, warnings } — never throws. */
function validate(crumb, { maxLines = MAX_LINES } = {}) {
  const errors = [];
  const warnings = [];

  if (!crumb.frontmatter.spec) errors.push('missing frontmatter key: spec');
  else if (crumb.frontmatter.spec !== SPEC) {
    errors.push(
      `unsupported spec "${crumb.frontmatter.spec}" (this implementation reads ${SPEC})`
    );
  }

  for (const key of ['updated', 'agent', 'branch', 'head']) {
    if (!crumb.frontmatter[key]) errors.push(`missing frontmatter key: ${key}`);
  }

  const tests = crumb.frontmatter.tests;
  if (tests && !TEST_STATES.includes(tests)) {
    errors.push(`invalid tests value "${tests}" (expected one of ${TEST_STATES.join(', ')})`);
  }

  for (const heading of REQUIRED_SECTIONS) {
    const present = heading === JOURNAL ? crumb.hasJournal : crumb.sections.has(heading);
    if (!present) errors.push(`missing required section: ## ${heading}`);
  }

  const lines = stringify(crumb).split('\n').length;
  if (lines > maxLines) {
    warnings.push(`crumb is ${lines} lines, over the ${maxLines}-line ceiling — prune it`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// mutation
// ---------------------------------------------------------------------------

/** Drop the oldest journal entries. Newest-first, so we keep the head. */
function compact(crumb, { max = DEFAULT_JOURNAL_MAX } = {}) {
  if (crumb.journal.length > max) crumb.journal = crumb.journal.slice(0, max);
  return crumb;
}

/** Prepend one journal entry, then compact. This is the per-turn write. */
function appendJournal(crumb, entry, { max = DEFAULT_JOURNAL_MAX } = {}) {
  crumb.journal.unshift(Object.assign({ extra: [] }, entry));
  crumb.hasJournal = true;
  return compact(crumb, { max });
}

/** Replace the durable region from a parsed crumb-shaped document. */
function setDurable(crumb, source) {
  for (const heading of SECTION_ORDER) {
    if (source.sections.has(heading)) crumb.sections.set(heading, source.sections.get(heading));
  }
  if (source.unknownSections.length) crumb.unknownSections = source.unknownSections;
  return crumb;
}

/**
 * Upgrade a v0 crumb in place: the old
 * `Updated: … | Agent: … | Branch: … | HEAD: …` stamp becomes frontmatter, and
 * `## Last conversation` becomes the first journal entry.
 */
function migrate(crumb) {
  if (crumb.frontmatter.spec === SPEC) return crumb;

  const stamp =
    /Updated:\s*([^|]*?)\s*\|\s*Agent:\s*([^|]*?)\s*\|\s*Branch:\s*([^|]*?)\s*\|\s*HEAD:\s*(\S*)/.exec(
      crumb.preamble || ''
    );

  const fallback = (v, alt) =>
    !v || v === '—' || v === 'never' || v === 'none' ? alt : v;

  const carried = crumb.frontmatter;
  crumb.frontmatter = Object.assign(
    {
      spec: SPEC,
      updated: fallback(stamp && stamp[1], new Date().toISOString()),
      agent: fallback(stamp && stamp[2], 'unknown'),
      branch: fallback(stamp && stamp[3], 'unknown'),
      head: fallback(stamp && stamp[4], 'unknown'),
    },
    carried
  );
  crumb.frontmatter.spec = SPEC;
  crumb.keyOrder = Object.keys(crumb.frontmatter);
  crumb.spec = SPEC;
  crumb.preamble = '';

  const legacy = crumb.unknownSections.findIndex((s) => s.heading === 'Last conversation');
  if (legacy !== -1) {
    const [old] = crumb.unknownSections.splice(legacy, 1);
    const field = (name) => {
      const m = new RegExp(`\\*\\*${name}:\\*\\*\\s*(.*)`).exec(old.body);
      return m ? m[1].trim() : null;
    };
    const did = [field('Did'), field('Result')].filter(Boolean).join(' — ');
    if (did || field('Asked')) {
      crumb.journal.unshift({
        ts: String(crumb.frontmatter.updated).slice(0, 16),
        agent: crumb.frontmatter.agent,
        head: crumb.frontmatter.head,
        did: did || field('Asked'),
        next: null,
        extra: [],
      });
    }
  }

  // A v0 file has no Next; seed the required sections so the next save has
  // something to overwrite rather than the loader seeing a malformed crumb.
  if (!crumb.sections.has('Objective')) {
    crumb.sections.set('Objective', 'unknown — migrated from a v0 crumb');
  }
  if (!crumb.sections.has('State')) {
    crumb.sections.set('State', '**Doing:** unknown\n**Blocked:** none\n**Next:** unknown');
  }
  crumb.hasJournal = true;

  return crumb;
}

/** An empty, structurally valid shell. */
function empty() {
  return {
    spec: SPEC,
    frontmatter: { spec: SPEC },
    keyOrder: ['spec'],
    preamble: '',
    sections: new Map(),
    unknownSections: [],
    journal: [],
    hasJournal: true,
  };
}

module.exports = {
  SPEC,
  KNOWN_KEYS,
  SECTION_ORDER,
  JOURNAL,
  REQUIRED_SECTIONS,
  TEST_STATES,
  MAX_LINES,
  DEFAULT_JOURNAL_MAX,
  parse,
  stringify,
  validate,
  compact,
  appendJournal,
  setDurable,
  migrate,
  empty,
};
