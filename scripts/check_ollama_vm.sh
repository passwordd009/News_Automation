#!/usr/bin/env bash
#
# Check an Ollama host from outside it.
#
#   ./scripts/check_ollama_vm.sh https://ollama.example.com YOUR_TOKEN
#
# Run this from your laptop, not the VM — the point is to see what GitHub's
# runners will see. It checks three things:
#
#   1. The port is closed to anyone without the token.
#   2. The model answers with it.
#   3. How long one article's worth of work actually takes.
#
# That last number decides whether a daily run finishes in time, and is worth
# measuring rather than guessing.

set -uo pipefail

URL="${1:-}"
TOKEN="${2:-}"
MODEL="${3:-llama3.1}"

if [[ -z "$URL" || -z "$TOKEN" ]]; then
  echo "Usage: $0 <https://your-host> <token> [model]" >&2
  exit 2
fi

URL="${URL%/}"
pass=0
fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; pass=$((pass + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=$((fail + 1)); }
note() { printf '    %s\n' "$*"; }

printf '\nChecking %s\n\n' "$URL"

# ---------------------------------------------------------------------------
echo "Access control"
# ---------------------------------------------------------------------------
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL/api/tags")"
case "$code" in
  401|403) ok "refuses requests without a token (HTTP $code)" ;;
  200)     bad "ANSWERS WITHOUT A TOKEN — the model is open to the internet"
           note "Anyone who finds this host can use it. Check the Caddyfile." ;;
  000)     bad "no response at all — DNS, firewall or the proxy is down" ;;
  *)       bad "unexpected status without a token: HTTP $code" ;;
esac

# The raw port must not be reachable even if the proxy is fine.
host="${URL#*://}"
host="${host%%/*}"
host="${host%%:*}"
if command -v nc >/dev/null; then
  if nc -z -w 5 "$host" 11434 2>/dev/null; then
    bad "port 11434 is open directly — the proxy can be bypassed"
    note "Bind Ollama to 127.0.0.1 and close 11434 at the firewall."
  else
    ok "port 11434 is not reachable directly"
  fi
fi

# ---------------------------------------------------------------------------
echo
echo "Authenticated access"
# ---------------------------------------------------------------------------
tags="$(curl -s --max-time 20 -H "Authorization: Bearer $TOKEN" "$URL/api/tags")"

if [[ -z "$tags" ]]; then
  bad "no response with the token"
elif grep -q '"models"' <<<"$tags"; then
  ok "authenticates and responds"
  if grep -q "\"${MODEL%%:*}" <<<"$tags"; then
    ok "$MODEL is pulled"
  else
    bad "$MODEL is not pulled"
    note "On the VM: ollama pull $MODEL"
  fi
else
  bad "unexpected reply with the token"
  note "$(head -c 200 <<<"$tags")"
fi

# ---------------------------------------------------------------------------
echo
echo "Speed"
# ---------------------------------------------------------------------------
# A prompt roughly the shape of a real review: some article text in, strict
# JSON out. The duration here is what a daily run is multiplied by.
read -r -d '' PROMPT <<'JSON' || true
Reply with only this JSON object, filled in for the article below.
{"topic":"","nyc_relevance":0,"summary":""}

TITLE: City opens new affordable housing lottery in the Bronx
TEXT: Applications opened this week for 240 apartments in Mott Haven for
households earning between 40% and 80% of the area median income. The deadline
is next month and applications are handled through NYC Housing Connect.
JSON

body="$(printf '{"model":"%s","prompt":%s,"stream":false,"format":"json","options":{"temperature":0.2}}' \
  "$MODEL" "$(printf '%s' "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '"test"')")"

start="$(date +%s)"
response="$(curl -s --max-time 600 -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "$body" "$URL/api/generate")"
elapsed=$(( $(date +%s) - start ))

if grep -q '"response"' <<<"$response"; then
  ok "generated a reply in ${elapsed}s"

  daily=$(( elapsed * 50 / 60 ))
  note "At ~50 articles a day that is roughly ${daily} minutes per run."
  if (( daily > 40 )); then
    bad "that exceeds the 45-minute workflow timeout"
    note "Use a smaller model, a GPU instance, or cap the run with --limit."
  elif (( daily > 20 )); then
    note "Within the timeout, but slow. A smaller model would give you headroom."
  fi
else
  bad "generation failed"
  note "$(head -c 200 <<<"$response")"
fi

# ---------------------------------------------------------------------------
printf '\n%s\n' "────────────────────────────────────────────"
if (( fail == 0 )); then
  printf 'All %d checks passed. Add these to GitHub Actions secrets:\n\n' "$pass"
  printf '  OLLAMA_URL          %s\n  OLLAMA_AUTH_TOKEN   <your token>\n\n' "$URL"
  exit 0
fi

printf '%d passed, %d failed. Fix the ✗ items above.\n\n' "$pass" "$fail"
exit 1
