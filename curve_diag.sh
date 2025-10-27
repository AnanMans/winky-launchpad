#!/usr/bin/env bash
set -euo pipefail

OUT="curve_report.txt"
: > "$OUT"

mask() { sed -E 's/(=).+/\1***REDACTED***/g'; }

say(){ echo -e "\n=== $1 ===" | tee -a "$OUT"; }

check_repo () {
  local dir="$1" name="$2"
  if [ -d "$dir" ]; then
    say "$name: PATH = $dir"
    (cd "$dir" && {
      say "$name: GIT"
      (git rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
        echo "remote:" >> "$OUT"; git remote -v >> "$OUT" || true
        echo "branch/head:" >> "$OUT"; git branch -vv >> "$OUT" || true
        echo "head:" >> "$OUT"; git rev-parse HEAD >> "$OUT" || true
        echo "last 5:" >> "$OUT"; git log --oneline -n 5 >> "$OUT" || true
        echo "status:" >> "$OUT"; git status --porcelain=v1 -uall >> "$OUT" || true
      }) || echo "Not a git repo" >> "$OUT"
      say "$name: env keys (.env.local masked)"
      if [ -f .env.local ]; then sed -E 's/=.*/=***REDACTED***/' .env.local >> "$OUT"; else echo "no .env.local" >> "$OUT"; fi
      say "$name: node & next"
      (node -v && npm -v && yarn -v) >> "$OUT" 2>&1 || true
      (jq --version >> "$OUT" 2>&1) || echo "jq not installed" >> "$OUT"
      say "$name: package.json (name+scripts)"
      if [ -f package.json ]; then
        cat package.json | node -e 'let o="";process.stdin.on("data",d=>o+=d).on("end",()=>{const j=JSON.parse(o);console.log(JSON.stringify({name:j.name,scripts:j.scripts},null,2))})' >> "$OUT" || true
      else
        echo "no package.json" >> "$OUT"
      fi
      say "$name: file tree (app/components/api)"
      (command -v tree >/dev/null && tree -L 3 src/app src/components src/lib 2>/dev/null) >> "$OUT" 2>&1 || true
    })
  else
    say "$name: PATH NOT FOUND ($dir)"
  fi
}

say "HOST"
uname -a >> "$OUT"
sw_vers 2>/dev/null >> "$OUT" || true

say "Global env (masked subset)"
printenv | grep -E 'SUPABASE|HELIUS|RPC|TREASURY|VERCEL|NEXT_PUBLIC' | mask >> "$OUT" || true

check_repo "$HOME/sol-curve/web" "FRONTEND (sol-curve/web)"
check_repo "$HOME/programs/curve_launchpad" "PROGRAM (programs/curve_launchpad)"

say "Solana/Helius"
(solana -V && solana config get && solana address && solana balance) >> "$OUT" 2>&1 || echo "solana CLI not configured" >> "$OUT"

say "Vercel (if logged in)"
(vercel whoami && vercel env ls --environment=production) >> "$OUT" 2>&1 || echo "not logged into Vercel CLI" >> "$OUT"

echo -e "\n--- END ---" >> "$OUT"
echo "Wrote $OUT"
