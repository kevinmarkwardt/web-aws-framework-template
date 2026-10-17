#!/usr/bin/env bash
# Template self-test (what .github/workflows/template-ci.yml runs; run it locally before pushing template changes):
#   1. scripts/verify.sh on the template as it is
#   2. a temporary copy built from ai/site.spec.example.yaml: init.py, npm ci, new-entity.py --all, gen-fixtures.py,
#      then scripts/verify.sh there
#   3. in that copy: new-entity.py --backend for every entity (mocks off), then scripts/verify.sh --prod (the contract
#      tests and the production build with the mock guard)
#
#   scripts/template-selftest.sh            KEEP=1 keeps the copy (its path is printed)
# Needs python3, node/npm; no AWS. The copy reuses this checkout's .venv when there is one.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/template-selftest.XXXXXX")"
SITE="$WORK/site"
cleanup() { if [ "${KEEP:-0}" = 1 ]; then echo "kept: $SITE"; else rm -rf "$WORK"; fi; }
trap cleanup EXIT
RESULTS=()
t0=$SECONDS
stage() { echo; echo "==== $*"; }

[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -c "import yaml, jsonschema, faker, pytest, moto" 2>/dev/null || {
  .venv/bin/pip install -q -r api/requirements.txt && .venv/bin/pip install -q -r tests/requirements-test.txt; }
PY="$ROOT/.venv/bin/python"

stage "1/3 verify the template as it is"
if scripts/verify.sh; then RESULTS+=("ok    template: verify.sh"); else RESULTS+=("FAIL  template: verify.sh"); fi

stage "2/3 build the example site in $SITE"
"$PY" - "$SITE" <<'EOF'
import sys
from pathlib import Path
sys.path.insert(0, "scripts")
from sitegen import init_site
init_site.copy_tree(Path(sys.argv[1]))
EOF
cd "$SITE"
ln -s "$ROOT/.venv" .venv
cp ai/site.spec.example.yaml site.spec.yaml
example_ok=1
{
  "$PY" scripts/spec.py validate site.spec.yaml &&
  "$PY" scripts/init.py --spec site.spec.yaml &&
  npm ci --no-audit --no-fund --silent &&
  "$PY" scripts/new-entity.py --all &&
  "$PY" scripts/gen-fixtures.py &&
  scripts/verify.sh
} || example_ok=0
if [ "$example_ok" = 1 ]; then RESULTS+=("ok    example site: init, new-entity, gen-fixtures, verify.sh"); else RESULTS+=("FAIL  example site: init, new-entity, gen-fixtures, verify.sh"); fi

stage "3/3 give every example entity a backend, verify --prod"
if [ "$example_ok" = 1 ] && "$PY" scripts/new-entity.py --backend --all && scripts/verify.sh --prod; then
  RESULTS+=("ok    example site: new-entity --backend --all, verify.sh --prod")
else
  RESULTS+=("FAIL  example site: new-entity --backend --all, verify.sh --prod")
fi

echo
echo "template self-test ($((SECONDS - t0))s):"
printf '  %s\n' "${RESULTS[@]}"
if printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL'; then echo "template self-test: FAILED"; exit 1; fi
echo "template self-test: all green"
