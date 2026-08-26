---
name: repocrumb-save
description: Overwrite last_crumb.md at the repo root with a short summary of the current state and the conversation that just happened, so any agent on any provider can pick the work up cold. Invoke at the end of every turn, after the work is done and reported. Also use when the user says "save the crumb", "update the crumb", is about to switch agents, subscriptions, or providers, or is about to end this conversation and start a fresh one rather than let it compact.
---

# repocrumb — save

Record the state of this project for a **different agent, on a different
provider, with zero context**. Not for yourself. Not for the user.

The file is `last_crumb.md` at the repository root. It is gitignored.

## The two rules that matter most

**1. Overwrite. Always.** This file is a snapshot of *now*, not a history. You
rewrite it whole on every save. There is no log of past exchanges, no dated
list of every decision ever made, nothing that only accumulates. If a fact no
longer shapes the work, it does not go in the new version.

**2. Keep it short.** Target **under 100 lines**. Treat 150 as a hard ceiling —
if you are over it, you are recording history instead of state, and the next
agent will burn context reading things that no longer matter. Every line has to
earn its place by changing what someone would do next.

## Only the last conversation

Other sessions may be running against this repo at the same time. Ignore them.
You write what *your* conversation just did and what the repo looks like now.
Last writer wins — do not try to merge with, preserve, or reconcile another
session's version.

The consequence: read the existing file before overwriting so you keep facts
that are still true and that you happen to know are still true. But you are not
appending to it, and you are not protecting it.

## Procedure

1. Read the existing `last_crumb.md`, if there is one. Carry forward what is
   still true and still relevant. Drop the rest.
2. Get the stamp facts: `git rev-parse --short HEAD`,
   `git branch --show-current`, current local time.
3. If the turn was trivial — a question answered, nothing created, changed, run,
   or decided — refresh the stamp and the **Last conversation** block only.
   Leave everything else alone.
4. Otherwise rewrite the whole file from the template below.
5. Write it. Do not report the write to the user unless they asked — this is
   background bookkeeping, not a deliverable.

## Hard rules

- **Never write secrets.** No API keys, tokens, passwords, `.env` contents, or
  connection strings. Name the thing, never quote the value.
- **Compress hard.** Every section is bullets or one short paragraph. If a
  section needs a sub-heading, it is too long.
- **Prune on every save.** Decisions that no longer constrain anything, files
  that stopped being interesting, finished work nobody will revisit — cut them.
  A save that only adds is a bug.
- **Be honest about failure.** Tests failing, a step skipped, something half
  done — that goes in. A crumb that hides a broken state is worse than none.
- **Fresh stamps only.** The HEAD and timestamp are how the next agent judges
  staleness. Never carry an old one forward.
- **Stay provider-neutral.** Do not reference Claude skills, slash commands, or
  subagents as if the next agent has them. Describe what needs doing.

## Template

Keep these headings exactly — the loader keys off them.

```markdown
# Crumb

Updated: <ISO-8601 local> | Agent: <model/provider id> | Branch: <branch> | HEAD: <short sha>

> Snapshot of current state, for an incoming agent with no prior context.
> Overwritten every save. Reflects one conversation only.

## Project
<Two or three lines. What this repo is, what stack.>

## Objective
<What the user is trying to accomplish right now. One or two lines.>

## State
**Done:** <only what someone still needs to know>
**Doing:** <mid-flight work, with enough detail to resume>
**Blocked:** <awaiting the user, or unresolved. "none" if none.>

## Decisions
<Only choices that still constrain the work, and why. Drop the rest.
Four or five bullets, not a changelog.>

## Key files
- `<path>` — <why it matters right now>

## Gotchas
<Project rules an incoming agent would otherwise violate. Bullets.>

## Environment
<How to run, build, test. Platform quirks that have bitten us.>

## Last conversation
**Asked:** <the request, one or two sentences>
**Did:** <actions, files, commands>
**Result:** <outcome, plus anything left dangling>
```
