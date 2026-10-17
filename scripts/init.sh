#!/usr/bin/env bash
# init.sh: the interactive way in. Asks for the basics, writes a minimal site.spec.yaml (when there is none) and runs
# scripts/init.py with it, which does the actual work (placeholders, config, languages; see its --help).
#
#   ./scripts/init.sh
#
# Building a whole site with an AI agent? Skip this: the agent writes a full site.spec.yaml (ai/PLAYBOOK.md) and runs
# python3 scripts/init.py --spec site.spec.yaml itself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SPEC="$ROOT/site.spec.yaml"

if [ ! -x .venv/bin/python ] || ! .venv/bin/python -c "import yaml, jsonschema" 2>/dev/null; then
  echo "Installing the tooling into .venv (scripts/requirements.txt)..."
  [ -x .venv/bin/python ] || python3 -m venv .venv
  .venv/bin/pip install -q -r scripts/requirements.txt
fi

if [ -f "$SPEC" ]; then
  echo "Using the existing site.spec.yaml (delete it to start over with questions)."
else
  echo "web-aws-framework-template: project setup"
  echo
  read -r -p "Project name (lowercase letters, digits, -; e.g. myapp): " NAME
  NAME="$(echo "${NAME:-myapp}" | tr '[:upper:] ' '[:lower:]-')"
  read -r -p "Display name (e.g. MyApp): " DISPLAY
  DISPLAY="${DISPLAY:-MyApp}"
  read -r -p "Domain (e.g. myapp.com): " DOMAIN
  DOMAIN="${DOMAIN:-myapp.com}"
  read -r -p "AWS account ID (12 digits, Enter to skip): " ACCOUNT
  read -r -p "Admin email (alerts, disputes; Enter to skip): " ADMIN
  read -r -p "Billing: none, subscriptions, credits or both [both]: " MODE
  MODE="${MODE:-both}"

  {
    echo "# Written by scripts/init.sh. The full format: ai/site.spec.schema.json (example: ai/site.spec.example.yaml)."
    echo "version: 1"
    echo "site:"
    echo "  name: $NAME"
    echo "  displayName: \"$DISPLAY\""
    echo "  domain: $DOMAIN"
    [ -n "$ACCOUNT" ] && echo "  awsAccountId: \"$ACCOUNT\""
    [ -n "$ADMIN" ] && echo "  adminEmail: $ADMIN"
    echo "  awsRegion: us-east-1"
    echo "modules:"
    echo "  billing:"
    echo "    mode: $MODE"
    if [ "$MODE" = subscriptions ] || [ "$MODE" = both ]; then
      echo "    plans:"
      echo "      - { id: starter, name: Starter, monthlyUsd: 9, limits: { items: 100 } }"
      echo "      - { id: pro, name: Pro, monthlyUsd: 19, limits: { items: null } }"
    fi
    if [ "$MODE" = credits ] || [ "$MODE" = both ]; then
      echo "    packs: [{ usd: 5 }, { usd: 10 }, { usd: 20, bonusPct: 10 }, { usd: 50, bonusPct: 20 }]"
    fi
    echo "  i18n: { languages: [en] }"
    echo "  support: true"
    echo "entities: []"
    echo "pages: []"
  } > "$SPEC"
  echo "Wrote site.spec.yaml."
fi

.venv/bin/python scripts/spec.py validate site.spec.yaml
.venv/bin/python scripts/init.py --spec site.spec.yaml

cat <<'EOF'

Next steps:
  1. npm install, then scripts/verify.sh
  2. A Route 53 hosted zone for your domain; deploy the test stage first, then prod:
       STAGE=test ./scripts/deploy.sh      STAGE=prod ./scripts/deploy.sh
  3. Sign up on the site, then make yourself an admin: .venv/bin/python scripts/make-admin.py test you@example.com
  4. Stripe keys live in Secrets Manager, never in .env: scripts/stripe-secret.sh test, then
     .venv/bin/python scripts/stripe-setup.py test --apply
  5. Your domain: add entities to site.spec.yaml, then python3 scripts/new-entity.py --all and
     python3 scripts/gen-fixtures.py (CLAUDE.md, "AI site builder").
EOF
