'use strict';

/**
 * Smoke test: run the installer against throwaway directories and assert the
 * things that would actually hurt if they broke — clobbering a live handoff,
 * duplicating blocks on re-run, or trashing an existing settings.json.
 *
 * No framework. `node test/smoke.js`, exit 0 means pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'handoffkit.js');

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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'handoffkit-test-'));
const run = (cwd, args = []) =>
  execFileSync(process.execPath, [CLI, 'init', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
const read = (d, p) => fs.readFileSync(path.join(d, p), 'utf8');
const has = (d, p) => fs.existsSync(path.join(d, p));

console.log('\nhandoffkit smoke test\n');

check('fresh install writes every expected file', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  for (const p of [
    'last_handoff.md',
    '.gitignore',
    'AGENTS.md',
    '.claude/skills/handoffkit-save/SKILL.md',
    '.claude/skills/handoffkit-load/SKILL.md',
    '.claude/hooks/handoffkit-reminder.sh',
    '.claude/settings.json',
  ]) {
    assert.ok(has(d, p), `missing ${p}`);
  }
});

check('an existing last_handoff.md is never overwritten', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  const live = '# Handoff\n\nreal work in progress, do not lose me\n';
  fs.writeFileSync(path.join(d, 'last_handoff.md'), live);
  run(d);
  assert.strictEqual(read(d, 'last_handoff.md'), live);
});

check('re-running does not duplicate the AGENTS.md block', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  run(d);
  run(d);
  const agents = read(d, 'AGENTS.md');
  const opens = agents.split('<!-- BEGIN handoffkit -->').length - 1;
  assert.strictEqual(opens, 1, `found ${opens} blocks`);
});

check('re-running does not duplicate the gitignore entry', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  run(d);
  run(d);
  const hits = read(d, '.gitignore')
    .split(/\r?\n/)
    .filter((l) => l.trim() === 'last_handoff.md').length;
  assert.strictEqual(hits, 1, `found ${hits} entries`);
});

check('existing AGENTS.md content is preserved', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, 'AGENTS.md'), '# House rules\n\nDo not touch me.\n');
  run(d);
  const agents = read(d, 'AGENTS.md');
  assert.ok(agents.includes('Do not touch me.'), 'original content lost');
  assert.ok(agents.includes('handoffkit-save'), 'block not added');
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
    e.hooks.some((h) => h.command.includes('handoffkit-reminder'))
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
  assert.ok(!has(d, 'last_handoff.md'), 'dry run created files');
  assert.ok(!has(d, '.claude'), 'dry run created .claude');
});

check('a non-git directory still gets the agent files', () => {
  const d = tmp();
  run(d);
  assert.ok(has(d, 'last_handoff.md'), 'handoff missing');
  assert.ok(!has(d, '.gitignore'), 'gitignore written outside a repo');
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}\n`);
