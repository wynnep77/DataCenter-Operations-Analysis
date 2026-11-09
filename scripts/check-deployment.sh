#!/usr/bin/env bash
# Post-deployment check, run on the Docker host:  ./scripts/check-deployment.sh [http://localhost:8080]
# Reads ADMIN_TOKEN from .env if it is not already set in the environment.
set -uo pipefail
BASE="${1:-http://localhost:8080}"
cd "$(dirname "$0")/.."
if [ -z "${ADMIN_TOKEN:-}" ] && [ -f .env ]; then ADMIN_TOKEN="$(grep -E '^ADMIN_TOKEN=' .env | cut -d= -f2-)"; fi
pass=0; fail=0
ok(){ echo "  [ok]   $1"; pass=$((pass+1)); }
bad(){ echo "  [FAIL] $1"; fail=$((fail+1)); }

echo "Checking $BASE"
curl -fsS "$BASE/nginx-health" >/dev/null 2>&1 && ok "web container serving" || bad "web container not reachable"
PAGE="$(curl -fsS "$BASE/" 2>/dev/null || true)"      # capture first: grep -q on a pipe can SIGPIPE curl under pipefail
case "$PAGE" in *'data-tab="admin"'*) ok "dashboard v2 (Administrator tab present)";; *) bad "dashboard v2 not served";; esac

H="$(curl -fsS "$BASE/api/health" 2>/dev/null || echo '{}')"
echo "$H" | grep -q '"api": *"ok"' && ok "API reachable through the proxy" || bad "API not reachable: $H"
echo "$H" | grep -q '"ollama": *true' && ok "API can reach Ollama" || bad "Ollama not reachable from the API (docker compose logs ollama)"
MODEL="$(echo "$H" | sed -nE 's/.*"model": *"([^"]+)".*/\1/p')"
echo "$H" | grep -q '"model_available": *true' && ok "model pulled (${MODEL})" || bad "model not pulled yet: docker compose run --rm ollama-init"

R="$(curl -fsS -H "X-Admin-Token: ${ADMIN_TOKEN:-}" "$BASE/api/runtime" 2>/dev/null || echo 'ERR')"
[ "$R" != 'ERR' ] && ok "Administrator token accepted" || bad "runtime call failed (check ADMIN_TOKEN)"

echo "  ...  sending a short test chat (the first one loads the model into VRAM: allow up to 3 min)"
OUT="$(curl -fsS -N --max-time 180 -H "X-Admin-Token: ${ADMIN_TOKEN:-}" -H 'Content-Type: application/json' \
  -d '{"mode":"analyse","messages":[{"role":"user","content":"Reply with one short sentence confirming you can read the snapshot."}],"context":{"simulated":true,"power":{"hallItKw":770,"pueLive":1.31}},"think":false}' \
  "$BASE/api/chat" 2>/dev/null || true)"
if echo "$OUT" | grep -q '"type": *"done"'; then
  ok "streamed chat completed"
  TPS="$(echo "$OUT" | grep -o '"tokens_per_s": *[0-9.]*' | tail -1 | grep -o '[0-9.]*$')"
  [ -n "$TPS" ] && echo "         generation speed: ${TPS} tokens/s"
else
  bad "chat did not complete: $(echo "$OUT" | tail -c 300)"
fi

R="$(curl -fsS -H "X-Admin-Token: ${ADMIN_TOKEN:-}" "$BASE/api/runtime" 2>/dev/null || echo '{}')"
GPU="$(echo "$R" | grep -o '"gpu_pct": *[0-9]*' | head -1 | grep -o '[0-9]*$')"
if [ -n "$GPU" ]; then
  [ "$GPU" -ge 95 ] && ok "model loaded ${GPU}% on GPU" || bad "model only ${GPU}% on GPU (spilling to CPU: lower OLLAMA_NUM_CTX or use qwen3:8b)"
else
  bad "could not read GPU placement from /api/runtime"
fi

echo "Result: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
