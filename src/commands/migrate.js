'use strict';

/**
 * MIGRATE — upgrade a v0 crumb (LLM-written markdown, no frontmatter) to
 * crumb/1 in place. `save` does this automatically; this exists so a user can
 * do it deliberately and see what changed before their next turn.
 */

const crumbLib = require('../lib/crumb');
const store = require('../lib/store');
const log = require('../lib/log');

function run({ root, dryRun = false }) {
  const loaded = store.load(root);

  if (loaded.state === 'missing') {
    log.error(`no ${store.CRUMB_FILE} here — nothing to migrate`);
    return 4;
  }
  if (loaded.state === 'malformed') {
    log.error(`${store.CRUMB_FILE} could not be parsed (${loaded.error})`);
    return 4;
  }
  if (loaded.doc.frontmatter.spec === crumbLib.SPEC) {
    log.info(`  already ${crumbLib.SPEC} — nothing to do`);
    return 0;
  }

  const doc = crumbLib.migrate(loaded.doc);
  const outcome = store.save(root, doc, { dryRun });

  if (dryRun) log.planned(store.CRUMB_FILE, 'update');
  else log.updated(`${store.CRUMB_FILE}  (${outcome} — now ${crumbLib.SPEC})`);

  for (const e of crumbLib.validate(doc).errors) {
    log.warn(`${e} — the next save will fill this in`);
  }
  return 0;
}

module.exports = { run };
