#!/usr/bin/env bash
# Local copy of a deployed stage for fast iteration: the API runs from your working tree (restarts on every save)
# against that stage's real AWS resources (DynamoDB table, Cognito pool, Secrets Manager), and Vite serves the sites
# with hot reload, proxying /api to it (frontend/vite.config.ts, admin/vite.config.ts).
#
#   scripts/local-test.sh api     # both APIs on http://127.0.0.1:3000 (/api/admin/* -> admin_handler; restarts on save)
#   scripts/local-test.sh web     # user site on http://localhost:5173 (hot reload)
#   scripts/local-test.sh admin   # admin site on http://localhost:5174 (sign in with a Cognito admin: make-admin.py)
#
# STAGE defaults to test (username test login, the test table). STAGE=prod works too, but then your local code
# reads and writes PROD data with your AWS credentials: think twice.
# Needs: cdk-outputs-{stage}.json (from STAGE=test scripts/deploy.sh) and AWS CLI credentials.
# No deployed stage at all? `npm run dev` (user site) or `npm run dev:admin` (admin site, a mock admin) run with MOCK_AUTH
# and no backend (packages/shared/src/auth.ts).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${STAGE:-test}"
WEB_PORT=5173
ADMIN_PORT=5174
. "$ROOT/scripts/lib/stage.sh"
. "$ROOT/scripts/lib/outputs.sh"
resolve_stage
OUT="$ROOT/$OUT_FILE"
[ -f "$OUT" ] || { echo "missing $OUT: deploy the $STAGE stack once (STAGE=$STAGE scripts/deploy.sh)" >&2; exit 1; }
o() { stack_output "$OUT" "$STACK" "$1"; }

case "${1:-}" in
  api)
    VENV="$ROOT/.venv-local"
    if [ ! -x "$VENV/bin/python" ]; then
      python3 -m venv "$VENV"
      "$VENV/bin/pip" install -q -r "$ROOT/api/requirements.txt"
    fi
    export AWS_REGION="${AWS_REGION:-us-east-1}"
    export AWS_DEFAULT_REGION="$AWS_REGION"
    export STAGE
    TABLE_NAME="$(o TableName)"; USER_POOL_ID="$(o UserPoolId)"; USER_POOL_CLIENT_ID="$(o UserPoolClientId)"
    DAILY_JOB_FUNCTION="$(o DailyJobFunctionName)"; SECRET_PREFIX="$(o SecretPrefix)"; SITE_DOMAIN="$(o DomainName)"
    API_FUNCTION_NAME="$(o ApiFunctionName)"; BILLING_MODE="$(o BillingMode)"
    export TABLE_NAME USER_POOL_ID USER_POOL_CLIENT_ID DAILY_JOB_FUNCTION API_FUNCTION_NAME BILLING_MODE
    export STRIPE_SECRET_NAME="$SECRET_PREFIX/stripe"
    export FRONTEND_URL="http://localhost:$WEB_PORT" SITE_DOMAIN SITE_URL="http://localhost:$WEB_PORT"
    export SES_FROM_EMAIL="noreply@${SITE_DOMAIN#test.}"
    # the admin API's MFA gate as deployed (output AdminMfa; older stacks don't have it: off)
    ADMIN_MFA=0; if [ "$(jq -r --arg s "$STACK" '.[$s].AdminMfa // empty' "$OUT")" = required ]; then ADMIN_MFA=1; fi
    export ADMIN_MFA
    if [ "$STAGE" = test ]; then
      export TEST_LOGIN=1 TEST_LOGIN_SECRET_NAME="$SECRET_PREFIX/test-login"
    fi
    # no ORIGIN_VERIFY: there is no CloudFront locally, so the API accepts every request (api/lib/params.py)
    exec "$VENV/bin/python" "$ROOT/scripts/local-api.py"
    ;;
  web)
    POOL="$(o UserPoolId)"; CLIENT="$(o UserPoolClientId)"
    MODE="local-$STAGE"
    {
      echo "# written by scripts/local-test.sh: the local copy of the $STAGE stage"
      echo "VITE_STAGE=$STAGE"
      echo "VITE_USER_POOL_ID=$POOL"
      echo "VITE_CLIENT_ID=$CLIENT"
      if [ "$STAGE" = test ]; then echo "VITE_TEST_LOGIN=1"; fi
      echo "VITE_ADMIN_URL=http://localhost:$ADMIN_PORT"
    } > "$ROOT/frontend/.env.$MODE.local"
    [ -d "$ROOT/node_modules" ] || (cd "$ROOT" && npm ci --silent)
    cd "$ROOT/frontend"
    exec npx vite --mode "$MODE" --port "$WEB_PORT" --strictPort
    ;;
  admin)
    POOL="$(o UserPoolId)"; CLIENT="$(o UserPoolClientId)"
    MODE="local-$STAGE"
    {
      echo "# written by scripts/local-test.sh: the local copy of the $STAGE stage's admin site"
      echo "VITE_STAGE=$STAGE"
      echo "VITE_USER_POOL_ID=$POOL"
      echo "VITE_CLIENT_ID=$CLIENT"
      echo "VITE_SITE_URL=http://localhost:$WEB_PORT"
    } > "$ROOT/admin/.env.$MODE.local"
    [ -d "$ROOT/node_modules" ] || (cd "$ROOT" && npm ci --silent)
    cd "$ROOT/admin"
    exec npx vite --mode "$MODE" --port "$ADMIN_PORT" --strictPort
    ;;
  *)
    echo "usage: [STAGE=test|prod] scripts/local-test.sh api|web|admin" >&2; exit 2 ;;
esac
