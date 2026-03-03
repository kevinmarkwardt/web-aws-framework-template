#!/usr/bin/env bash
# LinkKeeper — Admin credential setup
# Creates or updates the admin secret in AWS Secrets Manager.
# Secret: linkkeeper/admin-credentials  (us-east-1)
set -euo pipefail

ADMIN_EMAIL="kevinmarkwardt@gmail.com"

echo "========================================="
echo "  LinkKeeper — Admin Credential Setup"
echo "========================================="
echo ""
echo "  Email:  $ADMIN_EMAIL"
echo ""

# ── 1. Prompt for password ───────────────────────────────────────────────────

read -rsp "Enter admin password: " PASSWORD
echo ""
read -rsp "Confirm admin password: " PASSWORD_CONFIRM
echo ""

if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
  echo "ERROR: Passwords do not match." >&2
  exit 1
fi

if [ -z "$PASSWORD" ]; then
  echo "ERROR: Password cannot be empty." >&2
  exit 1
fi

# ── 2. Hash, generate JWT secret, and store in Secrets Manager ───────────────
# Write Python script to temp file so stdin is free for the password pipe.

echo ""
echo "Hashing password and storing secret..."

TMPSCRIPT=$(mktemp /tmp/lk-setup-XXXX.py)
trap 'rm -f "$TMPSCRIPT"' EXIT

cat > "$TMPSCRIPT" << 'PYEOF'
import sys, json, bcrypt, secrets, boto3

password = sys.stdin.read().encode("utf-8")
password_hash = bcrypt.hashpw(password, bcrypt.gensalt(rounds=12)).decode("utf-8")
jwt_secret = secrets.token_hex(32)

secret_value = json.dumps({
    "email": "kevinmarkwardt@gmail.com",
    "passwordHash": password_hash,
    "jwtSecret": jwt_secret,
})

client = boto3.client("secretsmanager", region_name="us-east-1")
secret_name = "linkkeeper/admin-credentials"

try:
    client.describe_secret(SecretId=secret_name)
    client.put_secret_value(SecretId=secret_name, SecretString=secret_value)
    print("  Updated existing secret.")
except client.exceptions.ResourceNotFoundException:
    client.create_secret(Name=secret_name, SecretString=secret_value)
    print("  Created new secret.")

print()
print("=========================================")
print("  Admin credentials stored successfully!")
print("=========================================")
print()
print(f"  Email:  kevinmarkwardt@gmail.com")
print(f"  Hash:   {password_hash[:20]}...")
print()
PYEOF

printf '%s' "$PASSWORD" | python3 "$TMPSCRIPT"
