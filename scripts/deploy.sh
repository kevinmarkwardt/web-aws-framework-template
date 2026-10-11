#!/usr/bin/env bash
# YourApp deploy: bundle the Lambdas, deploy the CDK stack, build + upload the site, invalidate CloudFront.
#
# Usage: STAGE=test|prod scripts/deploy.sh [--infra-only|--site-only]
#   STAGE (required, no default)
#     test   YourAppTestStack  https://test.yourapp.com  (username test login, noindex, disposable resources)
#     prod   YourAppStack      https://yourapp.com       (asks you to type "prod" first; YES=1 skips that, for CI)
#   --infra-only   Lambdas + CDK only;  --site-only   frontend only (needs an earlier full deploy of that stage)
# Writes cdk-outputs-{stage}.json (stack outputs) and frontend/.env.production.local (the site's Cognito ids).
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

  echo "== building site ($STAGE)"
  {
    echo "# written by scripts/deploy.sh for the $STAGE stage"
    echo "VITE_STAGE=$STAGE"
    echo "VITE_USER_POOL_ID=$POOL"
    echo "VITE_CLIENT_ID=$CLIENT"
    if [ "$STAGE" = test ]; then echo "VITE_TEST_LOGIN=1"; fi
  } > "$ROOT/frontend/.env.production.local"
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm ci --silent
  npm run build

  echo "== uploading site to s3://$BUCKET"
  # Vite's hashed assets never change, so browsers keep them for a year; everything else (index.html, icons) is
  # revalidated on every visit, so a deploy shows up at once. Old assets are kept (no --delete on assets/): a tab
  # opened before this deploy can still load its lazy chunks.
  aws s3 sync dist/assets/ "s3://$BUCKET/assets/" --region "$REGION" --only-show-errors \
    --cache-control "public, max-age=31536000, immutable"
  aws s3 sync dist/ "s3://$BUCKET/" --delete --region "$REGION" --only-show-errors \
    --exclude "assets/*" --cache-control "no-cache"

  echo "== invalidating CloudFront"
  aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query 'Invalidation.Id' --output text
fi

echo "== done: https://$(out DomainName)  (admin: https://$(out AdminDomain))"
echo "   outputs: $ROOT/$OUT_FILE"
