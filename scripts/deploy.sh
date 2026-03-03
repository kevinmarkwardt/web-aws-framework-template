#!/usr/bin/env bash
# YourApp — Full deployment script
# Builds frontend, packages Lambdas, deploys CDK stack, syncs SPA, invalidates cache.
set -euo pipefail

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK_NAME="YourAppStack"
REGION="us-east-1"

echo "========================================="
echo "  YourApp — Full Deploy"
echo "========================================="

# ── 1. Install frontend dependencies ─────────────────────────────────────────
echo ""
echo "[1/6] Installing frontend dependencies..."
cd "$PROJ_ROOT/frontend"
npm ci --silent
echo "  Frontend dependencies installed."

# ── 2. Package Lambda functions ──────────────────────────────────────────────
echo ""
echo "[2/6] Packaging Lambda functions..."

LAMBDA_DIRS=(
  "$PROJ_ROOT/api"
  "$PROJ_ROOT/lambdas/crawler"
  "$PROJ_ROOT/lambdas/alerts"
  "$PROJ_ROOT/lambdas/digest"
  "$PROJ_ROOT/lambdas/reminders"
  "$PROJ_ROOT/lambdas/impact-scorer"
  "$PROJ_ROOT/lambdas/report-generator"
  "$PROJ_ROOT/lambdas/stripe-webhook"
)

for dir in "${LAMBDA_DIRS[@]}"; do
  name="$(basename "$dir")"
  echo "  Packaging $name..."
  if [ -f "$dir/requirements.txt" ]; then
    # Install Linux ARM64 wheels for Lambda (not local macOS binaries)
    pip install -q -r "$dir/requirements.txt" -t "$dir/" --upgrade \
      --platform manylinux2014_aarch64 \
      --implementation cp \
      --python-version 3.12 \
      --only-binary :all: 2>/dev/null || true
  fi
done
echo "  All Lambdas packaged."

# ── 3. CDK deploy ────────────────────────────────────────────────────────────
echo ""
echo "[3/6] Deploying CDK stack..."
cd "$PROJ_ROOT/cdk"
npm ci --silent
npx cdk deploy --require-approval never --outputs-file "$PROJ_ROOT/cdk-outputs.json"
echo "  CDK stack deployed."

# ── 4. Build frontend with CDK outputs ───────────────────────────────────────
echo ""
echo "[4/6] Building React frontend..."
USER_POOL_ID=$(jq -r ".${STACK_NAME}.UserPoolId" "$PROJ_ROOT/cdk-outputs.json")
CLIENT_ID=$(jq -r ".${STACK_NAME}.UserPoolClientId" "$PROJ_ROOT/cdk-outputs.json")

cat > "$PROJ_ROOT/frontend/.env" <<EOF
VITE_USER_POOL_ID=${USER_POOL_ID}
VITE_CLIENT_ID=${CLIENT_ID}
EOF

cd "$PROJ_ROOT/frontend"
npm run build
echo "  Frontend built with UserPoolId=${USER_POOL_ID}"

# ── 5. Sync frontend to S3 ──────────────────────────────────────────────────
echo ""
echo "[5/6] Syncing frontend to S3..."

SPA_BUCKET=$(jq -r ".${STACK_NAME}.SpaBucketName" "$PROJ_ROOT/cdk-outputs.json")
CF_DIST_ID=$(jq -r ".${STACK_NAME}.CloudFrontDistributionId" "$PROJ_ROOT/cdk-outputs.json")

aws s3 sync "$PROJ_ROOT/frontend/dist/" "s3://${SPA_BUCKET}/" \
  --delete \
  --region "$REGION"
echo "  Synced to s3://${SPA_BUCKET}/"

# ── 6. Invalidate CloudFront cache ──────────────────────────────────────────
echo ""
echo "[6/6] Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/*" \
  --region "$REGION" \
  --output text --query 'Invalidation.Id'
echo "  CloudFront invalidation created."

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  Deploy complete!"
echo "========================================="
echo ""

API_URL=$(jq -r ".${STACK_NAME}.ApiUrl" "$PROJ_ROOT/cdk-outputs.json")
CF_DOMAIN=$(jq -r ".${STACK_NAME}.CloudFrontDomain" "$PROJ_ROOT/cdk-outputs.json")
DOMAIN=$(jq -r ".${STACK_NAME}.DomainName" "$PROJ_ROOT/cdk-outputs.json")

echo "  Site:     https://${DOMAIN}"
echo "  CDN:      https://${CF_DOMAIN}"
echo "  API:      ${API_URL}"
echo ""
echo "  Outputs:  $PROJ_ROOT/cdk-outputs.json"
