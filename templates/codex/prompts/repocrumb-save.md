Save the repocrumb handoff state for this repository, so a different agent on a
different provider can pick this work up cold.

**Do not edit `last_crumb.md` by hand**, and never type a commit sha, branch or
timestamp into it. The CLI computes every fact from git.

For a normal turn, that is the whole save:

```
npx repocrumb save --did "what this turn actually did" --next "the single next action" --agent <your model id>
```

`--did` is one sentence: actions, files, commands, outcome. Include failures —
"tests still failing on the rename case" is worth more than a clean-sounding
summary. `--next` is the one thing to do first next time.

Only if the durable state genuinely changed — a new objective, a decision that
now constrains the work, a file that became important, a rule someone would
otherwise violate — also pipe in the sections you are replacing:

```
printf '%s' '## Objective
...

## State
**Doing:** ...
**Blocked:** none

## Decisions
- ...

## Key files
- `path/to/file` — why it matters
' | npx repocrumb save --did "..." --next "..." --agent <id> --state -
```

Rules: no secrets, ever. Compress hard — the file has a 120-line ceiling. Prune
what no longer constrains the work; a save that only adds is a bug. Stay
provider-neutral in the prose. `Key files` bullets must start with a backticked
path relative to the repo root.

Add `--test` if `.repocrumb.json` configures a test command and you want the
result recorded. Never claim a green test run you did not observe.

Do not report the save unless I asked — it is bookkeeping, not a deliverable.
