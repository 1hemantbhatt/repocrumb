#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { install, TARGETS } = require('../src/install');
const log = require('../src/lib/log');
const pkg = require('../package.json');

const HELP = `
${log.bold('repocrumb')} — the Crumb handoff protocol for coding agents

  Keeps a short last_crumb.md in your repo so any AI coding agent can pick up
  where the last one stopped, across sessions, tools and plan changes — or so
  you can start a fresh conversation instead of letting a long one compact.

  Every agent follows the same loop:  ${log.cyan('LOAD → VERIFY → WORK → SAVE')}

${log.bold('Usage')}
  npx repocrumb init [dir]      Install into <dir> (default: current directory)
  npx repocrumb load            Print the crumb plus a freshness verdict
  npx repocrumb verify          Check the saved state against the live repo
  npx repocrumb save --did …    Record this turn (the CLI stamps every fact)
  npx repocrumb migrate         Upgrade a pre-spec crumb to crumb/1
  npx repocrumb spec            Print the Crumb v1 specification

${log.bold('Options')}
  --dry-run, -n      Show what would change without writing anything
  --target <name>    Agent to wire up (repeatable). Default: claude
                     Available: ${Object.keys(TARGETS).join(', ')}
  --json             Machine-readable output (verify)
  --did "<text>"     What this turn did             (save, required)
  --next "<text>"    The single next action         (save)
  --agent <id>       Model/provider id writing this (save; or REPOCRUMB_AGENT)
  --state            Read a replacement durable region from stdin (save)
  --test             Run the configured test command and record the result

${log.bold('Exit codes')}
  0  fine    2  bad usage    3  crumb valid but the repo has drifted
  1  error   4  crumb missing, unparseable or invalid

${log.bold('What init writes')}
  last_crumb.md                the crumb itself (never overwritten if present)
  .gitignore                   adds last_crumb.md
  AGENTS.md                    a marked block pointing agents at the protocol
  .claude/skills/repocrumb-*   save + load skills
  .claude/hooks/               the Stop hook that keeps the file current
  .claude/settings.json        merged, never replaced
  .codex/prompts/, .cursor/rules/   with --target codex / cursor

  Re-running is safe. Everything is idempotent.
`;

const FLAGS = new Set(['--dry-run', '-n', '--json', '--test', '--state']);
const VALUED = new Set(['--target', '-t', '--did', '--next', '--agent']);

function parseArgs(argv) {
  const opts = {
    cmd: null,
    dir: null,
    dryRun: false,
    json: false,
    test: false,
    state: false,
    targets: [],
    did: null,
    next: null,
    agent: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return Object.assign({}, opts, { cmd: 'help' });
    if (a === '--version' || a === '-v') return Object.assign({}, opts, { cmd: 'version' });

    if (FLAGS.has(a)) {
      if (a === '--dry-run' || a === '-n') opts.dryRun = true;
      else if (a === '--json') opts.json = true;
      else if (a === '--test') opts.test = true;
      else opts.state = true;
      continue;
    }

    if (VALUED.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      if (a === '--target' || a === '-t') opts.targets.push(v);
      else if (a === '--did') opts.did = v;
      else if (a === '--next') opts.next = v;
      else opts.agent = v;
      continue;
    }

    // A bare "-" is the conventional spelling of "stdin"; accept it after
    // --state so `--state -` reads the way people expect it to.
    if (a === '-') continue;
    if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);

    if (!opts.cmd) opts.cmd = a;
    else if (!opts.dir) opts.dir = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return opts;
}

const COMMANDS = {
  init: (root, o) => {
    install({
      root,
      dryRun: o.dryRun,
      targets: o.targets.length ? o.targets : ['claude'],
    });
    return 0;
  },
  load: (root) => require('../src/commands/load').run({ root }),
  verify: (root, o) => require('../src/commands/verify').run({ root, json: o.json }),
  save: (root, o) =>
    require('../src/commands/save').run({
      root,
      did: o.did,
      next: o.next,
      agent: o.agent,
      state: o.state,
      test: o.test,
      dryRun: o.dryRun,
    }),
  migrate: (root, o) => require('../src/commands/migrate').run({ root, dryRun: o.dryRun }),
  spec: () => {
    const p = path.join(__dirname, '..', 'SPEC.md');
    if (!fs.existsSync(p)) throw new Error(`missing SPEC.md — broken repocrumb install`);
    console.log(fs.readFileSync(p, 'utf8'));
    return 0;
  },
};

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    log.error(err.message);
    console.error(`Try ${log.cyan('npx repocrumb --help')}`);
    process.exit(2);
  }

  if (opts.cmd === 'help' || opts.cmd === null) {
    console.log(HELP);
    // No command is a usage question, not a failure.
    process.exit(0);
  }
  if (opts.cmd === 'version') {
    console.log(pkg.version);
    process.exit(0);
  }

  const handler = COMMANDS[opts.cmd];
  if (!handler) {
    log.error(`unknown command: ${opts.cmd}`);
    console.error(`Try ${log.cyan('npx repocrumb --help')}`);
    process.exit(2);
  }

  const root = path.resolve(opts.dir || process.cwd());

  try {
    process.exit(handler(root, opts) || 0);
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
}

main();
