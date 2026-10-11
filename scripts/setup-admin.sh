#!/usr/bin/env bash
# YourApp — admin credential setup for the manager.* admin site.
# Creates or updates the admin secret yourapp/{stage}/admin-credentials in AWS Secrets Manager:
# {"email", "passwordHash" (bcrypt), "jwtSecret" (new random key: signs out existing admin sessions)}.
#
# Usage: STAGE=test|prod scripts/setup-admin.sh <admin-email>
# Needs Python with boto3 + bcrypt (the test venv .venv has both: pip install -r api/requirements.txt).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/stage.sh"
resolve_stage

ADMIN_EMAIL="${1:-}"
if [[ ! "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "usage: STAGE=test|prod $0 <admin-email>" >&2
  exit 1
fi
SECRET_NAME="yourapp/$STAGE/admin-credentials"
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if [ -x "$ROOT/.venv/bin/python" ]; then PYTHON="$ROOT/.venv/bin/python"; else PYTHON=python3; fi
fi

echo "========================================="
echo "  YourApp — Admin Credential Setup"
echo "========================================="
echo ""
echo "  Stage:  $STAGE"
echo "  Secret: $SECRET_NAME"
echo "  Email:  $ADMIN_EMAIL"
echo ""

read -rsp "Enter admin password: " PASSWORD
echo ""
read -rsp "Confirm admin password: " PASSWORD_CONFIRM
echo ""

if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
  echo "ERROR: Passwords do not match." >&2
  exit 1
fi
if [ ${#PASSWORD} -lt 12 ]; then
  echo "ERROR: Use at least 12 characters." >&2
  exit 1
fi

echo ""
echo "Hashing password and storing secret..."

# The password goes in on stdin (never on a command line or in the environment); email and names via the environment.
printf '%s' "$PASSWORD" | ADMIN_EMAIL="$ADMIN_EMAIL" SECRET_NAME="$SECRET_NAME" AWS_REGION="${AWS_REGION:-us-east-1}" \
  "$PYTHON" -c '
import json, os, secrets, sys

import bcrypt, boto3

password = sys.stdin.read().encode("utf-8")
secret_value = json.dumps({
    "email": os.environ["ADMIN_EMAIL"],
    "passwordHash": bcrypt.hashpw(password, bcrypt.gensalt(rounds=12)).decode("utf-8"),
    "jwtSecret": secrets.token_hex(32),
})
client = boto3.client("secretsmanager", region_name=os.environ["AWS_REGION"])
name = os.environ["SECRET_NAME"]
try:
    client.describe_secret(SecretId=name)
    client.put_secret_value(SecretId=name, SecretString=secret_value)
    print("  Updated existing secret.")
except client.exceptions.ResourceNotFoundException:
    client.create_secret(Name=name, SecretString=secret_value)
    print("  Created new secret.")
'

echo ""
echo "  Admin credentials stored for $ADMIN_EMAIL ($STAGE). Warm API Lambdas pick them up within 5 minutes."
