#!/usr/bin/env bash
# YourApp deploy: bundle the Lambdas, deploy the CDK stack, build + upload both sites (user site and admin site),
# invalidate both CloudFront distributions.
#
# Usage: STAGE=test|prod scripts/deploy.sh [--infra-only|--site-only]
#   STAGE (required, no default)
#     test   YourAppTestStack  https://test.yourapp.com, https://admin.test.yourapp.com  (test login, noindex, disposable)
#     prod   YourAppStack      https://yourapp.com, https://admin.yourapp.com  (asks you to type "prod"; YES=1 skips, for CI)
#   --infra-only   Lambdas + CDK only;  --site-only   both sites only (needs an earlier full deploy of that stage)
# Writes cdk-outputs-{stage}.json (stack outputs), frontend/.env.production.local and admin/.env.production.local.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
MODE="${1:-all}"

die() { echo "deploy: $*" >&2; exit 1; }
case "$MODE" in all|--infra-only|--site-only) ;; *) die "usage: STAGE=prod|test $0 [--infra-only|--site-only]" ;; esac

. "$ROOT/scripts/lib/stage.sh"
. "$ROOT/scripts/lib/outputs.sh"
resolve_stage
out() { stack_output "$ROOT/$OUT_FILE" "$STACK" "$1"; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)" || die "no AWS credentials"
echo "== target: stage=$STAGE stack=$STACK account=$ACCOUNT region=$REGION ($MODE)"

if [ "$STAGE" = prod ] && [ "${YES:-}" != 1 ]; then
  [ -t 0 ] || die "prod needs a typed confirmation: run it in a terminal, or set YES=1"
  read -r -p "Deploy ($MODE) to PROD, account $ACCOUNT? Type prod to continue: " answer
  [ "$answer" = prod ] || die "cancelled"
fi

# ---- infrastructure: Lambda bundles + CDK
if [ "$MODE" != --site-only ]; then
  echo "== bundling Lambdas (Python 3.12, arm64)"
  "$ROOT/scripts/bundle-lambdas.sh"
  echo "== cdk deploy $STACK"
  cd "$ROOT/cdk"
  [ -d node_modules ] || npm ci --silent
  npx cdk deploy "$STACK" -c stage="$STAGE" --require-approval never --outputs-file "$ROOT/$OUT_FILE"
fi

# ---- site
if [ "$MODE" != --infra-only ]; then
  [ -f "$ROOT/$OUT_FILE" ] || die "$OUT_FILE is missing: run a full deploy of the $STAGE stage first"
  POOL="$(out UserPoolId)"
  CLIENT="$(out UserPoolClientId)"
  BUCKET="$(out SpaBucketName)"
  DIST="$(out CloudFrontDistributionId)"
  ADMIN_BUCKET="$(out AdminBucket)"
  ADMIN_DIST="$(out AdminDistributionId)"
  ADMIN_URL="$(out AdminUrl)"
  SITE_URL="https://$(out DomainName)"

  common_env() {
    echo "# written by scripts/deploy.sh for the $STAGE stage"
    echo "VITE_STAGE=$STAGE"
    echo "VITE_USER_POOL_ID=$POOL"
    echo "VITE_CLIENT_ID=$CLIENT"
  }
  { common_env; [ "$STAGE" != test ] || echo "VITE_TEST_LOGIN=1"; echo "VITE_ADMIN_URL=$ADMIN_URL"; } \
    > "$ROOT/frontend/.env.production.local"
  { common_env; echo "VITE_SITE_URL=$SITE_URL"; } > "$ROOT/admin/.env.production.local"

  echo "== building both sites ($STAGE)"
  cd "$ROOT"
  [ -d node_modules ] || npm ci --silent
  npm run build   # packages/shared (typecheck), frontend/, admin/

  # Vite's hashed assets never change, so browsers keep them for a year; everything else (index.html, icons) is
  # revalidated on every visit, so a deploy shows up at once. Old assets are kept (no --delete on assets/): a tab
  # opened before this deploy can still load its lazy chunks.
  upload() {  # upload DIST_DIR BUCKET
    echo "== uploading $1 to s3://$2"
    aws s3 sync "$1/assets/" "s3://$2/assets/" --region "$REGION" --only-show-errors \
      --cache-control "public, max-age=31536000, immutable"
    aws s3 sync "$1/" "s3://$2/" --delete --region "$REGION" --only-show-errors \
      --exclude "assets/*" --cache-control "no-cache"
  }
  upload "$ROOT/frontend/dist" "$BUCKET"
  upload "$ROOT/admin/dist" "$ADMIN_BUCKET"

  echo "== invalidating CloudFront (site and admin)"
  aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query 'Invalidation.Id' --output text
  aws cloudfront create-invalidation --distribution-id "$ADMIN_DIST" --paths "/*" --query 'Invalidation.Id' --output text
fi

echo "== done: https://$(out DomainName)  (admin: $(out AdminUrl))"
echo "   outputs: $ROOT/$OUT_FILE"
