#!/usr/bin/env bash
# init.sh — Initialize a new project from web-aws-framework-template
#
# Run this script once after cloning the template:
#   ./scripts/init.sh
#
# It will prompt for your project details and replace all placeholder
# values throughout the codebase.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Cross-platform sed -i (inline, for use with xargs via a helper below)
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_INPLACE=(-i '')
else
  SED_INPLACE=(-i)
fi

# Apply a sed expression to all files in $FILES
sed_files() {
  local expr="$1"
  while IFS= read -r f; do
    sed "${SED_INPLACE[@]}" "$expr" "$f"
  done <<< "$FILES"
}

# Apply sed to a single specific file
sedi() { sed "${SED_INPLACE[@]}" "$@"; }

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   web-aws-framework-template — Project Setup ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "This script will customize the template for your project."
echo "You can re-run it, but it only works on pristine template files."
echo ""

# ── Prompts ──────────────────────────────────────────────────────────────────

read -p "Project name (lowercase, no spaces, e.g. 'myapp'): " PROJECT_NAME
PROJECT_NAME="${PROJECT_NAME:-myapp}"
PROJECT_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')

read -p "Display name (title case, e.g. 'MyApp'): " DISPLAY_NAME
DISPLAY_NAME="${DISPLAY_NAME:-MyApp}"

read -p "Domain name (e.g. 'myapp.com'): " DOMAIN
DOMAIN="${DOMAIN:-myapp.com}"

read -p "AWS Account ID (12 digits): " AWS_ACCOUNT_ID
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-123456789012}"

echo ""
echo -e "${YELLOW}Will apply these substitutions:${NC}"
echo "  yourapp          → $PROJECT_NAME"
echo "  YourApp          → $DISPLAY_NAME"
echo "  yourapp.com      → $DOMAIN"
echo "  YOUR_AWS_ACCOUNT_ID → $AWS_ACCOUNT_ID"
echo ""
read -p "Continue? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# ── File targets ──────────────────────────────────────────────────────────────

FILES=$(find . \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -not -path './frontend/node_modules/*' \
  -not -path './cdk/node_modules/*' \
  -not -path './.venv/*' \
  -not -path './__pycache__/*' \
  -not -path './cdk/cdk.out/*' \
  -not -path './frontend/dist/*' \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.sh' \
     -o -name '*.json' -o -name '*.md' -o -name '*.txt' -o -name '*.css' \
     -o -name '*.example' \) \
  -type f)

COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
echo ""
echo -e "Updating ${GREEN}$COUNT${NC} files..."
echo ""

# ── Substitutions (order matters — longer strings first) ──────────────────────

sed_files "s/YOUR_AWS_ACCOUNT_ID/$AWS_ACCOUNT_ID/g"
echo -e "  ${GREEN}✓${NC} AWS Account ID"

sed_files "s/manager\.yourapp\.com/manager.$DOMAIN/g"
sed_files "s/yourapp\.com/$DOMAIN/g"
echo -e "  ${GREEN}✓${NC} Domain name"

sed_files "s/YourApp/$DISPLAY_NAME/g"
echo -e "  ${GREEN}✓${NC} Display name"

sed_files "s/yourapp/$PROJECT_NAME/g"
echo -e "  ${GREEN}✓${NC} Project name"

# ── Rename CDK files ──────────────────────────────────────────────────────────

if [ -f "cdk/bin/yourapp.ts" ]; then
  mv "cdk/bin/yourapp.ts" "cdk/bin/${PROJECT_NAME}.ts"
  echo -e "  ${GREEN}✓${NC} Renamed cdk/bin/yourapp.ts → cdk/bin/${PROJECT_NAME}.ts"
fi

if [ -f "cdk/lib/yourapp-stack.ts" ]; then
  mv "cdk/lib/yourapp-stack.ts" "cdk/lib/${PROJECT_NAME}-stack.ts"
  echo -e "  ${GREEN}✓${NC} Renamed cdk/lib/yourapp-stack.ts → cdk/lib/${PROJECT_NAME}-stack.ts"
fi

# Fix the import in the renamed bin file
if [ -f "cdk/bin/${PROJECT_NAME}.ts" ]; then
  sedi "s|../lib/yourapp-stack|../lib/${PROJECT_NAME}-stack|g" "cdk/bin/${PROJECT_NAME}.ts"
fi

# Update cdk.json app entry
if [ -f "cdk/cdk.json" ]; then
  sedi "s|bin/yourapp.ts|bin/${PROJECT_NAME}.ts|g" cdk/cdk.json
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}✓ Done! Your project is ready.${NC}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Copy the environment template and fill in your secrets:"
echo "     cp .env.example .env"
echo "     # Fill in: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,"
echo "     # STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO"
echo ""
echo "  2. Ensure your domain is registered in AWS Route53"
echo "     (or update cdk/lib/${PROJECT_NAME}-stack.ts if using a different DNS)"
echo ""
echo "  3. Deploy to AWS:"
echo "     ./scripts/deploy.sh"
echo ""
echo "  4. Set up your admin credentials:"
echo "     ./scripts/setup-admin.sh"
echo ""
echo "  5. Customize your app:"
echo "     - Replace 'items' with your domain entity in:"
echo "       api/routes/items.py, frontend/src/pages/dashboard/ItemsPage.tsx"
echo "     - Update the landing page: frontend/src/pages/LandingPage.tsx"
echo "     - Add your scheduled job logic: lambdas/daily-job/handler.py"
echo ""
echo "Good luck!"
echo ""
