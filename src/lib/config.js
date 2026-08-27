'use strict';

/**
 * Optional per-repo config, `.repocrumb.json` at the repo root.
 *
 *   {
 *     "test": "npm test",       // run by `save --test` / `verify --test`
 *     "journalMax": 8,          // entries kept before compaction
 *     "verifyKeyFiles": true    // check paths in ## Key files still exist
 *   }
 *
 * Absent is the normal case. Malformed is an error, not a shrug — readJson
 * already throws rather than let us proceed on a config we couldn't read.
 */

const path = require('path');
const { readJson } = require('./files');
const { DEFAULT_JOURNAL_MAX } = require('./crumb');

const CONFIG_FILE = '.repocrumb.json';
const CRUMB_FILE = 'last_crumb.md';

const DEFAULTS = {
  test: null,
  journalMax: DEFAULT_JOURNAL_MAX,
  verifyKeyFiles: true,
};

function load(root) {
  const raw = readJson(path.join(root, CONFIG_FILE));
  if (raw === null) return Object.assign({}, DEFAULTS);
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${CONFIG_FILE} must be a JSON object`);
  }

  const cfg = Object.assign({}, DEFAULTS, raw);

  if (cfg.test !== null && typeof cfg.test !== 'string') {
    throw new Error(`${CONFIG_FILE}: "test" must be a string command`);
  }
  if (!Number.isInteger(cfg.journalMax) || cfg.journalMax < 1) {
    throw new Error(`${CONFIG_FILE}: "journalMax" must be a positive integer`);
  }

  return cfg;
}

const crumbPath = (root) => path.join(root, CRUMB_FILE);

module.exports = { load, crumbPath, CONFIG_FILE, CRUMB_FILE, DEFAULTS };
