#!/usr/bin/env bash
# Tests for hooks/guard.sh. Run: hooks/test-guard.sh
# ORQ_TMP=/scratch stands for the allowed scratch folder, because the test repo itself is in /tmp.
set -uo pipefail

GUARD="$(cd "$(dirname "$0")" && pwd)/guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
git init -q -b main "$T/repo" && git -C "$T/repo" commit -q --allow-empty -m init
git -C "$T/repo" worktree add -q -b orq/T-0001-x "$T/wt" main
WT=$T/wt
fail=0

# run <expect: allow|block> <description> <tool> <tool_input json> [cwd]
run() {
  local expect=$1 desc=$2 tool=$3 ti=$4 cwd=${5:-$WT} got
  jq -n --arg t "$tool" --arg c "$cwd" --argjson ti "$ti" '{tool_name:$t, cwd:$c, tool_input:$ti}' |
    ORQ_TASK=T-0001 ORQ_WORKTREE=$WT ORQ_BASE=main ORQ_TMP=/scratch "$GUARD" 2>/dev/null
  [ $? -eq 2 ] && got=block || got=allow
  if [ "$got" = "$expect" ]; then echo "ok    $desc"; else echo "FAIL  $desc (expected $expect, got $got)"; fail=1; fi
}
bash_() { run "$1" "$2" Bash "$(jq -n --arg c "$3" '{command:$c}')" "${4:-$WT}"; }

# Off outside task sessions.
out=$(jq -n '{tool_name:"Bash", cwd:"/", tool_input:{command:"git push origin main --force"}}' | "$GUARD"; echo $?)
[ "$out" = 0 ] && echo "ok    no ORQ_TASK: allows everything" || { echo "FAIL  no ORQ_TASK"; fail=1; }

# G1
bash_ block "G1 push to main"              "git push origin main"
bash_ block "G1 push HEAD:main"            "git push origin HEAD:main"
bash_ block "G1 force push"                "git push --force origin orq/T-0001-x"
bash_ block "G1 -f push"                   "git push -f"
bash_ allow "G1 push task branch"          "git push -u origin orq/T-0001-x"
bash_ allow "G1 force-with-lease"          "git push --force-with-lease origin orq/T-0001-x"
bash_ block "G1 commit on main checkout"   "git commit -m x" "$T/repo"
bash_ block "G1 gh pr merge"               "gh pr merge 12 --squash"
bash_ allow "G1 gh pr create"              "gh pr create --fill"
bash_ allow "G1 commit in worktree"        "git add a.txt && git commit -m 'feat(T-0001): x'"

# G2
run   block "G2 read .env"         Read '{"file_path":".env"}'
run   block "G2 read nested .env"  Read "{\"file_path\":\"$WT/app/.env.local\"}"
run   allow "G2 read .env.example" Read '{"file_path":".env.example"}'
run   block "G2 read key"          Read '{"file_path":"/home/u/.ssh/id_ed25519"}'
run   allow "G2 read source"       Read '{"file_path":"src/environment.ts"}'
run   block "G2 grep in .env"      Grep '{"pattern":"TOKEN","path":".env"}'
bash_ block "G2 cat .env"          "cat .env"
bash_ block "G2 source .env"       "source ./.env && npm start"
bash_ allow "G2 cp example"        "cp .env.example /scratch/x"
bash_ allow "G2 envsubst word"     "echo environment"

# G3
run   allow "G3 write in worktree" Write "{\"file_path\":\"$WT/src/a.ts\",\"content\":\"\"}"
run   allow "G3 write relative"    Write '{"file_path":"src/a.ts","content":""}'
run   block "G3 write main checkout" Write "{\"file_path\":\"$T/repo/a.ts\",\"content\":\"\"}"
run   block "G3 edit home file"    Edit '{"file_path":"/home/u/.bashrc","old_string":"a","new_string":"b"}'
run   allow "G3 write tmp"         Write '{"file_path":"/scratch/x.txt","content":""}'
bash_ block "G3 git -C main checkout" "git -C $T/repo checkout -b y"
bash_ block "G3 worktree add"      "git worktree add ../x"
bash_ allow "G3 git status outside" "git -C $T/repo status"

# G4
bash_ block "G4 rm -rf home"       "rm -rf ~/projects"
bash_ block "G4 rm -rf parent"     "rm -rf ../"
bash_ block "G4 rm worktree root"  "rm -rf ."
bash_ block "G4 rm variable"       'rm -rf "$DIR"'
bash_ allow "G4 rm -rf build"      "rm -rf build node_modules"
bash_ allow "G4 rm one file"       "rm /home/u/x.txt"
bash_ allow "G4 rm -rf tmp"        "rm -rf /scratch/orq-test"
bash_ block "G4 find -delete out"  "find /home/u -name '*.log' -delete"
bash_ allow "G4 reset --hard in"   "git reset --hard HEAD"
bash_ block "G4 clean outside"     "git -C $T/repo clean -fdx"

exit $fail
