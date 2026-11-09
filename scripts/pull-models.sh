#!/bin/sh
# Pulls OLLAMA_MODEL plus any space/comma separated OLLAMA_EXTRA_MODELS.
# Safe to re-run: models already present are verified, not downloaded again.
set -eu
models="${OLLAMA_MODEL:-qwen3:8b} $(echo "${OLLAMA_EXTRA_MODELS:-}" | tr ',' ' ')"
for m in $models; do
  echo "[ollama-init] pulling $m ..."
  ollama pull "$m"
done
echo "[ollama-init] models available:"
ollama list
