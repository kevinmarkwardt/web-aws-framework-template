#!/usr/bin/env bash
# OPTIONAL: deploy infra/email-forwarding.yaml (mail to MAILBOX at the domain -> SES -> S3 -> forwarded to FORWARD_TO).
#
#   MAILBOX=hello@yourapp.com FORWARD_TO=you@example.com scripts/deploy-email-forwarding.sh
#
# Optional: DOMAIN (yourapp.com), AWS_REGION (us-east-1; must be an SES receiving region), MANAGE_SPF=false when the
# domain root already has TXT records, MANAGE_DMARC=false when _dmarc exists, DMARC_POLICY (none), DMARC_REPORT_TO,
# YES=1 to skip the confirmation.
# Needs the prod CDK stack first (the domain's SES identity). In the SES sandbox FORWARD_TO must be a verified identity:
#   aws ses verify-email-identity --email-address you@example.com
# SES has one active receipt rule set per region: the rule joins the active one, or a new one is created and activated.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=yourapp
DOMAIN="${DOMAIN:-yourapp.com}"
REGION="${AWS_REGION:-us-east-1}"
MAILBOX="${MAILBOX:-}"
FORWARD_TO="${FORWARD_TO:-}"
[ -n "$MAILBOX" ] && [ -n "$FORWARD_TO" ] || { sed -n '2,12p' "$0" >&2; exit 2; }
case "$MAILBOX" in *@"$DOMAIN") ;; *) echo "MAILBOX must be an address at $DOMAIN" >&2; exit 2 ;; esac

ZONE_ID="$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" \
  --query "HostedZones[?Name=='$DOMAIN.' && Config.PrivateZone==\`false\`].Id | [0]" --output text)"
[ -n "$ZONE_ID" ] && [ "$ZONE_ID" != None ] || { echo "no public Route 53 hosted zone for $DOMAIN" >&2; exit 1; }
ZONE_ID="${ZONE_ID##*/}"

ACTIVE="$(aws ses describe-active-receipt-rule-set --region "$REGION" --query 'Metadata.Name' --output text 2>/dev/null || true)"
if [ -n "$ACTIVE" ] && [ "$ACTIVE" != None ]; then
  RULE_SET="$ACTIVE"; CREATE=false
else
  RULE_SET="$APP-inbound"; CREATE=true
fi

echo "Email forwarding for $DOMAIN ($REGION):"
echo "  $MAILBOX -> $FORWARD_TO"
echo "  hosted zone $ZONE_ID; receipt rule set $RULE_SET ($([ "$CREATE" = true ] && echo 'new, will be activated' || echo 'active, joined'))"
echo "  DNS: MX at $DOMAIN$([ "${MANAGE_SPF:-true}" = true ] && echo ', SPF TXT at the root')$([ "${MANAGE_DMARC:-true}" = true ] && echo ', _dmarc TXT')"
if [ "${YES:-}" != 1 ]; then
  read -rp "Deploy? [y/N] " ok
  [ "$ok" = y ] || [ "$ok" = Y ] || { echo "nothing deployed"; exit 1; }
fi

aws cloudformation deploy --region "$REGION" \
  --template-file infra/email-forwarding.yaml \
  --stack-name "$APP-email-forwarding" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AppName="$APP" Domain="$DOMAIN" HostedZoneId="$ZONE_ID" Mailbox="$MAILBOX" ForwardTo="$FORWARD_TO" \
    RuleSetName="$RULE_SET" CreateRuleSet="$CREATE" \
    ManageSpf="${MANAGE_SPF:-true}" ManageDmarc="${MANAGE_DMARC:-true}" \
    DmarcPolicy="${DMARC_POLICY:-none}" DmarcReportTo="${DMARC_REPORT_TO:-}"

if [ "$CREATE" = true ]; then
  aws ses set-active-receipt-rule-set --region "$REGION" --rule-set-name "$RULE_SET"
  echo "activated receipt rule set $RULE_SET"
fi
echo "done: send a test message to $MAILBOX"
