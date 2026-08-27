'use strict';

/**
 * VERIFY — how much should the reader trust the notes it just read?
 *
 * This is not a git status report. Git can already tell you everything about
 * the present; what it cannot tell you is *when the notes were written*, and
 * therefore what has happened to the code since. That is the only thing the
 * crumb's frontmatter exists to record, and the only thing this command
 * computes: the distance between the anchor and now.
 *
 * Exit codes are part of the protocol:
 *   0  the notes still describe the code in front of you
 *   3  work has landed since the notes were written
 *   4  crumb is missing, unparseable or structurally invalid
 */

const path = require('path');
const store = require('../lib/store');
const crumbLib = require('../lib/crumb');
const git = require('../lib/git');
const config = require('../lib/config');
const log = require('../lib/log');

const OK = 0;
const DRIFT = 3;
const UNUSABLE = 4;

/** Build a machine-readable report. Never throws for repo-state reasons. */
function inspect(root, { cfg = null } = {}) {
  const conf = cfg || config.load(root);
  const loaded = store.load(root);

  if (loaded.state !== 'ok') {
    return {
      status: 'unusable',
      code: UNUSABLE,
      reason: loaded.state,
      error: loaded.error || null,
      path: loaded.path,
      drift: [],
    };
  }

  const doc = loaded.doc;
  const validation = crumbLib.validate(doc);
  if (!validation.ok) {
    return {
      status: 'unusable',
      code: UNUSABLE,
      reason: 'invalid',
      errors: validation.errors,
      path: loaded.path,
      drift: [],
    };
  }

  const recorded = {
    head: doc.frontmatter.head,
    branch: doc.frontmatter.branch,
    updated: doc.frontmatter.updated,
    agent: doc.frontmatter.agent || 'unknown',
    tests: doc.frontmatter.tests || 'unknown',
  };

  const inRepo = git.isRepo(root);
  const current = {
    head: inRepo ? git.head(root) : null,
    branch: inRepo ? git.branch(root) : null,
  };

  const drift = [];

  if (inRepo) {
    if (current.branch && recorded.branch && current.branch !== recorded.branch) {
      drift.push({
        kind: 'branch',
        detail: `the notes were written on "${recorded.branch}" — you are on "${current.branch}", so they may be about other work`,
      });
    }

    if (current.head && recorded.head && current.head !== recorded.head) {
      const known = git.hasCommit(recorded.head, root);
      const commits = known ? git.logRange(recorded.head, root) : null;
      const n = commits ? commits.length : 0;
      drift.push({
        kind: 'head',
        detail: known
          ? `${n} commit${n === 1 ? '' : 's'} landed (${recorded.head} -> ${current.head})`
          : `the anchor commit ${recorded.head} is not in this repo — rebased, or a different clone. The notes cannot be placed in history.`,
        commits: commits || [],
      });
    }
  } else {
    drift.push({ kind: 'no-repo', detail: 'not a git repository — the notes cannot be placed in history' });
  }

  if (conf.verifyKeyFiles) {
    const missing = store
      .keyFiles(doc)
      .filter((rel) => !store.exists(path.resolve(root, rel)));
    if (missing.length) {
      drift.push({
        kind: 'key-files',
        detail: `no longer exist, though the notes list them under Key files: ${missing.join(', ')}`,
        files: missing,
      });
    }
  }

  if (recorded.tests === 'fail') {
    drift.push({ kind: 'tests', detail: 'the suite was failing at the anchor commit' });
  }

  return {
    status: drift.length ? 'drift' : 'ok',
    code: drift.length ? DRIFT : OK,
    path: loaded.path,
    recorded,
    current,
    warnings: validation.warnings,
    drift,
  };
}

/** Human-readable verdict. Kept short — an agent pastes this into its context. */
function render(report) {
  const lines = [];

  if (report.status === 'unusable') {
    if (report.reason === 'missing') {
      lines.push('FRESHNESS: no crumb — this repo has no saved handoff notes.');
      lines.push('Start fresh, and save some when you finish.');
    } else if (report.reason === 'malformed') {
      lines.push(`FRESHNESS: crumb could not be parsed — ${report.error}`);
    } else {
      lines.push('FRESHNESS: crumb is not a valid crumb/1 document:');
      for (const e of report.errors) lines.push(`  - ${e}`);
      lines.push('Run `repocrumb migrate` if this is an older crumb.');
    }
    return lines.join('\n');
  }

  const { recorded } = report;
  lines.push(
    `FRESHNESS: these notes were written ${recorded.updated} by ${recorded.agent}, ` +
      `describing ${recorded.branch} @${recorded.head} (tests ${recorded.tests}).`
  );

  if (report.status === 'ok') {
    lines.push('Nothing has landed since. They describe the code in front of you.');
  } else {
    lines.push('Since then:');
    for (const d of report.drift) {
      lines.push(`  - ${d.detail}`);
      for (const c of d.commits || []) lines.push(`      ${c}`);
    }
    lines.push('Weigh what you read above against that, and say so before acting on it.');
  }

  for (const w of report.warnings || []) lines.push(`  ! ${w}`);
  return lines.join('\n');
}

function run({ root, json = false }) {
  const report = inspect(root);
  if (json) console.log(JSON.stringify(report, null, 2));
  else log.info(render(report));
  return report.code;
}

module.exports = { run, inspect, render, OK, DRIFT, UNUSABLE };
