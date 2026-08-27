---
name: repocrumb-save
description: Record this turn in last_crumb.md so any agent on any provider can pick the work up cold. Runs `npx repocrumb save`, which stamps the git facts itself and appends one short journal entry. Invoke at the end of every turn, after the work is done and reported. Also use when the user says "save the crumb", "update the crumb", is about to switch agents or providers, or is about to end this conversation and start a fresh one rather than let it compact.
---

# repocrumb — save

Record the state of this project for a **different agent, on a different
provider, with zero context**. Not for yourself. Not for the user.

This is the SAVE half of the Crumb protocol: `LOAD → VERIFY → WORK → SAVE`.

## The rule that matters most

**Do not write the file.** Do not open `last_crumb.md` in an editor tool, do not
compose markdown for it, and never type a commit sha, branch name or timestamp
into it. The CLI computes every fact from git. A sha you typed is
indistinguishable from a sha you imagined, which is exactly the problem this
format exists to remove.

## The normal turn — two strings

```
npx repocrumb save --did "what this turn actually did" --next "the single next action" --agent <your model id>
```

That is the whole save for most turns. It stamps the frontmatter, appends one
journal entry, keeps `**Next:**` in step, and compacts the journal. It writes
about four lines. Do not do more than this unless the durable state genuinely
changed.

`--did` is one sentence: actions, files, commands, outcome. Include failures —
"tests still failing on the rename case" is worth more than a clean-sounding
summary. `--next` is the one thing the next agent should do first.

## When the durable state changed

The sections above `## Journal` — Objective, State, Decisions, Key files,
Gotchas, Environment — are *durable*. Rewrite them only when they actually
changed: a new objective, a decision that now constrains the work, a file that
became important, a rule someone would otherwise violate.

When that happens, pipe the replacement in:

```
printf '%s' '## Objective
Ship the verify command.

## State
**Doing:** wiring verify into the load skill
**Blocked:** none

## Decisions
- Facts come from git, never the model

## Key files
- `src/lib/crumb.js` — the parser other tools call
' | npx repocrumb save --did "…" --next "…" --agent <id> --state -
```

Only include the sections you are replacing; the rest are left alone. Do not
include frontmatter — the CLI owns it. Do not include `## Journal`.

## Writing the durable region

- **Compress hard.** Bullets or one short paragraph per section. If a section
  needs a sub-heading, it is too long. The whole file has a 120-line ceiling.
- **Prune every time.** Decisions that no longer constrain anything, files that
  stopped being interesting, work nobody will revisit — cut them. A save that
  only adds is a bug.
- **State, not history.** The journal is the history, and it is bounded. The
  durable region describes *now*.
- **Never write secrets.** No API keys, tokens, passwords, `.env` contents or
  connection strings. Name the thing, never quote the value.
- **Stay provider-neutral.** Do not reference Claude skills, slash commands or
  subagents as if the next agent has them. Describe what needs doing.
- **Key files** bullets must start with a backticked path relative to the repo
  root — `verify` checks those paths still exist.

## Tests

If the project has a `test` command configured in `.repocrumb.json`, add
`--test` to run it and record `pass` or `fail`. Otherwise the crumb records
`tests: unknown`, which is honest. Never claim a green test run you did not
observe.

## Parallel sessions

Other sessions may be running against this repo. Ignore them. Last writer wins
on the durable region; the journal keeps their entries. Do not try to merge.

## Reporting

Do not report the save to the user unless they asked. This is background
bookkeeping, not a deliverable.
