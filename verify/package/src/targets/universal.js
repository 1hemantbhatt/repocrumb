'use strict';

const path = require('path');
const fs = require('fs');
const f = require('../lib/files');

const CRUMB_FILE = 'last_crumb.md';
// Anchored so it can't also ignore a same-named file elsewhere in the user's
// tree. ensureIgnoreLine compares with leading slashes stripped, so an existing
// unanchored entry from an older install still counts as present.
const IGNORE_ENTRY = `/${CRUMB_FILE}`;
const BLOCK_ID = 'repocrumb';

const AGENTS_BLOCK = `## repocrumb

After finishing each turn, use the \`repocrumb-save\` skill to overwrite
\`${CRUMB_FILE}\` at the repo root — a short snapshot of current state and the
conversation that just happened, under 100 lines. It covers the last
conversation only and is rewritten, never appended to.

To pick up a session, run \`/repocrumb-load\`.`;

/**
 * Files every project gets, whatever agent it uses. These are the reason this
 * ships as an installer rather than a Claude plugin: a plugin lives in the
 * agent's own cache and cannot write into the user's repository.
 */
function install(ctx) {
  const { root, dryRun, report, templates } = ctx;

  // 1. The crumb file itself. Seeded only when absent — an existing one is
  //    live state and overwriting it would defeat the entire tool.
  const crumbPath = path.join(root, CRUMB_FILE);
  const seed = f.readRequired(path.join(templates, 'last_crumb.md'));
  report(
    CRUMB_FILE,
    f.writeIfAbsent(crumbPath, seed, { dryRun }),
    f.exists(crumbPath) ? 'already present, left alone' : null
  );

  // 2. Keep it out of git. It's per-developer working state, not shared truth.
  if (fs.existsSync(path.join(root, '.git'))) {
    report(
      '.gitignore',
      f.ensureIgnoreLine(
        path.join(root, '.gitignore'),
        IGNORE_ENTRY,
        'repocrumb (local working context, not shared state)',
        { dryRun }
      )
    );
  } else {
    report('.gitignore', 'same', 'not a git repo');
  }

  // 3. Tell the agent the system exists. AGENTS.md is the closest thing to a
  //    cross-vendor convention, and CLAUDE.md imports it on Claude Code.
  report(
    'AGENTS.md',
    f.upsertBlock(path.join(root, 'AGENTS.md'), BLOCK_ID, AGENTS_BLOCK, { dryRun })
  );
}

module.exports = { install, CRUMB_FILE, BLOCK_ID };
