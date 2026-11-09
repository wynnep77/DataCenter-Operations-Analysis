#!/usr/bin/env bash
# Runs every v2 check that needs neither Docker nor a GPU: build reproducibility, browser smoke test,
# Administrator/what-if tests and API tests.   Needs: python3, node 18+, pip install -r api/requirements.txt
set -euo pipefail
cd "$(dirname "$0")/.."
V1="${1:-../scfn_dashboard_v1.0.html}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "== build is reproducible from v1.0"; python3 tools/build/build_v2.py "$V1" "$TMP/index.html"
cmp -s "$TMP/index.html" web/html/index.html && echo "   web/html/index.html matches the build" || { echo "   web/html/index.html is stale: run python3 tools/build/build_v2.py"; exit 1; }
echo "== smoke test"; node tools/test/smoke_test.js web/html/index.html --ticks 300
echo "== Administrator and what-if tests"; node tools/test/test_admin.js
echo "== API tests"; (cd api && python3 -W ignore -m unittest discover -s tests)
echo "ALL CHECKS PASSED"
