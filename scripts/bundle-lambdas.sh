#!/usr/bin/env bash
# Build each Lambda's deployment folder under build/ (the CDK stack deploys these, never the source folders):
#   build/api          api/ + the exact, hash-checked versions in api/requirements.txt (scripts/lock-api-deps.sh)
#   build/<worker>     lambdas/<worker>/ + its requirements.txt, if it has one
# Dependencies are Linux ARM64 wheels for Python 3.12 (the Lambdas run on Graviton), whatever machine builds them.
# A pip failure stops the script: a Lambda must never ship without its dependencies.
#
# Usage: scripts/bundle-lambdas.sh [name ...]     (no names: all of them)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${DEPLOY_VENV:-$ROOT/.venv-deploy}"   # a venv: Ubuntu's system pip refuses installs (PEP 668)
[ -x "$VENV/bin/pip" ] || python3 -m venv "$VENV"

bundle() {
  local name="$1" src="$2" out="$ROOT/build/$1"
  echo "  bundling $name"
  rm -rf "$out" && mkdir -p "$out"
  (cd "$src" && tar --exclude=__pycache__ --exclude='*.pyc' --exclude=.pytest_cache -cf - .) | (cd "$out" && tar -xf -)
  local reqs="$src/requirements.txt"
  if [ -f "$reqs" ] && grep -qvE '^[[:space:]]*(#|$)' "$reqs"; then
    local hashes=()
    grep -q -- '--hash=' "$reqs" && hashes=(--require-hashes)
    "$VENV/bin/pip" install -q --disable-pip-version-check ${hashes[@]+"${hashes[@]}"} -r "$reqs" -t "$out" \
      --platform manylinux2014_aarch64 --implementation cp --python-version 3.12 --only-binary :all:
  fi
}

declare -A SOURCES=(["api"]="$ROOT/api")
for dir in "$ROOT"/lambdas/*/; do
  SOURCES["$(basename "$dir")"]="${dir%/}"
done

names=("$@")
[ ${#names[@]} -gt 0 ] || names=("${!SOURCES[@]}")
for name in "${names[@]}"; do
  [ -n "${SOURCES[$name]:-}" ] || { echo "bundle-lambdas: unknown Lambda '$name' (have: ${!SOURCES[*]})" >&2; exit 1; }
  bundle "$name" "${SOURCES[$name]}"
done
