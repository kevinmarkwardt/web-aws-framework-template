#!/usr/bin/env bash
# YourApp — Lambda code-only deploy (no CDK): bundle, zip and update each function's code via the AWS CLI.
# Faster than a full deploy for code changes; environment, IAM or new functions need scripts/deploy.sh.
#
# Usage: STAGE=test|prod scripts/deploy-lambdas.sh [api|daily-job|...]   (no name: all)
# Function names follow the stack's convention: $PREFIX-<name> (yourapp-api, yourapp-test-daily-job, ...).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-us-east-1}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

. "$ROOT/scripts/lib/stage.sh"
resolve_stage

if [ "$STAGE" = prod ] && [ "${YES:-}" != 1 ]; then
  [ -t 0 ] || { echo "deploy-lambdas: prod needs a typed confirmation (or YES=1)" >&2; exit 1; }
  read -r -p "Update PROD Lambda code? Type prod to continue: " answer
  [ "$answer" = prod ] || { echo "cancelled" >&2; exit 1; }
fi

echo "== bundling ($STAGE)"
"$ROOT/scripts/bundle-lambdas.sh" "$@"   # stops on any pip error

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  for d in "$ROOT"/build/*/; do names+=("$(basename "$d")"); done
fi

for name in "${names[@]}"; do
  func="$PREFIX-$name"
  zip_file="$TMP_DIR/$name.zip"
  (cd "$ROOT/build/$name" && zip -q -r "$zip_file" . -x '__pycache__/*' '*.pyc')
  echo "== $func ($(du -h "$zip_file" | cut -f1))"
  aws lambda update-function-code --function-name "$func" --zip-file "fileb://$zip_file" \
    --region "$REGION" --output text --query 'LastModified'
done
echo "== done"
