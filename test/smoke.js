'use strict';

/**
 * Smoke test: run the installer against throwaway directories and assert the
 * things that would actually hurt if they broke — clobbering a live crumb,
 * duplicating blocks on re-run, or trashing an existing settings.json.
 *
 * No framework. `node test/smoke.js`, exit 0 means pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'repocrumb.js');

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    process.exitCode = 1;
  }
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'repocrumb-test-'));
const run = (cwd, args = []) =>
  execFileSync(process.execPath, [CLI, 'init', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
const read = (d, p) => fs.readFileSync(path.join(d, p), 'utf8');
const has = (d, p) => fs.existsSync(path.join(d, p));

console.log('\nrepocrumb smoke test\n');

check('fresh install writes every expected file', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  for (const p of [
    'last_crumb.md',
    '.gitignore',
    'AGENTS.md',
    '.claude/skills/repocrumb-save/SKILL.md',
    '.claude/skills/repocrumb-load/SKILL.md',
    '.claude/hooks/repocrumb-reminder.sh',
    '.claude/settings.json',
  ]) {
    assert.ok(has(d, p), `missing ${p}`);
  }
});

check('an existing last_crumb.md is never overwritten', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  const live = '# Crumb\n\nreal work in progress, do not lose me\n';
  fs.writeFileSync(path.join(d, 'last_crumb.md'), live);
  run(d);
  assert.strictEqual(read(d, 'last_crumb.md'), live);
});

check('re-running does not duplicate the AGENTS.md block', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  run(d);
  run(d);
  const agents = read(d, 'AGENTS.md');
  const opens = agents.split('<!-- BEGIN repocrumb -->').length - 1;
  assert.strictEqual(opens, 1, `found ${opens} blocks`);
});

// Counts entries that ignore the crumb, anchored or not — the property under
// test is "exactly one rule", not the spelling of it.
const ignoreHits = (d) =>
  read(d, '.gitignore')
    .split(/\r?\n/)
    .filter((l) => l.trim().replace(/^\/+/, '') === 'last_crumb.md').length;

check('re-running does not duplicate the gitignore entry', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  run(d);
  const hits = ignoreHits(d);
  assert.strictEqual(hits, 1, `found ${hits} entries`);
});

check('the gitignore entry is anchored to the repo root', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  const lines = read(d, '.gitignore').split(/\r?\n/).map((l) => l.trim());
  assert.ok(
    lines.includes('/last_crumb.md'),
    'entry should be /last_crumb.md so it cannot match nested files'
  );
});

check('an unanchored entry is not duplicated', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'node_modules/\nlast_crumb.md\n');
  run(d);
  const hits = ignoreHits(d);
  assert.strictEqual(hits, 1, `found ${hits} entries`);
});

check('existing AGENTS.md content is preserved', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, 'AGENTS.md'), '# House rules\n\nDo not touch me.\n');
  run(d);
  const agents = read(d, 'AGENTS.md');
  assert.ok(agents.includes('Do not touch me.'), 'original content lost');
  assert.ok(agents.includes('repocrumb-save'), 'block not added');
});

check('existing settings.json keys and hooks survive the merge', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  fs.mkdirSync(path.join(d, '.claude'));
  fs.writeFileSync(
    path.join(d, '.claude/settings.json'),
    JSON.stringify(
      {
        env: { MY_VAR: '1' },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
      },
      null,
      2
    )
  );
  run(d);
  const s = JSON.parse(read(d, '.claude/settings.json'));
  assert.strictEqual(s.env.MY_VAR, '1', 'env key lost');
  assert.strictEqual(s.hooks.Stop.length, 2, 'existing Stop hook lost or not appended');
  assert.ok(
    s.hooks.Stop.some((e) => e.hooks.some((h) => h.command === 'echo mine')),
    'pre-existing hook lost'
  );
});

check('the Stop hook is not added twice on re-run', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  run(d);
  const s = JSON.parse(read(d, '.claude/settings.json'));
  const ours = s.hooks.Stop.filter((e) =>
    e.hooks.some((h) => h.command.includes('repocrumb-reminder'))
  );
  assert.strictEqual(ours.length, 1, `found ${ours.length}`);
});

check('malformed settings.json fails loudly instead of being replaced', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  fs.mkdirSync(path.join(d, '.claude'));
  const broken = '{ this is not json';
  fs.writeFileSync(path.join(d, '.claude/settings.json'), broken);
  assert.throws(() => run(d), /not valid JSON|Command failed/);
  assert.strictEqual(read(d, '.claude/settings.json'), broken, 'broken file was overwritten');
});

check('--dry-run writes nothing', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d, ['--dry-run']);
  assert.ok(!has(d, 'last_crumb.md'), 'dry run created files');
  assert.ok(!has(d, '.claude'), 'dry run created .claude');
});

check('a non-git directory still gets the agent files', () => {
  const d = tmp();
  run(d);
  assert.ok(has(d, 'last_crumb.md'), 'crumb missing');
  assert.ok(!has(d, '.gitignore'), 'gitignore written outside a repo');
});

/**
 * Hook decision tests. The installer tests above only prove the file lands;
 * these prove it decides correctly, which is where the real bugs live.
 *
 * Each builds a throwaway git repo, runs the hook with a synthetic payload,
 * and asserts on stdout: empty means "let the turn end", JSON means "nudge".
 */
const HOOK = path.join(__dirname, '..', 'templates', 'claude', 'hooks', 'repocrumb-reminder.sh');

const gitRepo = () => {
  const d = fs.realpathSync(tmp());
  const git = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'work.txt'), 'hi\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return d;
};

// Run the hook the way Claude Code does: payload on stdin, project dir in env.
const hook = (d, payload = {}) =>
  execFileSync('bash', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false, ...payload }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: d },
  }).trim();

// Make the crumb look older than the work, without sleeping.
const ageCrumb = (d, seconds) => {
  const t = Date.now() / 1000 - seconds;
  fs.utimesSync(path.join(d, 'last_crumb.md'), t, t);
};

// Model "a save just happened". Needed because install writes the seed crumb
// FIRST and .gitignore/AGENTS.md/.claude after it, so if the install straddles
// a second boundary those files are legitimately newer and the hook nudges.
// That is correct behaviour on a fresh install; it just isn't what these
// cases are testing.
const freshenCrumb = (d) => {
  const t = Date.now() / 1000 + 1;
  fs.utimesSync(path.join(d, 'last_crumb.md'), t, t);
};

check('hook stays quiet when nothing changed since the save', () => {
  const d = gitRepo();
  run(d);
  freshenCrumb(d);
  assert.strictEqual(hook(d), '', 'nudged with no new work');
});

check('hook nudges when tracked work is newer than the crumb', () => {
  const d = gitRepo();
  run(d);
  ageCrumb(d, 60);
  fs.appendFileSync(path.join(d, 'work.txt'), 'edit\n');
  const out = hook(d);
  assert.ok(out.includes('"decision":"block"'), `expected a block, got: ${out}`);
  assert.ok(out.includes('last_crumb.md'), 'reason should name the crumb');
  assert.ok(out.includes('repocrumb-save'), 'reason should name the save skill');
});

// The regression this suite exists for. A nudge the model ignored used to arm
// a 10-minute cooldown, so the NEXT turn ending stale got no nudge at all.
check('an ignored nudge does not mute the next turn', () => {
  const d = gitRepo();
  run(d);
  ageCrumb(d, 60);
  fs.appendFileSync(path.join(d, 'work.txt'), 'edit\n');

  assert.ok(hook(d).includes('"decision":"block"'), 'first nudge missing');
  // Model ignored it: crumb still stale, more work landed, new turn.
  fs.appendFileSync(path.join(d, 'work.txt'), 'more\n');
  assert.ok(hook(d).includes('"decision":"block"'), 'second turn was muted');
});

// The loop guard that replaced the cooldown: never block twice inside one
// stop cycle, however stale the crumb is.
check('hook never blocks twice within one stop cycle', () => {
  const d = gitRepo();
  run(d);
  ageCrumb(d, 60);
  fs.appendFileSync(path.join(d, 'work.txt'), 'edit\n');

  assert.ok(hook(d).includes('"decision":"block"'), 'first nudge missing');
  assert.strictEqual(hook(d, { stop_hook_active: true }), '', 'blocked inside its own continuation');
});

check('hook tolerates whitespace in the stop_hook_active field', () => {
  const d = gitRepo();
  run(d);
  ageCrumb(d, 60);
  fs.appendFileSync(path.join(d, 'work.txt'), 'edit\n');
  const out = execFileSync('bash', [HOOK], {
    encoding: 'utf8',
    input: '{ "hook_event_name": "Stop", "stop_hook_active" : true }',
    env: { ...process.env, CLAUDE_PROJECT_DIR: d },
  }).trim();
  assert.strictEqual(out, '', 'pretty-printed payload was not recognised');
});

check('hook survives an empty payload without looping', () => {
  const d = gitRepo();
  run(d);
  freshenCrumb(d);
  assert.strictEqual(
    execFileSync('bash', [HOOK], {
      encoding: 'utf8',
      input: '',
      env: { ...process.env, CLAUDE_PROJECT_DIR: d },
    }).trim(),
    '',
    'no stdin should still be safe'
  );
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}\n`);
