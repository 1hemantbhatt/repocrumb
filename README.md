![repocrumb — Agent A works in the current session and auto-saves a short
last_crumb.md into your repo each turn; Agent B opens a new session, runs
/repocrumb-load, and continues with the progress, decisions, and next steps
intact.](docs/repo_crumb.png)

# repocrumb

**A handoff protocol for coding agents.** One small file in your repo,
`last_crumb.md`, holds the state of work in progress — anchored to a commit, so
you always know how much of it still applies — letting any AI coding agent pick
up where the last one stopped, across sessions, tools and providers.

```bash
npx repocrumb init
```

Every agent follows the same four steps:

```
LOAD  ──▶  VERIFY  ──▶  WORK  ──▶  SAVE  ──┐
  ▲                                        │
  └────────────── next session ────────────┘
```

The format is [**Crumb v1**](SPEC.md). repocrumb is its reference
implementation, not its owner — if your tool reads or writes `last_crumb.md`,
[add yourself to the list](SPEC.md#10-implementations).

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

![Two ways context is lost. One: a session ends, the tool changes, or the
plan changes — Agent A knows the codebase, the three approaches tried, and the
rejected fix, but Agent B starts fresh with none of it. Two: a long
conversation is compacted — the high-level shape survives while decisions,
attempts, edge cases, and nuance are dropped.](docs/last_crumb_problem.png)

And there's a third, quieter problem. A file any agent can read is not the same
as a file every agent handles the same way. Without a spec, "read the crumb"
means whatever each model decides it means — and a summary an LLM wrote about
its own work is exactly the kind of claim you shouldn't take on trust.

## The approach

Crumb v1 splits the file into two parts with different lifetimes.

**A durable region** — objective, state, decisions, key files, gotchas — that is
rewritten only when it actually changes.

**A bounded journal** — one four-line entry per turn, newest first, compacted
automatically.

That split is what makes saving cheap. A normal turn appends about four lines
instead of regenerating a hundred. Reading is cheap for the mirror-image
reason: sections are ordered most-urgent-first, so an agent that stops after
`## State` — roughly twenty lines in — already knows what to do next.

```markdown
---
spec: crumb/1
updated: 2026-08-27T14:02:11+05:30
agent: claude-opus-5
branch: main
head: 9c04cca
tests: pass
---

## Objective
Turn the crumb into a verifiable handoff protocol.

## State
**Doing:** wiring verify into the load skill
**Blocked:** none
**Next:** add the Codex and Cursor targets

## Journal
- 2026-08-27T14:02 claude-opus-5 @9c04cca
  did: added parse/stringify with round-trip preservation
  next: the verify command
```

### The frontmatter is an anchor, not a copy of git

Those four lines are not a snapshot of your repository. Copying git into a file
would be pointless — git is right there, and it's authoritative. What git
*can't* tell you is **when these notes were written**, and without that a reader
has no way to know whether the prose below describes the code in front of it or
code from three days ago.

So the crumb records one point in history, and everything else is derived from
it on demand. That's what makes this possible:

```console
$ repocrumb verify
FRESHNESS: these notes were written 2026-08-27T14:02:11+05:30 by claude-opus-5,
describing main @9c04cca (tests pass).
Since then:
  - 2 commits landed (9c04cca -> 81042af)
      81042af add the cursor target
      a3f0e21 fix the journal bound
  - no longer exist, though the notes list them under Key files: src/old-parser.js
Weigh what you read above against that, and say so before acting on it.
```

That's not a git status report — it's a statement about how much of what you
just read is still true. And the anchor is computed by the CLI, never typed by
the agent: a sha a model typed is indistinguishable from a sha it imagined, and
an anchor that might be imaginary is worse than none.

Exit `0` means the notes describe the current code, `3` means work has landed
since, `4` means there is no usable crumb. Hooks and scripts branch on that
without parsing prose.

### Three properties that keep it simple

- **The durable region is overwritten, not appended.** It describes the present.
  Logs grow until nobody reads them; the journal is bounded for the same reason.
- **It covers one line of work.** If you run parallel sessions, last writer wins
  on the durable region. Merging concurrent state is a distributed-systems
  problem, and this is a text file.
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

## Usage

```bash
npx repocrumb init                 # install into the current directory
npx repocrumb init --dry-run       # show what would change, write nothing
npx repocrumb init -t codex -t cursor

npx repocrumb load                 # the crumb + a freshness verdict, in one call
npx repocrumb verify --json        # just the verdict, machine-readable
npx repocrumb save --did "…" --next "…" --agent claude-opus-5
npx repocrumb migrate              # upgrade a pre-spec crumb to crumb/1
npx repocrumb spec                 # print the specification
```

After installing, restart your agent — or open `/hooks` once in Claude Code — so
it picks up the new settings. Then start any new session with
`/repocrumb-load`, and the agent saves at the end of each turn on its own.

`repocrumb load` is one command on purpose. Picking up a session used to mean a
file read plus three or four git calls, each a separate tool round-trip, with
the model reconciling them by hand. Now it's a single call whose last line is
the verdict.

### Optional config

`.repocrumb.json` at the repo root, all keys optional:

```json
{
  "test": "npm test",
  "journalMax": 8,
  "verifyKeyFiles": true
}
```

`test` is only ever run when you pass `--test`. Saving a crumb should not
execute things on your machine by surprise.

## What gets installed

```
last_crumb.md                         the crumb (never overwritten if it exists)
.gitignore                            adds last_crumb.md
AGENTS.md                             a marked block carrying the protocol
.claude/skills/repocrumb-save/        writes the crumb
.claude/skills/repocrumb-load/        reads and verifies it
.claude/hooks/repocrumb-reminder.sh   nudges the agent when the file goes stale
.claude/settings.json                 merged, never replaced
.codex/prompts/repocrumb-*.md         with --target codex
.cursor/rules/repocrumb.mdc           with --target cursor
```

Re-running is safe. Everything is idempotent — the `AGENTS.md` block is
marker-delimited and replaced in place, the gitignore entry is added once, and
the Stop hook is only wired up if it isn't already.

**Your existing `last_crumb.md` is never touched.** It's live state, and
clobbering it would defeat the point of the tool.

## How the reminder works

The Stop hook is what stops this from quietly degrading in long sessions, where
a soft instruction gets skipped.

It doesn't ask "is the file old?" — a single turn can run for ten minutes and
that proves nothing. It asks whether **anything in `git status` is newer than the
crumb.** If no file has changed since the last save, there's nothing to
record, whatever the clock says.

Two guards keep it from becoming a loop: a wall-clock backstop for repos without
git, and `stop_hook_active` — the flag Claude Code sets when a turn is only
still running because a Stop hook blocked it. Seeing that, the hook stays quiet,
so it nudges at most once per turn and can never trap you in a cycle.

That flag matters more than it sounds. An earlier version used a ten-minute
cooldown instead, which couldn't tell "I just nudged" apart from "a different
turn ended stale a few minutes later" — so a single ignored nudge silenced
every genuine one after it. The reminder was quietly unreliable exactly when
it was needed most.

The script is bash with no dependencies — no `jq` — and works on macOS,
Linux, and Windows via Git Bash. It resolves the git directory with
`git rev-parse --git-common-dir`, so it behaves correctly inside linked
worktrees.

## Agent support

| Agent | Install | How it's wired |
|---|---|---|
| Claude Code | `-t claude` (default) | Skills + a Stop hook that nudges when the crumb goes stale |
| Codex | `-t codex` | AGENTS.md + `/repocrumb-load` and `/repocrumb-save` prompts |
| Cursor | `-t cursor` | An always-applied project rule |
| Anything else | — | `AGENTS.md` carries the whole protocol, written for every target |

Adding an agent is one module in `src/targets/` plus a template. Nothing else in
the CLI changes.

## Implementing Crumb elsewhere

The format is designed to be reimplemented, not depended on. The frontmatter is
a flat `key: value` subset of YAML — about twenty lines of parser in any
language — and the body is plain `##` sections.

The one rule that makes interoperability work: **a conforming writer must
preserve unknown frontmatter keys and unknown sections verbatim.** Your tool can
add `x_yourtool_*` keys or its own section and know nothing will eat them.

In JavaScript you can just use the reference parser:

```js
const crumb = require('repocrumb/crumb');
const doc = crumb.parse(text);
doc.frontmatter.head;                  // '9c04cca'
doc.sections.get('Objective');
doc.journal[0].next;
```

In anything else, implement a filter that reads a crumb on stdin and writes the
canonical form on stdout, then prove it:

```bash
node conformance/run.js --cmd "<your command>"
```

Read [SPEC.md](SPEC.md) — it's about two pages, and it's the whole thing.

## Privacy

Nothing is sent anywhere. There is no telemetry, no analytics, and no network
access of any kind — the installer writes files and exits, the hook is a shell
script that reads timestamps, and the CLI shells out to `git` and nothing else.
`last_crumb.md` stays on your disk, in your repo, gitignored by default.

The save skill is instructed never to write secrets into it: no keys, tokens,
`.env` contents, or connection strings. It names things rather than quoting
values. It's still a plain file describing your project, so treat it the way
you'd treat your own notes.

## Requirements

Node 18+, zero dependencies. Git optional but recommended — without it the crumb
is still written and read, but `verify` has nothing to check against.

## Development

```bash
npm test          # installer + protocol smoke tests, then the conformance suite
npm run conformance
```

## License

MIT

---

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are
trademarks of their respective owners.
