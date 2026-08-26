# handoffkit

Portable agent handoff. Keeps a short `last_handoff.md` in your repo so any AI
coding agent can pick up where the last one stopped — across sessions,
subscriptions, and providers.

```bash
npx handoffkit init
```

## The problem

You have a long working session with an AI agent. It knows the shape of the
project, the three things you already tried, and why you rejected the obvious
approach. Then the session ends, or your subscription changes, or you move to a
different tool — and all of that is gone. You start the next conversation by
re-explaining your own codebase.

Agent memory features don't fix this, because they're per-vendor. The context
lives inside whichever product you were using.

## The approach

One plain markdown file at the root of your repo, `last_handoff.md`, holding a
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

## What gets installed

```
last_handoff.md                          the handoff (never overwritten if it exists)
.gitignore                               adds last_handoff.md
AGENTS.md                                a marked block pointing agents at the skills
.claude/skills/handoffkit-save/          writes the handoff
.claude/skills/handoffkit-load/          reads and verifies it
.claude/hooks/handoffkit-reminder.sh     nudges the agent when the file goes stale
.claude/settings.json                    merged, never replaced
```

Re-running is safe. Everything is idempotent — the `AGENTS.md` block is
marker-delimited and replaced in place, the gitignore entry is added once, and
the Stop hook is only wired up if it isn't already.

**Your existing `last_handoff.md` is never touched.** It's live state, and
clobbering it would defeat the point of the tool.

## Usage

```bash
npx handoffkit init            # install into the current directory
npx handoffkit init ./myapp    # install somewhere else
npx handoffkit init --dry-run  # show what would change, write nothing
npx handoffkit --help
```

After installing, restart your agent — or open `/hooks` once in Claude Code — so
it picks up the new settings.

Then, at the start of any new session:

```
/handoffkit-load
```

That reads the handoff **and checks it against reality**: whether HEAD has moved,
whether the files it names still exist, whether someone worked outside the loop.
Handoff files go stale, and a stale one you trust is worse than none.

From there the agent saves automatically at the end of each turn.

## How the reminder works

The Stop hook is what stops this from quietly degrading in long sessions, where
a soft instruction gets skipped.

It doesn't ask "is the file old?" — a single turn can run for ten minutes and
that proves nothing. It asks whether **anything in `git status` is newer than the
handoff.** If no file has changed since the last save, there's nothing to
record, whatever the clock says.

Two guards keep it from becoming a loop: a wall-clock backstop for repos without
git, and a cooldown so it nudges at most once every ten minutes. Worst case it's
mildly annoying; it can't trap you.

The script is POSIX shell with no dependencies — no `jq` — and works on macOS,
Linux, and Windows via Git Bash. It resolves the git directory with
`git rev-parse --git-common-dir`, so it behaves correctly inside linked
worktrees.

## Agent support

Claude Code today. The installer is structured so other agents are drop-in
adapters (`src/targets/`), and `last_handoff.md` plus `AGENTS.md` are already
readable by anything — those are written regardless of target.

If you want Cursor or Codex support, open an issue or a PR adding a target.

## Requirements

Node 18+. Git optional but recommended — without it the handoff file and agent
files are still written, only the `.gitignore` step is skipped.

## Development

```bash
node test/smoke.js     # no framework, exit 0 means pass
```

## License

MIT
