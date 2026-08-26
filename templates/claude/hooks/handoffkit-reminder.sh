#!/usr/bin/env bash
# handoffkit Stop hook: nudge the agent to save last_handoff.md before the turn
# ends.
#
# Blocks the stop (which sends the model back for one more step) only when the
# handoff file looks stale. Two guards keep this from becoming a loop:
#   - a freshness window: if the file was touched during this turn, we're done
#   - a cooldown marker: we block at most once per COOLDOWN seconds
# Deliberately no jq dependency; stdin is drained and ignored.

set -u

FRESH=900      # backstop: handoff counts as current if touched this recently
COOLDOWN=600   # never block again within this many seconds of the last block

cat >/dev/null 2>&1 || true   # drain hook stdin

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF="$ROOT/last_handoff.md"

# Modification time in epoch seconds. GNU stat (Linux, Git Bash) and BSD stat
# (macOS) spell this differently, so try both and validate we got digits.
mtime_of() {
  local t
  t=$(stat -c %Y "$1" 2>/dev/null) || t=""
  case "$t" in ''|*[!0-9]*) t=$(stat -f %m "$1" 2>/dev/null) || t="" ;; esac
  case "$t" in ''|*[!0-9]*) t=0 ;; esac
  printf '%s' "$t"
}

# Cooldown marker goes in the shared git dir. --git-common-dir resolves to the
# real .git even from a linked worktree, where .git is a file and not writable
# as a directory.
#
# The no-git fallback must not be a fixed name in a world-writable directory:
# on a shared machine anyone could pre-create it, and we both read it back and
# write through it. Use a private per-user cache instead, keyed by repo path so
# two projects don't share one cooldown.
GITDIR=$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || echo "")
case "$GITDIR" in
  '' )
    CACHE="${XDG_CACHE_HOME:-${HOME:-$ROOT}/.cache}/handoffkit"
    (umask 077 && mkdir -p "$CACHE") 2>/dev/null
    MARKER="$CACHE/block-$(printf '%s' "$ROOT" | cksum | cut -d' ' -f1)"
    ;;
  /*|[A-Za-z]:* ) MARKER="$GITDIR/handoffkit-block" ;;
  * ) MARKER="$ROOT/$GITDIR/handoffkit-block" ;;   # relative form
esac

now=$(date +%s)

mtime=0
if [ -f "$HANDOFF" ]; then
  mtime=$(mtime_of "$HANDOFF")
fi

# Primary signal: did any work land AFTER the last save? Wall-clock age is a
# poor proxy — a single turn can easily run longer than any threshold — so
# compare the handoff against the files this turn actually touched. If nothing
# in the working tree is newer than the handoff, there is nothing to record.
# last_handoff.md is gitignored, so it never shows up in its own comparison.
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
    rm -f "$MARKER" 2>/dev/null
    exit 0
  fi
fi

# Backstop for repos where git is unavailable or nothing is tracked yet.
if [ $((now - mtime)) -lt "$FRESH" ] && [ "$work_is_newer" -eq 0 ]; then
  rm -f "$MARKER" 2>/dev/null
  exit 0
fi

# Validate before the arithmetic below. Shell arithmetic re-evaluates whatever
# a variable holds, so an unchecked file read here would be a code-execution
# path if anything ever wrote something other than digits into the marker.
last=0
if [ -f "$MARKER" ]; then
  last=$(cat "$MARKER" 2>/dev/null || echo 0)
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
fi

# Already nudged recently. Stay quiet rather than trap the turn in a loop.
if [ $((now - last)) -lt "$COOLDOWN" ]; then
  exit 0
fi

echo "$now" > "$MARKER" 2>/dev/null

cat <<'JSON'
{"decision":"block","reason":"last_handoff.md is stale. Use the handoffkit-save skill now to overwrite it with the current state and this conversation, then finish. Keep it under 100 lines. If this turn changed nothing worth recording, refresh the stamp and the Last conversation block only, then stop.","suppressOutput":true}
JSON

exit 0
