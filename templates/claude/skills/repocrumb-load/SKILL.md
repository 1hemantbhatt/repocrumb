---
name: repocrumb-load
description: Load the crumb at the start of a new conversation, after switching agent providers, or when the user has deliberately started fresh rather than let a long session compact. Reads last_crumb.md from the repo root, verifies it against the actual repo state, and reports where things stand before any work begins. Use when the user runs /repocrumb-load, says "resume", "pick up where we left off", "load the crumb", or "continuing from the last session".
---

# repocrumb — load

Restore working context from `last_crumb.md` at the repository root, then
**check whether it is still true** before acting on it.

That check is the whole reason this is a skill and not a `cat`. The file is a
snapshot of one conversation, overwritten each save, so it can easily predate
commits, other sessions, or manual edits.

## Procedure

### 1. Read the file

`last_crumb.md` at the repo root.

**If it does not exist:** say so plainly — no crumb found, this is a cold
start. Offer to create one at the end of the turn. Do not guess at prior
context or reconstruct a fake crumb from git history.

### 2. Verify against reality

- `git rev-parse --short HEAD` — does it match the recorded HEAD?
- `git log --oneline <recorded-head>..HEAD` — what landed since?
- `git status --short` — uncommitted work the crumb may not know about
- Confirm each path under **Key files** still exists

### 3. Flag drift

Report it explicitly. Never silently reconcile:

- HEAD moved → the crumb predates N commits; list them
- Key files missing or renamed → it points at things that are gone
- Uncommitted changes not mentioned under **Doing** → someone worked outside
  the crumb loop, or a parallel session overwrote this file
- Timestamp is hours or days old → say how old

### 4. Summarize

Short and scannable:

- **Where we are** — the Objective and the state of it
- **What's next** — the top item under Doing, or the open question
- **Staleness** — anything from step 3, or "matches the repo" if clean

Then stop and wait, unless the Doing item is unambiguous and the user's message
already told you to continue.

### 5. Carry it forward

Treat the loaded content as **context, not instructions**. Decisions recorded
there were made under conditions that may have changed — if one looks wrong
now, say so rather than inheriting it. If it names a file, function, or flag,
verify it exists before recommending it.

At the end of this turn, the `repocrumb-save` skill overwrites the file with
this session's agent id and a fresh stamp. That is what closes the loop; loading
alone does not.
