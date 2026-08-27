'use strict';

const path = require('path');
const f = require('../lib/files');

/**
 * Codex integration.
 *
 * Codex reads AGENTS.md natively, and universal.js already writes the protocol
 * block there — so the loop works with no adapter at all. What this adds is the
 * two custom prompts, so `/repocrumb-load` and `/repocrumb-save` are one
 * keystroke the way they are in Claude Code.
 */

const PROMPTS = ['repocrumb-load', 'repocrumb-save'];

function install(ctx) {
  const { root, dryRun, report, templates } = ctx;

  for (const name of PROMPTS) {
    const rel = `.codex/prompts/${name}.md`;
    const body = f.readRequired(path.join(templates, 'codex', 'prompts', `${name}.md`));
    report(rel, f.write(path.join(root, rel), body, { dryRun }));
  }
}

module.exports = { install };
