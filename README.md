![RepoCrumb — Agent A works in the current session and auto-saves a short
last_crumb.md into your repo each turn; Agent B opens a new session, runs
/repocrumb-load, and continues with the progress, decisions, and next steps
intact.](docs/repo_crumb.png)

# RepoCrumb

Leaves a breadcrumb in the repo for the next agent. Keeps a short
`last_crumb.md` in your repo so any AI coding agent can pick up where the last
one stopped — across sessions, tools, and plan changes.

```bash
npx repocrumb init
```

## The problem

You have a long working session with an AI agent. It knows the shape of the
project, the three things you already tried, and why you rejected the obvious
approach. Then the session ends, or your plan changes, or you move to a
different tool — and all of that is gone. You start the next conversation by
re-explaining your own codebase.

Agent memory features don't fix this, because they're per-vendor. The context
lives inside whichever product you were using.

There's a second version of this that happens without you switching anything. A
long conversation fills its context window and gets compacted — the summary
keeps the shape of the work and quietly drops the specifics. Nothing ended,
nothing changed hands, and the agent still knows less than it did an hour ago.

## The approach

One plain markdown file at the root of your repo, `last_crumb.md`, holding a
short snapshot of where the work actually stands. Your agent overwrites it at
the end of every turn. The next agent — same tool or not — reads it and knows
what's going on.

It's deliberately boring: plain markdown, no vendor syntax, under 100 lines. Any
model from any company can read it without special support.

Three properties matter:

- **It's overwritten, not appended.** The file describes the present, not a
  history. Logs grow until nobody reads them.
- **It covers one conversation.** If you run parallel sessions, last writer
  wins. Merging concurrent state is a distributed-systems problem, and this is a
  text file.
- **It's gitignored.** This is your working context, not shared team state.

## Starting fresh instead of compacting

This is the everyday use, and it doesn't involve switching anything.

When a conversation gets long, you don't have to ride it down into compaction.
Let the crumb save, close the session, open a new one, and run
`/repocrumb-load`. You get a full context window and a deliberate summary of
where the work stands — written while the agent still had the details — instead
of an automatic summary of everything that ever happened in the thread.

The difference is what gets kept. Compaction decides for you, under pressure,
with no idea which of the three approaches you rejected still matters. The
crumb was written on purpose, and you can open it and read it.

## What gets installed

```
last_crumb.md                         the crumb (never overwritten if it exists)
.gitignore                            adds last_crumb.md
AGENTS.md                             a marked block pointing agents at the skills
.claude/skills/repocrumb-save/        writes the crumb
.claude/skills/repocrumb-load/        reads and verifies it
.claude/hooks/repocrumb-reminder.sh   nudges the agent when the file goes stale
.claude/settings.json                 merged, never replaced
```

Re-running is safe. Everything is idempotent — the `AGENTS.md` block is
marker-delimited and replaced in place, the gitignore entry is added once, and
the Stop hook is only wired up if it isn't already.

**Your existing `last_crumb.md` is never touched.** It's live state, and
clobbering it would defeat the point of the tool.

## Usage

```bash
npx repocrumb init            # install into the current directory
npx repocrumb init ./myapp    # install somewhere else
npx repocrumb init --dry-run  # show what would change, write nothing
npx repocrumb --help
```

After installing, restart your agent — or open `/hooks` once in Claude Code — so
it picks up the new settings.

Then, at the start of any new session:

```
/repocrumb-load
```

That reads the crumb **and checks it against reality**: whether HEAD has moved,
whether the files it names still exist, whether someone worked outside the loop.
Crumbs go stale, and a stale one you trust is worse than none.

From there the agent saves automatically at the end of each turn.

## How the reminder works

The Stop hook is what stops this from quietly degrading in long sessions, where
a soft instruction gets skipped.

It doesn't ask "is the file old?" — a single turn can run for ten minutes and
that proves nothing. It asks whether **anything in `git status` is newer than the
crumb.** If no file has changed since the last save, there's nothing to
record, whatever the clock says.

Two guards keep it from becoming a loop: a wall-clock backstop for repos without
git, and a cooldown so it nudges at most once every ten minutes. Worst case it's
mildly annoying; it can't trap you.

The script is bash with no dependencies — no `jq` — and works on macOS,
Linux, and Windows via Git Bash. It resolves the git directory with
`git rev-parse --git-common-dir`, so it behaves correctly inside linked
worktrees.

## Agent support

Claude Code today. The installer is structured so other agents are drop-in
adapters (`src/targets/`), and `last_crumb.md` plus `AGENTS.md` are already
readable by anything — those are written regardless of target.

If you want Cursor or Codex support, open an issue or a PR adding a target.

## Privacy

Nothing is sent anywhere. There is no telemetry, no analytics, and no network
access of any kind — the installer writes files and exits, and the hook is a
shell script that reads timestamps. `last_crumb.md` stays on your disk, in
your repo, gitignored by default.

The save skill is instructed never to write secrets into it: no keys, tokens,
`.env` contents, or connection strings. It names things rather than quoting
values. It's still a plain file describing your project, so treat it the way
you'd treat your own notes.

## Requirements

Node 18+. Git optional but recommended — without it the crumb file and agent
files are still written, only the `.gitignore` step is skipped.

## Development

```bash
node test/smoke.js     # no framework, exit 0 means pass
```

## License

MIT

---

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are
trademarks of their respective owners.
