'use strict';

const path = require('path');
const f = require('../lib/files');

const HOOK_REL = '.claude/hooks/handoffkit-reminder.sh';
const HOOK_COMMAND = `bash "$CLAUDE_PROJECT_DIR/${HOOK_REL}"`;

const SKILLS = ['handoffkit-save', 'handoffkit-load'];

/**
 * Claude Code integration: the two skills, the Stop hook, and the settings
 * entry that wires the hook up.
 *
 * Skills and the hook script are package-owned, so they're overwritten on
 * re-run to pick up template fixes. settings.json is user-owned and is merged.
 */
function install(ctx) {
  const { root, dryRun, report, templates } = ctx;

  for (const skill of SKILLS) {
    const rel = `.claude/skills/${skill}/SKILL.md`;
    const body = f.readRequired(path.join(templates, 'claude', 'skills', skill, 'SKILL.md'));
    report(rel, f.write(path.join(root, rel), body, { dryRun }));
  }

  const hookBody = f.readRequired(path.join(templates, 'claude', 'hooks', 'handoffkit-reminder.sh'));
  const hookAbs = path.join(root, HOOK_REL);
  const hookOutcome = f.write(hookAbs, hookBody, { dryRun });
  // chmod is a no-op on Windows and harmless elsewhere; the hook is invoked
  // via `bash <path>` anyway, so this is belt-and-braces for direct execution.
  if (!dryRun && hookOutcome !== 'same') {
    try {
      require('fs').chmodSync(hookAbs, 0o755);
    } catch {
      /* non-fatal */
    }
  }
  report(HOOK_REL, hookOutcome);

  report('.claude/settings.json', mergeSettings(root, dryRun));
}

/**
 * Add the Stop hook to .claude/settings.json without disturbing anything else
 * in it. Existing keys, other hooks, and other Stop entries all survive.
 */
function mergeSettings(root, dryRun) {
  const rel = '.claude/settings.json';
  const abs = path.join(root, rel);

  const settings = f.readJson(abs) || {};

  settings.hooks = settings.hooks || {};
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];

  const alreadyWired = settings.hooks.Stop.some(
    (entry) =>
      Array.isArray(entry && entry.hooks) &&
      entry.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes('handoffkit-reminder'))
  );
  if (alreadyWired) return 'same';

  settings.hooks.Stop.push({
    hooks: [
      {
        type: 'command',
        command: HOOK_COMMAND,
        shell: 'bash',
        timeout: 10,
        statusMessage: 'Checking handoff...',
      },
    ],
  });

  return f.writeJson(abs, settings, { dryRun });
}

module.exports = { install, HOOK_REL };
