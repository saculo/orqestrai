#!/usr/bin/env bash
# orqestrai guard hook (PreToolUse).
#
# Active only in task sessions: `orq new` / `orq open` set ORQ_TASK, ORQ_WORKTREE and
# ORQ_BASE. Without ORQ_TASK this script allows everything, so your other sessions are
# not affected.
#
# Exit 2 blocks the tool call. The message on stderr goes back to the agent.
# These guards stop mistakes. They are not a security boundary: a determined agent can
# get around a text check (for example with `bash -c` or a script).
#
#   G1 protect base   no push/merge/commit on the base branch, no force push, no PR merge
#   G2 secrets        no reading or writing .env*, keys, credential files
#   G3 stay inside    file writes and git writes only inside the task worktree
#   G4 destructive    rm -r / find -delete / git clean / git reset --hard only inside it
set -uo pipefail

input=$(cat)   # read stdin first, also when we allow at once
[ -n "${ORQ_TASK:-}" ] || exit 0
command -v jq >/dev/null || { echo "orqestrai guard: jq is required" >&2; exit 2; }

tool=$(jq -r '.tool_name // ""' <<<"$input")
cwd=$(jq -r '.cwd // ""' <<<"$input"); cwd=${cwd:-$PWD}
wt=$(realpath -m "${ORQ_WORKTREE:-$cwd}")
base=${ORQ_BASE:-main}

block() { echo "orqestrai guard $1: $2" >&2; exit 2; }

resolve() {
  local p=$1
  [[ $p == "~"* ]] && p="$HOME${p:1}"
  [[ $p == /* ]] || p="$cwd/$p"
  realpath -m "$p"
}
inside_wt() { [[ "$1/" == "$wt"/* ]]; }
tmp=$(realpath -m "${ORQ_TMP:-/tmp}")   # scratch space that is always allowed
is_tmp() { [[ "$1/" == "$tmp"/* ]]; }

# --- G2: secrets ---------------------------------------------------------------------
D='[:space:]"'"'"'=;|&()<>'      # characters that end a path in a command
SECRET_RE="(^|[/$D])(\.env(\.[A-Za-z0-9_-]+)?|[^/$D]+\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)(\.pub)?|credentials(\.json)?|\.netrc|\.npmrc|\.pypirc|\.ssh/[^$D]*)($|[$D])"
SAFE_RE='\.env\.(example|sample|template)'
check_secrets() {
  local s
  s=$(sed -E "s/$SAFE_RE//g" <<<"$1")
  grep -Eq "$SECRET_RE" <<<"$s" &&
    block G2 "this touches a secret file (.env, key, credentials). Do not read or write secrets. Use .env.example or ask the user."
  return 0
}

case "$tool" in
  Read|Write|Edit|MultiEdit|NotebookEdit)
    check_secrets "$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$input")" ;;
  Grep|Glob)
    check_secrets "$(jq -r '[.tool_input.path, .tool_input.glob, .tool_input.pattern] | map(select(.)) | join(" ")' <<<"$input")" ;;
  Bash)
    check_secrets "$(jq -r '.tool_input.command // ""' <<<"$input")" ;;
esac

# --- G3: file writes stay inside the worktree ----------------------------------------
case "$tool" in
  Write|Edit|MultiEdit|NotebookEdit)
    p=$(resolve "$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$input")")
    inside_wt "$p" || is_tmp "$p" ||
      block G3 "$p is outside the task worktree $wt. Work only in the worktree."
    exit 0 ;;
  Bash) ;;
  *) exit 0 ;;
esac

# --- G1, G3, G4 for shell commands ---------------------------------------------------
check_git() {
  local -a a=("$@"); local i=1 gdir=$cwd sub branch
  while [ $i -lt ${#a[@]} ] && [[ ${a[$i]} == -* ]]; do
    case ${a[$i]} in -C) gdir=$(resolve "${a[$((i+1))]}"); i=$((i+2)) ;; -c) i=$((i+2)) ;; *) i=$((i+1)) ;; esac
  done
  sub=${a[$i]:-}; local -a rest=("${a[@]:$((i+1))}")
  branch=$(git -C "$gdir" branch --show-current 2>/dev/null)

  case $sub in
    worktree)
      case ${rest[0]:-} in add|remove|move|prune) block G3 "orq manages worktrees. Do not run git worktree ${rest[0]}." ;; esac ;;
    commit|push|merge|rebase|reset|clean|checkout|switch|restore|stash|cherry-pick|revert|am|tag|branch|pull)
      inside_wt "$(realpath -m "$gdir")" ||
        block G3 "git $sub outside the task worktree ($gdir). Work only in $wt." ;;
  esac

  case $sub in
    commit|merge|rebase|cherry-pick|revert|am|pull|push)
      [ "$branch" = "$base" ] && block G1 "you are on the base branch '$base'. Work on the task branch." ;;
  esac

  if [ "$sub" = push ]; then
    local x
    for x in "${rest[@]}"; do
      case $x in
        -f|--force|--mirror|--all) block G1 "git push $x is not allowed. Use --force-with-lease on the task branch only." ;;
        "$base"|*:"$base"|refs/heads/"$base"|+"$base"|*:refs/heads/"$base") block G1 "pushing to the base branch '$base' is the user's gate." ;;
      esac
    done
  fi

  if [ "$sub" = clean ] || { [ "$sub" = reset ] && [[ " ${rest[*]} " == *" --hard "* ]]; }; then
    inside_wt "$(realpath -m "$gdir")" || block G4 "git $sub outside the task worktree."
  fi
  return 0
}

check_rm_targets() {   # $1 = guard label, rest = path arguments
  local label=$1 x p; shift
  for x in "$@"; do
    [[ $x == -* ]] && continue
    [[ $x == *'$'* || $x == *'`'* ]] && block "$label" "cannot check '$x' (a variable). Use a literal path inside the worktree."
    p=$(resolve "$x")
    [ "$p" = "$wt" ] && block "$label" "do not delete the worktree itself."
    inside_wt "$p" || is_tmp "$p" || block "$label" "$p is outside the task worktree."
  done
  return 0
}

check_segment() {
  local -a w; read -ra w <<<"$1"
  while [ ${#w[@]} -gt 0 ] && [[ ${w[0]} == *=* || ${w[0]} == sudo || ${w[0]} == command || ${w[0]} == exec ]]; do
    w=("${w[@]:1}")
  done
  [ ${#w[@]} -gt 0 ] || return 0
  case ${w[0]} in
    git) check_git "${w[@]}" ;;
    gh)
      [[ "${w[1]:-} ${w[2]:-}" == "pr merge" ]] && block G1 "merging a PR is the user's gate."
      [[ "${w[1]:-} ${w[2]:-}" == "repo delete" ]] && block G4 "deleting a repository is not allowed." ;;
    rm)
      local x r=0
      for x in "${w[@]:1}"; do [[ $x == --recursive || ( $x == -* && $x != --* && $x == *[rR]* ) ]] && r=1; done
      [ $r = 1 ] && check_rm_targets G4 "${w[@]:1}" ;;
    find)
      [[ " ${w[*]} " == *" -delete "* ]] && check_rm_targets G4 "${w[1]:-.}" ;;
  esac
  return 0
}

cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
while IFS= read -r seg; do
  check_segment "$seg"
done < <(sed -E 's/(&&|\|\||[;|&])/\n/g' <<<"$cmd")
exit 0
