#!/bin/sh
# Preloads the Ollama model into VRAM by running a short test chat.
# This makes the first user interaction faster. Run after deployment.
set -eu

cd "$(dirname "$0")/.."

# Load ADMIN_TOKEN from .env
if [ -z "${ADMIN_TOKEN:-}" ] && [ -f .env ]; then
  ADMIN_TOKEN="$(grep -E '^ADMIN_TOKEN=' .env | cut -d= -f2-)"
fi

if [ -z "$ADMIN_TOKEN" ]; then
  echo "Error: ADMIN_TOKEN not found in .env"
  exit 1
fi

# Get the port from .env or use default
WEB_PORT="${WEB_PORT:-8081}"
BASE="http://localhost:${WEB_PORT}"

echo "Preloading model into VRAM..."
echo "This may take 1-2 minutes for the first time."
echo ""

# Send a short test chat to load the model
curl -fsS -N --max-time 180 \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"analyse","messages":[{"role":"user","content":"Reply with one short sentence confirming you can read the snapshot."}],"context":{"simulated":true,"power":{"hallItKw":770,"pueLive":1.31}},"think":false}' \
  "${BASE}/api/chat" > /dev/null

echo ""
echo "Model preloaded into VRAM."
echo "The first user chat will now be faster."
