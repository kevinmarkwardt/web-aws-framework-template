#!/usr/bin/env bash
# LinkKeeper — Lambda-only deploy
# Packages each Lambda with dependencies and updates function code via AWS CLI.
set -euo pipefail

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="us-east-1"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "========================================="
echo "  LinkKeeper — Lambda Deploy"
echo "========================================="

# Lambda name -> source directory mapping
declare -A LAMBDAS=(
  ["linkkeeper-api"]="$PROJ_ROOT/api"
  ["linkkeeper-crawler"]="$PROJ_ROOT/lambdas/crawler"
  ["linkkeeper-alerts"]="$PROJ_ROOT/lambdas/alerts"
  ["linkkeeper-digest"]="$PROJ_ROOT/lambdas/digest"
  ["linkkeeper-reminders"]="$PROJ_ROOT/lambdas/reminders"
  ["linkkeeper-impact-scorer"]="$PROJ_ROOT/lambdas/impact-scorer"
  ["linkkeeper-report-generator"]="$PROJ_ROOT/lambdas/report-generator"
  ["linkkeeper-stripe-webhook"]="$PROJ_ROOT/lambdas/stripe-webhook"
)

# Allow deploying a single Lambda: ./deploy-lambdas.sh linkkeeper-api
FILTER="${1:-}"

for func_name in "${!LAMBDAS[@]}"; do
  if [ -n "$FILTER" ] && [ "$func_name" != "$FILTER" ]; then
    continue
  fi

  src_dir="${LAMBDAS[$func_name]}"
  zip_file="$TMP_DIR/${func_name}.zip"

  echo ""
  echo "Packaging $func_name..."

  # Create a clean package directory
  pkg_dir="$TMP_DIR/pkg-${func_name}"
  mkdir -p "$pkg_dir"

  # Install dependencies if requirements.txt exists
  if [ -f "$src_dir/requirements.txt" ]; then
    pip install -q -r "$src_dir/requirements.txt" -t "$pkg_dir/" \
      --platform manylinux2014_aarch64 \
      --implementation cp \
      --python-version 3.12 \
      --only-binary :all: 2>/dev/null || true
  fi

  # Copy source files
  cp -r "$src_dir/"*.py "$pkg_dir/" 2>/dev/null || true
  # Copy sub-packages (e.g., api/lib/, api/routes/)
  for subdir in "$src_dir"/*/; do
    if [ -d "$subdir" ] && [ "$(basename "$subdir")" != "__pycache__" ]; then
      cp -r "$subdir" "$pkg_dir/"
    fi
  done

  # Create zip
  cd "$pkg_dir"
  zip -q -r "$zip_file" . -x '__pycache__/*' '*.pyc'
  cd "$PROJ_ROOT"

  ZIP_SIZE=$(du -h "$zip_file" | cut -f1)
  echo "  Packaged: $ZIP_SIZE"

  # Update function code
  echo "  Updating $func_name..."
  aws lambda update-function-code \
    --function-name "$func_name" \
    --zip-file "fileb://${zip_file}" \
    --region "$REGION" \
    --output text --query 'LastModified'

  echo "  Done: $func_name"
done

echo ""
echo "========================================="
echo "  All Lambdas deployed."
echo "========================================="
