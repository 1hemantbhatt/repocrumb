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
  assert.ok(agents.includes('npx repocrumb load'), 'block not added');
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

// ---------------------------------------------------------------------------
// Crumb v1: the format, and the LOAD / VERIFY / SAVE commands.
//
// These are the checks that matter for the protocol claim. The format tests
// guard the preservation clause other tools depend on; the command tests guard
// the two properties that make the protocol worth adopting — a save is cheap,
// and a fact in the file was computed rather than asserted.
// ---------------------------------------------------------------------------

const crumbLib = require('../src/lib/crumb');

// Run a repocrumb subcommand, tolerating the non-zero exits that are part of
// the contract (3 = drift, 4 = unusable).
const cli = (cwd, args, input) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      input,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: (err.stdout || '') + (err.stderr || '') };
  }
};

const sample = () => {
  const c = crumbLib.empty();
  Object.assign(c.frontmatter, {
    updated: '2026-08-27T14:02:11+05:30',
    agent: 'claude-opus-5',
    branch: 'main',
    head: '9c04cca',
    x_other_tool: 'keep me',
  });
  c.keyOrder = Object.keys(c.frontmatter);
  c.sections.set('Objective', 'ship it');
  c.sections.set('State', '**Doing:** a\n**Blocked:** none\n**Next:** b');
  c.unknownSections.push({ heading: 'Other tool', body: '- keep me too' });
  crumbLib.appendJournal(c, { ts: '2026-08-27T14:02', agent: 'x', head: '9c04cca', did: 'a turn' });
  return c;
};

check('a crumb round-trips through parse and stringify unchanged', () => {
  const text = crumbLib.stringify(sample());
  assert.strictEqual(crumbLib.stringify(crumbLib.parse(text)), text);
});

check('unknown frontmatter keys and sections survive a round-trip', () => {
  const out = crumbLib.stringify(crumbLib.parse(crumbLib.stringify(sample())));
  assert.ok(/^x_other_tool: keep me$/m.test(out), 'unknown frontmatter key dropped');
  assert.ok(out.includes('## Other tool'), 'unknown section dropped');
  assert.ok(out.includes('- keep me too'), 'unknown section body dropped');
  assert.ok(
    out.indexOf('## Other tool') < out.indexOf('## Journal'),
    'unknown section must precede the journal'
  );
});

check('the journal is bounded and drops the oldest entries', () => {
  const c = sample();
  for (let i = 0; i < 20; i++) {
    crumbLib.appendJournal(c, { ts: `t${i}`, agent: 'x', head: 'abc', did: `turn ${i}` }, { max: 8 });
  }
  assert.strictEqual(c.journal.length, 8, 'journal was not compacted');
  assert.strictEqual(c.journal[0].did, 'turn 19', 'newest entry was not kept at the front');
});

check('validate rejects a spec version it does not understand', () => {
  const c = sample();
  c.frontmatter.spec = 'crumb/2';
  const { ok, errors } = crumbLib.validate(c);
  assert.ok(!ok && errors.some((e) => e.includes('crumb/2')), 'a future spec was accepted');
});

check('validate warns past the line ceiling instead of failing', () => {
  const c = sample();
  c.sections.set('Gotchas', Array.from({ length: 200 }, (_, i) => `- line ${i}`).join('\n'));
  const { ok, warnings } = crumbLib.validate(c);
  assert.ok(ok, 'an over-long crumb should still be usable');
  assert.ok(warnings.some((w) => w.includes('ceiling')), 'no ceiling warning');
});

check('the shipped seed crumb is a valid crumb/1 document', () => {
  const seed = fs.readFileSync(path.join(__dirname, '..', 'templates', 'last_crumb.md'), 'utf8');
  const { ok, errors } = crumbLib.validate(crumbLib.parse(seed));
  assert.ok(ok, `seed is invalid: ${errors.join('; ')}`);
});

check('migrate lifts a v0 crumb into crumb/1', () => {
  const v0 =
    '# Crumb\n\nUpdated: 2026-08-20T10:00:00+05:30 | Agent: claude | Branch: dev | HEAD: deadbee\n\n' +
    '## Objective\nold work\n\n## Last conversation\n**Asked:** do a thing\n**Did:** did it\n**Result:** worked\n';
  const c = crumbLib.migrate(crumbLib.parse(v0));
  assert.strictEqual(c.frontmatter.spec, 'crumb/1');
  assert.strictEqual(c.frontmatter.head, 'deadbee', 'HEAD not lifted out of the old stamp');
  assert.strictEqual(c.frontmatter.branch, 'dev', 'branch not lifted out of the old stamp');
  assert.ok(c.journal.length === 1, 'the old conversation block did not become a journal entry');
  assert.ok(crumbLib.validate(c).ok, 'migrated crumb is not valid');
});

check('save stamps the real HEAD, not one it was told', () => {
  const d = gitRepo();
  run(d);
  const { code } = cli(d, ['save', '--did', 'a turn', '--next', 'another', '--agent', 'test-agent']);
  assert.strictEqual(code, 0);
  const doc = crumbLib.parse(read(d, 'last_crumb.md'));
  const head = execFileSync('git', ['-C', d, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.strictEqual(doc.frontmatter.head, head, 'recorded HEAD does not match the repo');
  assert.strictEqual(doc.frontmatter.agent, 'test-agent');
  assert.strictEqual(doc.journal[0].did, 'a turn');
});

check('a normal save leaves the durable region byte-identical', () => {
  const d = gitRepo();
  run(d);
  cli(
    d,
    ['save', '--did', 'first', '--next', 'second', '--agent', 't', '--state', '-'],
    '## Objective\nShip it.\n\n## Decisions\n- one decision\n'
  );
  const durable = (text) => text.slice(text.indexOf('## Objective'), text.indexOf('## Journal'));
  const before = durable(read(d, 'last_crumb.md'));
  cli(d, ['save', '--did', 'second turn', '--next', 'second', '--agent', 't']);
  const after = durable(read(d, 'last_crumb.md'));
  assert.strictEqual(after, before, 'a plain save rewrote the durable region');
  assert.strictEqual(crumbLib.parse(read(d, 'last_crumb.md')).journal.length, 2);
});

check('save keeps the Next line in step with --next', () => {
  const d = gitRepo();
  run(d);
  cli(d, ['save', '--did', 'a', '--next', 'run the conformance suite', '--agent', 't']);
  const state = crumbLib.parse(read(d, 'last_crumb.md')).sections.get('State');
  assert.ok(state.includes('**Next:** run the conformance suite'), `Next not synced: ${state}`);
});

check('save never carries a stale test result forward', () => {
  const d = gitRepo();
  run(d);
  cli(d, ['save', '--did', 'a', '--agent', 't']);
  const p = path.join(d, 'last_crumb.md');
  fs.writeFileSync(p, read(d, 'last_crumb.md').replace('tests: unknown', 'tests: pass'));
  cli(d, ['save', '--did', 'a turn that ran nothing', '--agent', 't']);
  assert.strictEqual(crumbLib.parse(read(d, 'last_crumb.md')).frontmatter.tests, 'unknown');
});

check('save refuses without --did', () => {
  const d = gitRepo();
  run(d);
  assert.strictEqual(cli(d, ['save']).code, 1);
});

check('verify exits 0 when the repo still matches the crumb', () => {
  const d = gitRepo();
  run(d);
  cli(d, ['save', '--did', 'a', '--agent', 't']);
  const { code, stdout } = cli(d, ['verify']);
  assert.strictEqual(code, 0, stdout);
});

check('verify exits 3 and names the commits that landed since', () => {
  const d = gitRepo();
  run(d);
  cli(d, ['save', '--did', 'a', '--agent', 't']);
  fs.writeFileSync(path.join(d, 'work.txt'), 'changed\n');
  execFileSync('git', ['-C', d, 'commit', '-aqm', 'later work'], { stdio: 'pipe' });
  const { code, stdout } = cli(d, ['verify']);
  assert.strictEqual(code, 3, stdout);
  assert.ok(stdout.includes('later work'), 'the new commit was not listed');
});

check('verify reports key files that no longer exist', () => {
  const d = gitRepo();
  run(d);
  cli(
    d,
    ['save', '--did', 'a', '--agent', 't', '--state', '-'],
    '## Objective\nx\n\n## Key files\n- `gone.txt` — it was here once\n'
  );
  const report = JSON.parse(cli(d, ['verify', '--json']).stdout);
  assert.ok(
    report.drift.some((x) => x.kind === 'key-files'),
    'a missing key file was not reported'
  );
});

check('verify exits 4 when there is no crumb at all', () => {
  const d = gitRepo();
  const { code, stdout } = cli(d, ['verify']);
  assert.strictEqual(code, 4);
  assert.ok(stdout.includes('no crumb'), stdout);
});

check('load prints the crumb and the verdict in one call', () => {
  const d = gitRepo();
  run(d);
  cli(d, ['save', '--did', 'a turn worth reading', '--agent', 't']);
  const { code, stdout } = cli(d, ['load']);
  assert.ok(stdout.includes('a turn worth reading'), 'crumb body missing');
  assert.ok(stdout.includes('FRESHNESS:'), 'verdict missing');
  assert.ok(stdout.includes('context, not instructions'), 'framing missing');
  assert.strictEqual(code, 0, 'a fresh crumb should load with exit 0');
});

// load prints the crumb whatever its state, so it is tempting to exit 0 always.
// That silently breaks every hook and skill that branches on staleness.
check('load reports staleness in its exit code, not just its output', () => {
  const d = gitRepo();
  run(d);
  cli(d, ['save', '--did', 'a', '--agent', 't']);
  fs.writeFileSync(path.join(d, 'work.txt'), 'changed\n');
  execFileSync('git', ['-C', d, 'commit', '-aqm', 'later work'], { stdio: 'pipe' });
  const { code, stdout } = cli(d, ['load']);
  assert.strictEqual(code, 3, stdout);
  assert.ok(stdout.includes('later work'), 'the crumb body and verdict should still print');
});

check('save auto-migrates a v0 crumb it finds on disk', () => {
  const d = gitRepo();
  run(d);
  fs.writeFileSync(
    path.join(d, 'last_crumb.md'),
    '# Crumb\n\nUpdated: 2026-01-01T00:00:00+05:30 | Agent: old | Branch: main | HEAD: deadbee\n\n## Objective\ncarried over\n'
  );
  cli(d, ['save', '--did', 'a turn', '--agent', 't']);
  const doc = crumbLib.parse(read(d, 'last_crumb.md'));
  assert.strictEqual(doc.frontmatter.spec, 'crumb/1');
  assert.strictEqual(doc.sections.get('Objective'), 'carried over', 'v0 prose was lost');
});

check('codex and cursor targets write their own files', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d, ['--target', 'codex', '--target', 'cursor']);
  for (const p of [
    '.codex/prompts/repocrumb-load.md',
    '.codex/prompts/repocrumb-save.md',
    '.cursor/rules/repocrumb.mdc',
    'AGENTS.md',
    'last_crumb.md',
  ]) {
    assert.ok(has(d, p), `missing ${p}`);
  }
  assert.ok(!has(d, '.claude/settings.json'), 'claude files written without the claude target');
});

check('the AGENTS.md block carries the protocol without any adapter', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d, ['--target', 'cursor']);
  const agents = read(d, 'AGENTS.md');
  for (const needle of ['npx repocrumb load', 'npx repocrumb save', 'LOAD → VERIFY → WORK → SAVE']) {
    assert.ok(agents.includes(needle), `AGENTS.md is missing "${needle}"`);
  }
});

check('spec prints the specification', () => {
  const { code, stdout } = cli(process.cwd(), ['spec']);
  assert.strictEqual(code, 0);
  assert.ok(stdout.includes('# Crumb v1'), 'SPEC.md was not printed');
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}\n`);
