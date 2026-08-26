#!/usr/bin/env node
'use strict';

const path = require('path');
const { install, TARGETS } = require('../src/install');
const log = require('../src/lib/log');
const pkg = require('../package.json');

const HELP = `
${log.bold('repocrumb')} — leaves a breadcrumb in the repo for the next agent

  Keeps a short last_crumb.md in your repo so any AI coding agent can pick up
  where the last one stopped, across sessions, tools and plan changes — or so
  you can start a fresh conversation instead of letting a long one compact.

${log.bold('Usage')}
  npx repocrumb init [dir]      Install into <dir> (default: current directory)
  npx repocrumb --help
  npx repocrumb --version

${log.bold('Options')}
  --dry-run          Show what would change without writing anything
  --target <name>    Agent to wire up (repeatable). Default: claude
                     Available: ${Object.keys(TARGETS).join(', ')}

${log.bold('What it writes')}
  last_crumb.md                the crumb itself (never overwritten if present)
  .gitignore                   adds last_crumb.md
  AGENTS.md                    a marked block pointing agents at the skills
  .claude/skills/repocrumb-*   save + load skills
  .claude/hooks/               the Stop hook that keeps the file current
  .claude/settings.json        merged, never replaced

  Re-running is safe. Everything is idempotent.
`;

function parseArgs(argv) {
  const opts = { cmd: null, dir: null, dryRun: false, targets: [] };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { ...opts, cmd: 'help' };
    if (a === '--version' || a === '-v') return { ...opts, cmd: 'version' };
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--target' || a === '-t') {
      const v = argv[++i];
      if (!v) throw new Error('--target needs a value');
      opts.targets.push(v);
    } else if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
    else if (!opts.cmd) opts.cmd = a;
    else if (!opts.dir) opts.dir = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return opts;
}

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
  if (opts.cmd !== 'init') {
    log.error(`unknown command: ${opts.cmd}`);
    console.error(`Try ${log.cyan('npx repocrumb --help')}`);
    process.exit(2);
  }

  const root = path.resolve(opts.dir || process.cwd());

  try {
    install({
      root,
      dryRun: opts.dryRun,
      targets: opts.targets.length ? opts.targets : ['claude'],
    });
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
}

main();
