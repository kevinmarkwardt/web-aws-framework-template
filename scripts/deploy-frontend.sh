#!/usr/bin/env bash
# YourApp — Frontend-only deploy
# Builds React app, syncs to S3, invalidates CloudFront.
set -euo pipefail

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK_NAME="YourAppStack"
REGION="us-east-1"

echo "========================================="
echo "  YourApp — Frontend Deploy"
echo "========================================="

# Get outputs from CDK (must have been deployed at least once)
if [ ! -f "$PROJ_ROOT/cdk-outputs.json" ]; then
  echo "Error: cdk-outputs.json not found. Run scripts/deploy.sh first."
  exit 1
fi

SPA_BUCKET=$(jq -r ".${STACK_NAME}.SpaBucketName" "$PROJ_ROOT/cdk-outputs.json")
CF_DIST_ID=$(jq -r ".${STACK_NAME}.CloudFrontDistributionId" "$PROJ_ROOT/cdk-outputs.json")

# ── 1. Build ─────────────────────────────────────────────────────────────────
echo ""
echo "[1/3] Building React frontend..."

# Generate .env from CDK outputs so Vite embeds correct Cognito IDs
USER_POOL_ID=$(jq -r ".${STACK_NAME}.UserPoolId" "$PROJ_ROOT/cdk-outputs.json")
CLIENT_ID=$(jq -r ".${STACK_NAME}.UserPoolClientId" "$PROJ_ROOT/cdk-outputs.json")
cat > "$PROJ_ROOT/frontend/.env" <<EOF
VITE_USER_POOL_ID=${USER_POOL_ID}
VITE_CLIENT_ID=${CLIENT_ID}
EOF

cd "$PROJ_ROOT/frontend"
npm ci --silent
npm run build
echo "  Built -> frontend/dist/"

# ── 2. Sync to S3 ────────────────────────────────────────────────────────────
echo ""
echo "[2/3] Syncing to S3..."
aws s3 sync "$PROJ_ROOT/frontend/dist/" "s3://${SPA_BUCKET}/" \
  --delete \
  --region "$REGION"
echo "  Synced to s3://${SPA_BUCKET}/"

# ── 3. Invalidate CloudFront ─────────────────────────────────────────────────
echo ""
echo "[3/3] Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/*" \
  --region "$REGION" \
  --output text --query 'Invalidation.Id')
echo "  Invalidation: ${INVALIDATION_ID}"

echo ""
echo "Frontend deployed to https://yourapp.com"
