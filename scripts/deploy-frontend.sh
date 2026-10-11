#!/usr/bin/env bash
# YourApp — frontend-only deploy: build the site, upload it, invalidate CloudFront.
# Usage: STAGE=test|prod scripts/deploy-frontend.sh   (same as scripts/deploy.sh --site-only)
exec "$(cd "$(dirname "$0")" && pwd)/deploy.sh" --site-only
