'use strict';

const path = require('path');
const f = require('../lib/files');

/**
 * Cursor integration.
 *
 * Cursor has no skill mechanism, so the protocol goes in as an always-applied
 * project rule. One file, `alwaysApply: true`, so the loop is in context for
 * every request rather than waiting to be invoked.
 */

const RULE_REL = '.cursor/rules/repocrumb.mdc';

function install(ctx) {
  const { root, dryRun, report, templates } = ctx;
  const body = f.readRequired(path.join(templates, 'cursor', 'repocrumb.mdc'));
  report(RULE_REL, f.write(path.join(root, RULE_REL), body, { dryRun }));
}

module.exports = { install, RULE_REL };
