'use strict';

const path = require('path');
const fs = require('fs');
const log = require('./lib/log');
const universal = require('./targets/universal');
const claude = require('./targets/claude');
const codex = require('./targets/codex');
const cursor = require('./targets/cursor');

const TEMPLATES = path.join(__dirname, '..', 'templates');

// Provider adapters. Each exposes install(ctx). Adding a new agent means
// adding a module here — nothing else in the CLI has to change.
const TARGETS = {
  claude: { label: 'Claude Code', mod: claude },
  codex: { label: 'Codex', mod: codex },
  cursor: { label: 'Cursor', mod: cursor },
};

function install({ root, dryRun = false, targets = ['claude'] } = {}) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }

  const counts = { create: 0, update: 0, same: 0 };
  const report = (rel, outcome, note) => {
    counts[outcome] = (counts[outcome] || 0) + 1;
    if (dryRun) {
      if (outcome === 'same') log.skipped(rel, note || 'no change');
      else log.planned(rel, outcome === 'create' ? 'create' : 'update');
      return;
    }
    if (outcome === 'create') log.created(rel);
    else if (outcome === 'update') log.updated(rel);
    else log.skipped(rel, note || 'unchanged');
  };

  const ctx = { root, dryRun, report, templates: TEMPLATES };

  log.info('');
  log.info(`${log.bold('repocrumb')} ${dryRun ? log.yellow('(dry run — nothing written)') : ''}`);
  log.info(log.dim(`  ${root}`));
  log.info('');

  universal.install(ctx);

  for (const name of targets) {
    const target = TARGETS[name];
    if (!target) {
      log.warn(`unknown target "${name}" — skipping`);
      continue;
    }
    target.mod.install(ctx);
  }

  log.info('');
  const changed = counts.create + counts.update;
  if (dryRun) {
    log.info(changed ? `  ${changed} file(s) would change.` : '  Nothing to do — already up to date.');
  } else if (changed) {
    log.info(`  ${log.green('Done.')} ${counts.create} created, ${counts.update} updated.`);
    log.info('');
    if (targets.includes('claude')) {
      log.info(`  Restart your agent (or open ${log.cyan('/hooks')} once in Claude Code) so it`);
      log.info('  picks up the new settings, then run ' + log.cyan('/repocrumb-load') + ' to start a session.');
    } else {
      log.info(`  Start a session with ${log.cyan('npx repocrumb load')}.`);
    }
  } else {
    log.info('  Already up to date.');
  }
  log.info('');

  return counts;
}

module.exports = { install, TARGETS };
