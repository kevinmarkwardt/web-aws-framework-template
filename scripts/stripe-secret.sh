#!/usr/bin/env bash
# Store a stage's Stripe secret key in AWS Secrets Manager without it touching the screen, shell history or the repo.
#   scripts/stripe-secret.sh test    -> yourapp/test/stripe  (sandbox key: sk_test_... or rk_test_...)
#   scripts/stripe-secret.sh prod    -> yourapp/prod/stripe  (live key:    sk_live_... or rk_live_...)
# The secret is JSON {"secretKey": ..., "webhookSecret": ..., ...}: other fields already there are kept, and
# scripts/stripe-setup.py adds webhookSecret afterwards. The key is read with a hidden prompt and never echoed.
set -euo pipefail
STAGE_ARG="${1:-}"
case "$STAGE_ARG" in
  test) PREFIX="sk_test_|rk_test_" ;;
  prod) PREFIX="sk_live_|rk_live_" ;;
  *) echo "usage: $0 test|prod" >&2; exit 2 ;;
esac
NAME="yourapp/$STAGE_ARG/stripe"
REGION="${AWS_REGION:-us-east-1}"

read -rsp "Paste the Stripe secret key for $STAGE_ARG (input hidden): " KEY
echo
if ! [[ "$KEY" =~ ^($PREFIX)[A-Za-z0-9]+$ ]]; then
  unset KEY
  echo "That isn't a $STAGE_ARG key (expected ${PREFIX//|/ or }...). Nothing saved." >&2
  exit 1
fi

# Keep the other fields (webhookSecret, publishableKey) when the secret already exists.
EXISTING="$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$NAME" --query SecretString --output text 2>/dev/null || true)"
PAYLOAD="$(KEY="$KEY" EXISTING="$EXISTING" python3 -c '
import json, os
cur = {}
try:
    cur = json.loads(os.environ["EXISTING"]) if os.environ["EXISTING"] else {}
except ValueError:
    pass
cur["secretKey"] = os.environ["KEY"]
print(json.dumps(cur))')"
unset KEY EXISTING

# via a private temp file, so the key never appears in the process list
TMP="$(mktemp)"; chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
printf '%s' "$PAYLOAD" > "$TMP"
unset PAYLOAD
if aws secretsmanager describe-secret --region "$REGION" --secret-id "$NAME" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --region "$REGION" --secret-id "$NAME" --secret-string "file://$TMP" >/dev/null
else
  aws secretsmanager create-secret --region "$REGION" --name "$NAME" \
    --description "Stripe keys for YourApp ($STAGE_ARG). Read at runtime by the API; never commit." \
    --secret-string "file://$TMP" >/dev/null
fi
echo "Saved to Secrets Manager: $NAME (next: .venv/bin/python scripts/stripe-setup.py $STAGE_ARG)"
