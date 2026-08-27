---
spec: crumb/1
updated: 2026-08-27T14:02:11+05:30
agent: claude-opus-5
branch: main
head: 9c04cca
tests: pass
tests_cmd: npm test
---

# Crumb

## Objective
Ship the crumb v1 format.

## State
**Doing:** writing the conformance suite
**Blocked:** none
**Next:** wire it into npm test

## Decisions
- Facts come from git, never from the model

## Key files
- `src/lib/crumb.js` — the parser other tools call

## Journal
- 2026-08-27T14:02 claude-opus-5 @9c04cca
  did: wrote the parser
  next: the cli
