# shellcheck shell=bash
# Sourced by the deploy and local scripts. resolve_stage turns STAGE (prod | test) into:
#   STACK     the CDK stack id (cdk/bin/yourapp.ts)
#   PREFIX    the resource name prefix (Lambda names are $PREFIX-api, $PREFIX-daily-job, ...)
#   OUT_FILE  the stack outputs file scripts/deploy.sh writes (repo root)
# and stops the script on anything else.
# shellcheck disable=SC2034  # STACK, PREFIX and OUT_FILE are read by the scripts that source this
resolve_stage() {
  case "${STAGE:-}" in
    prod) STACK=YourAppStack;     PREFIX=yourapp ;;
    test) STACK=YourAppTestStack; PREFIX=yourapp-test ;;
    *) echo "$(basename "$0"): set STAGE=prod or STAGE=test (got '${STAGE:-}')" >&2; exit 1 ;;
  esac
  OUT_FILE="cdk-outputs-$STAGE.json"
}
