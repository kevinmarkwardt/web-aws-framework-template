# shellcheck shell=bash
# Sourced by the scripts that read stack outputs (deploy.sh, deploy-lambdas.sh, local-test.sh). The outputs files are
# cdk-outputs-prod.json and cdk-outputs-test.json, written by scripts/deploy.sh.
#
# stack_output FILE STACK KEY prints that output, or stops the script when it is missing: never a site built with an
# empty pool id. Use it as an assignment, V="$(stack_output ...)", so that set -e stops on a missing one (inside
# echo "...$(...)" or export V="$(...)" the failure would be ignored).
stack_output() {
  local v
  v="$(jq -r --arg s "$2" --arg k "$3" '.[$s][$k] // empty' "$1" 2>/dev/null || true)"
  if [ -z "$v" ] || [ "$v" = null ]; then
    echo "$(basename "$0"): output $3 is missing from $1 (deploy the $2 stack first)" >&2
    exit 1
  fi
  printf '%s' "$v"
}
