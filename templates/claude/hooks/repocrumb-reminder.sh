#!/usr/bin/env bash
# repocrumb Stop hook: nudge the agent to save last_crumb.md before the turn
# ends.
#
# Blocks the stop (which sends the model back for one more step) only when the
# crumb file looks stale. Two guards keep this from becoming a loop:
#   - a freshness window: if the file was touched during this turn, we're done
#   - stop_hook_active: we block at most once per stop cycle (see below)
# Deliberately no jq dependency; the one field we need is matched textually.

set -u

FRESH=900      # backstop: crumb counts as current if touched this recently

INPUT=$(cat 2>/dev/null || true)   # hook payload on stdin

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CRUMB="$ROOT/last_crumb.md"

# Claude Code sets stop_hook_active=true when this turn is only still running
# because a Stop hook blocked it. Blocking again from inside that continuation
# is the one thing that can trap the turn in a loop, so we stop there — at most
# one nudge per stop cycle, and the model is free to end the turn either way.
#
# This replaces an earlier wall-clock cooldown. A timer could not tell "I just
# nudged, don't nudge again" apart from "a different turn ended stale ten
# minutes later", so an ignored nudge muted every genuine one after it.
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Modification time in epoch seconds. GNU stat (Linux, Git Bash) and BSD stat
# (macOS) spell this differently, so try both and validate we got digits.
mtime_of() {
  local t
  t=$(stat -c %Y "$1" 2>/dev/null) || t=""
  case "$t" in ''|*[!0-9]*) t=$(stat -f %m "$1" 2>/dev/null) || t="" ;; esac
  case "$t" in ''|*[!0-9]*) t=0 ;; esac
  printf '%s' "$t"
}

# --git-common-dir resolves to the real .git even from a linked worktree, where
# .git is a file rather than a directory. Empty means "not a repo", which the
# staleness check below treats as "fall back to the clock".
GITDIR=$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || echo "")

now=$(date +%s)

mtime=0
if [ -f "$CRUMB" ]; then
  mtime=$(mtime_of "$CRUMB")
fi

# Primary signal: did any work land AFTER the last save? Wall-clock age is a
# poor proxy — a single turn can easily run longer than any threshold — so
# compare the crumb against the files this turn actually touched. If nothing
# in the working tree is newer than the crumb, there is nothing to record.
# last_crumb.md is gitignored, so it never shows up in its own comparison.
# -z gives NUL-separated records with paths left as-is; the default format
# quotes anything unusual and writes renames as "old -> new", both of which
# turn into paths that don't exist and get skipped. A rename emits two records,
# new path then old, so the record after an R/C status is a source path we've
# already accounted for.
#
# Only meaningful inside a repo: with no git, `status` prints nothing, which is
# indistinguishable from "nothing changed" — so we'd exit here every time and
# the wall-clock backstop below would never run.
work_is_newer=0
if [ -n "$GITDIR" ] && [ "$mtime" -gt 0 ]; then
  expect_rename_src=0
  while IFS= read -r -d '' rec; do
    if [ "$expect_rename_src" -eq 1 ]; then
      expect_rename_src=0
      continue
    fi
    case "$rec" in R*|C*) expect_rename_src=1 ;; esac
    f=${rec#???}          # strip the two status columns and the space
    [ -n "$f" ] || continue
    [ -f "$ROOT/$f" ] || continue
    if [ "$(mtime_of "$ROOT/$f")" -gt "$mtime" ]; then
      work_is_newer=1
      break
    fi
  done < <(git -C "$ROOT" status --porcelain -z --untracked-files=all 2>/dev/null)
  if [ "$work_is_newer" -eq 0 ]; then
    exit 0
  fi
fi

# Backstop for repos where git is unavailable or nothing is tracked yet.
if [ $((now - mtime)) -lt "$FRESH" ] && [ "$work_is_newer" -eq 0 ]; then
  exit 0
fi

cat <<'JSON'
{"decision":"block","reason":"last_crumb.md is stale. Use the repocrumb-save skill now, then finish. For a normal turn that is one command: npx repocrumb save --did \"<what this turn did>\" --next \"<the next action>\" --agent <your model id>. Do not edit last_crumb.md by hand and never type a commit sha into it - the CLI computes every fact from git. Pipe a replacement durable region with --state - only if the objective, decisions or key files actually changed.","suppressOutput":true}
JSON

exit 0
