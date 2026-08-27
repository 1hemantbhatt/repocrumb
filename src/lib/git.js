'use strict';

/**
 * Thin git wrappers. Every one of these is allowed to fail: a crumb has to
 * work in a directory that isn't a repo, or in a repo with no commits yet.
 * So nothing here throws — callers get null and decide what that means.
 *
 * Arguments go through execFileSync as an array. There is no shell in the
 * loop, so a branch or path containing shell metacharacters is inert.
 */

const { execFileSync } = require('child_process');

function run(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const isRepo = (cwd) => run(['rev-parse', '--git-dir'], cwd) !== null;

/** Short HEAD sha, or null in a repo with no commits. */
function head(cwd) {
  const out = run(['rev-parse', '--short', 'HEAD'], cwd);
  return out === null ? null : out.trim() || null;
}

/** Current branch, or null when detached. */
function branch(cwd) {
  const out = run(['branch', '--show-current'], cwd);
  if (out === null) return null;
  return out.trim() || 'HEAD (detached)';
}

/**
 * Working-tree changes as [{ status, path }]. Uses the NUL-separated porcelain
 * so paths with spaces, quotes or newlines survive; rename and copy records
 * carry a second path field that has to be consumed as part of the same record.
 */
function status(cwd) {
  const out = run(['status', '--porcelain', '-z', '--untracked-files=all'], cwd);
  if (out === null) return null;

  const fields = out.split('\0');
  const changes = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (!record) continue;
    const code = record.slice(0, 2);
    changes.push({ status: code.trim(), path: record.slice(3) });
    // R and C records are followed by the origin path in its own field.
    if (code[0] === 'R' || code[0] === 'C') i++;
  }
  return changes;
}

/** Commits in `from..HEAD`, oldest last, as ["sha subject"]. */
function logRange(from, cwd, { limit = 10 } = {}) {
  if (!from) return null;
  const out = run(['log', '--oneline', `--max-count=${limit}`, `${from}..HEAD`], cwd);
  if (out === null) return null;
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** True when `sha` names a commit that exists in this repo. */
function hasCommit(sha, cwd) {
  if (!sha) return false;
  return run(['cat-file', '-e', `${sha}^{commit}`], cwd) !== null;
}

module.exports = { isRepo, head, branch, status, logRange, hasCommit };
