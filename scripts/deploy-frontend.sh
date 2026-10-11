#!/usr/bin/env bash
# YourApp — sites-only deploy: build the user site and the admin site, upload both, invalidate both distributions.
# Usage: STAGE=test|prod scripts/deploy-frontend.sh   (same as scripts/deploy.sh --site-only)
exec "$(cd "$(dirname "$0")" && pwd)/deploy.sh" --site-only
