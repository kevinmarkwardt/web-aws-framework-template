#!/usr/bin/env bash
# The one gate before a commit, a PR or a deploy: every check the repo has, a summary, non-zero on any failure.
#
#   scripts/verify.sh          spec, pytest, entity contract tests, lint + i18n check, typecheck, both builds, cdk tsc
#   scripts/verify.sh --prod   also the production build of both sites (VITE_STAGE=prod), which fails while any entity
#                              is still mocked (packages/shared/src/mocks/mocks.config.ts)
#
# Installs what is missing first (.venv with the API, test and tooling requirements; node_modules; cdk/node_modules).
# No AWS calls. Each failing step prints the tail of its output.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROD=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "usage: scripts/verify.sh [--prod]" >&2; exit 2 ;;
  esac
done

PY="$ROOT/.venv/bin/python"
SUMMARY=()
FAILED=0
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

step() {  # step "name" command...
  local name="$1"; shift
  local t0=$SECONDS
  if "$@" >"$LOG" 2>&1; then
    SUMMARY+=("ok    $name ($((SECONDS - t0))s)")
  else
    SUMMARY+=("FAIL  $name")
    FAILED=1
    echo "---- $name failed:" >&2
    tail -n 40 "$LOG" >&2
  fi
}
skip() { SUMMARY+=("skip  $1"); }

# ---- dependencies
setup_python() {
  [ -x "$PY" ] || python3 -m venv "$ROOT/.venv"
  if ! "$PY" -c "import pytest, moto, yaml, jsonschema, faker, stripe" 2>/dev/null; then
    "$PY" -m pip install -q -r api/requirements.txt && "$PY" -m pip install -q -r tests/requirements-test.txt
  fi
}
setup_node() {
  [ -d node_modules ] || npm ci --no-audit --no-fund
  [ -d cdk/node_modules ] || (cd cdk && npm ci --no-audit --no-fund)
}
step "dependencies" bash -c "$(declare -f setup_python setup_node); PY='$PY'; ROOT='$ROOT'; setup_python && setup_node"

# ---- checks
if [ -f site.spec.yaml ]; then step "spec (site.spec.yaml)" "$PY" scripts/spec.py validate site.spec.yaml; else skip "spec (no site.spec.yaml: the template itself)"; fi
step "pytest" "$PY" -m pytest tests/ -q --ignore-glob='tests/test_entity_*.py'
if compgen -G "tests/test_entity_*.py" >/dev/null; then
  step "contract tests (entities with a backend)" "$PY" -m pytest -q tests/test_entity_*.py
else
  skip "contract tests (no entity has a backend yet: new-entity.py --backend)"
fi
step "lint + i18n check" npm run lint --silent
step "typecheck (shared, frontend, admin)" bash -c "npm run build --silent -w packages/shared && (cd frontend && npx tsc -b) && (cd admin && npx tsc -b)"
step "build (frontend, admin)" bash -c "(cd frontend && npx vite build --logLevel error) && (cd admin && npx vite build --logLevel error)"
step "cdk typecheck" bash -c "cd cdk && npx tsc --noEmit"
if [ "$PROD" = 1 ]; then
  OUT="$(mktemp -d)"
  step "prod build + mock guard (VITE_STAGE=prod)" bash -c "(cd frontend && VITE_STAGE=prod npx vite build --logLevel error --outDir '$OUT/frontend' --emptyOutDir) && (cd admin && VITE_STAGE=prod npx vite build --logLevel error --outDir '$OUT/admin' --emptyOutDir)"
  rm -rf "$OUT"
fi

echo
echo "verify: $(basename "$ROOT")"
printf '  %s\n' "${SUMMARY[@]}"
if [ "$FAILED" = 1 ]; then
  echo "verify: FAILED"
  exit 1
fi
echo "verify: all green"
