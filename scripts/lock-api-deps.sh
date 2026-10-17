#!/usr/bin/env bash
# Rewrite api/requirements.txt from api/requirements.in: every package pinned, with hashes for all platforms (the Lambda
# installs the manylinux aarch64 wheels, your machine its own). Run after editing api/requirements.in, with the Lambda's
# Python (3.12). scripts/bundle-lambdas.sh installs with --require-hashes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${LOCK_VENV:-$ROOT/.venv-lock}"
[ -x "$VENV/bin/pip-compile" ] || { python3 -m venv "$VENV" && "$VENV/bin/pip" install -q pip-tools; }
cd "$ROOT/api"
CUSTOM_COMPILE_COMMAND="scripts/lock-api-deps.sh" "$VENV/bin/pip-compile" -q --generate-hashes --allow-unsafe \
  --strip-extras --no-emit-index-url -o requirements.txt requirements.in
echo "wrote api/requirements.txt"
