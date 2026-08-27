'use strict';

/**
 * SAVE — the per-turn write.
 *
 * The whole point of the split file is that a normal turn touches four lines.
 * The agent supplies two short strings (--did, --next) and this stamps every
 * fact itself from git. The durable region is only rewritten when the agent
 * explicitly pipes a replacement in via `--state -`, which it should do only
 * when the objective, decisions or key files actually changed.
 *
 * No fact in the frontmatter is ever typed by a model. That is what makes the
 * saved state verifiable instead of merely plausible.
 */

const { execSync } = require('child_process');
const crumbLib = require('../lib/crumb');
const store = require('../lib/store');
const git = require('../lib/git');
const config = require('../lib/config');
const log = require('../lib/log');

function readStdin() {
  const fs = require('fs');
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Run the configured test command and classify the outcome. Opt-in only —
 * saving a crumb must never surprise-execute something on the user's machine.
 */
function runTests(cmd, root) {
  try {
    execSync(cmd, { cwd: root, stdio: 'ignore' });
    return 'pass';
  } catch {
    return 'fail';
  }
}

const PLACEHOLDER = 'not recorded yet — the next save with --state should fill this in';

/**
 * `**Next:**` inside `## State` is the one durable line that legitimately
 * changes every turn, and it is the line a reader who stops early depends on.
 * Keep it in step with --next so the top of the file never disagrees with the
 * newest journal entry.
 */
function syncState(doc, next) {
  const body = doc.sections.get('State');

  if (body === undefined) {
    doc.sections.set(
      'State',
      `**Doing:** ${PLACEHOLDER}\n**Blocked:** none\n**Next:** ${next || 'unknown'}`
    );
    return;
  }
  if (!next) return;

  const lines = body.split('\n');
  const at = lines.findIndex((l) => /^\*\*Next:\*\*/.test(l.trim()));
  if (at === -1) lines.push(`**Next:** ${next}`);
  else lines[at] = `**Next:** ${next}`;
  doc.sections.set('State', lines.join('\n'));
}

function run({ root, did, next, agent, state = false, test = false, dryRun = false }) {
  if (!did) throw new Error('save needs --did "<what this turn did>"');

  const cfg = config.load(root);
  const loaded = store.load(root);

  if (loaded.state === 'malformed') {
    throw new Error(`${store.CRUMB_FILE} could not be parsed (${loaded.error}) — fix or delete it`);
  }

  let doc = loaded.state === 'ok' ? loaded.doc : crumbLib.empty();
  if (loaded.state === 'ok' && doc.frontmatter.spec !== crumbLib.SPEC) {
    doc = crumbLib.migrate(doc);
    log.info(log.dim('  migrated an older crumb to crumb/1'));
  }

  // Durable region, only when the caller says it changed.
  if (state) {
    const raw = readStdin();
    if (!raw.trim()) throw new Error('--state was given but stdin was empty');
    crumbLib.setDurable(doc, crumbLib.parse(raw));
  }

  if (!doc.sections.has('Objective')) doc.sections.set('Objective', PLACEHOLDER);
  syncState(doc, next);

  const updated = store.localIso();
  const who = store.agentId(agent);
  const inRepo = git.isRepo(root);

  doc.frontmatter.spec = crumbLib.SPEC;
  doc.frontmatter.updated = updated;
  doc.frontmatter.agent = who;
  doc.frontmatter.branch = (inRepo && git.branch(root)) || 'none';
  doc.frontmatter.head = (inRepo && git.head(root)) || 'none';

  if (test) {
    if (!cfg.test) throw new Error(`--test needs a "test" command in ${config.CONFIG_FILE}`);
    doc.frontmatter.tests = runTests(cfg.test, root);
    doc.frontmatter.tests_cmd = cfg.test;
  } else if (!doc.frontmatter.tests) {
    doc.frontmatter.tests = 'unknown';
  } else {
    // A previous run's result is stale the moment the tree changes. Say so
    // rather than carrying a green flag forward into a turn that didn't test.
    doc.frontmatter.tests = 'unknown';
  }

  crumbLib.appendJournal(
    doc,
    { ts: updated.slice(0, 16), agent: who, head: doc.frontmatter.head, did, next: next || null },
    { max: cfg.journalMax }
  );

  const check = crumbLib.validate(doc);
  const outcome = store.save(root, doc, { dryRun });

  if (dryRun) log.info(log.dim(`  would ${outcome} ${store.CRUMB_FILE}`));
  else log.info(`  ${log.green('saved')} ${store.CRUMB_FILE} @${doc.frontmatter.head} (${doc.journal.length} journal entries)`);

  for (const e of check.errors) log.warn(e);
  for (const w of check.warnings) log.warn(w);

  return 0;
}

module.exports = { run };
