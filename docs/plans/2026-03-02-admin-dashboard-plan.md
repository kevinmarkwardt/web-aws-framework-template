# Admin Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin dashboard at `manager.linkkeeper.co` for managing users, monitoring system health, browsing data, and configuring the site — all behind Secrets Manager-based authentication.

**Architecture:** Same React SPA serves both `linkkeeper.co` (user app) and `manager.linkkeeper.co` (admin). Hostname detection in App.tsx routes to lazy-loaded admin pages. Admin API endpoints at `/api/admin/*` use JWT auth backed by AWS Secrets Manager credentials. CloudWatch queries provide live system metrics.

**Tech Stack:** React 19, Tailwind v4, Vite 7, Python 3.12 Lambda, AWS CDK, DynamoDB, Secrets Manager, CloudWatch, bcrypt

---

## Task 1: Admin Credential Setup Script

**Files:**
- Create: `scripts/setup-admin.sh`

**Step 1: Write the setup script**

```bash
#!/usr/bin/env bash
# Setup admin credentials in AWS Secrets Manager.
# Usage: ./scripts/setup-admin.sh
set -euo pipefail

SECRET_NAME="linkkeeper/admin-credentials"
REGION="us-east-1"
ADMIN_EMAIL="kevinmarkwert@gmail.com"

echo "LinkKeeper Admin Setup"
echo "======================"
echo ""
echo "Admin email: $ADMIN_EMAIL"
echo ""

# Prompt for password
read -s -p "Enter admin password: " PASSWORD
echo ""
read -s -p "Confirm admin password: " PASSWORD2
echo ""

if [ "$PASSWORD" != "$PASSWORD2" ]; then
  echo "ERROR: Passwords do not match."
  exit 1
fi

# Generate bcrypt hash via Python
HASH=$(python3 -c "
import bcrypt
pw = '''$PASSWORD'''.encode('utf-8')
h = bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12))
print(h.decode('utf-8'))
")

# Generate random JWT secret
JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

SECRET_JSON=$(python3 -c "
import json
print(json.dumps({
    'email': '$ADMIN_EMAIL',
    'passwordHash': '$HASH',
    'jwtSecret': '$JWT_SECRET'
}))
")

# Create or update secret
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager update-secret \
    --secret-id "$SECRET_NAME" \
    --secret-string "$SECRET_JSON" \
    --region "$REGION" \
    --output text --query 'Name'
  echo ""
  echo "Secret updated: $SECRET_NAME"
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --secret-string "$SECRET_JSON" \
    --region "$REGION" \
    --output text --query 'Name'
  echo ""
  echo "Secret created: $SECRET_NAME"
fi

echo ""
echo "Admin credentials configured."
echo "  Email:  $ADMIN_EMAIL"
echo "  Secret: $SECRET_NAME"
```

**Step 2: Install bcrypt dependency**

Run: `pip install bcrypt`

**Step 3: Run the script to create credentials**

Run: `chmod +x scripts/setup-admin.sh && bash scripts/setup-admin.sh`
Expected: Prompt for password, create secret in Secrets Manager

**Step 4: Verify the secret**

Run: `aws secretsmanager get-secret-value --secret-id linkkeeper/admin-credentials --region us-east-1 --query 'SecretString' --output text | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Email: {d[\"email\"]}\nHash: {d[\"passwordHash\"][:20]}...\nJWT Secret: {d[\"jwtSecret\"][:20]}...')"}`
Expected: Shows email, truncated hash, truncated JWT secret

**Step 5: Commit**

```bash
git add scripts/setup-admin.sh
git commit -m "feat: add admin credential setup script (Secrets Manager)"
```

---

## Task 2: CDK Infrastructure Updates

**Files:**
- Modify: `cdk/lib/linkkeeper-stack.ts`

**Step 1: Update ACM certificate to include manager subdomain**

In `linkkeeper-stack.ts`, update the Certificate construct's `subjectAlternativeNames` (around line 39):

```typescript
const certificate = new acm.Certificate(this, 'Certificate', {
  domainName,
  subjectAlternativeNames: [`www.${domainName}`, `manager.${domainName}`],
  validation: acm.CertificateValidation.fromDns(hostedZone),
});
```

**Step 2: Add `manager.linkkeeper.co` to CloudFront distribution**

Update the `domainNames` array in the Distribution construct (around line 388):

```typescript
const distribution = new cloudfront.Distribution(this, 'Distribution', {
  domainNames: [domainName, `www.${domainName}`, `manager.${domainName}`],
  // ... rest unchanged
```

**Step 3: Update CloudFront Function to handle manager subdomain**

Update the viewer request function (around line 356) to skip www redirect for manager subdomain:

```typescript
const viewerRequestFunction = new cloudfront.Function(this, 'ViewerRequestFunction', {
  functionName: 'linkkeeper-viewer-request',
  code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;

  // www redirect (skip for manager subdomain)
  if (host.startsWith('www.') && !host.startsWith('manager.')) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://${domainName}' + request.uri }
      }
    };
  }

  // SPA fallback: rewrite to /index.html if no file extension
  var uri = request.uri;
  if (!uri.includes('.')) {
    request.uri = '/index.html';
  }

  return request;
}
`),
  runtime: cloudfront.FunctionRuntime.JS_2_0,
});
```

**Step 4: Add Route53 A record for manager subdomain**

After the existing ARecord constructs (around line 454), add:

```typescript
new route53.ARecord(this, 'ManagerARecord', {
  zone: hostedZone,
  recordName: `manager.${domainName}`,
  target: route53.RecordTarget.fromAlias(
    new route53targets.CloudFrontTarget(distribution)
  ),
});
```

**Step 5: Add IAM permissions for admin features**

After the existing IAM policy statements for `apiHandler` (around line 296), add:

```typescript
// Admin: read Secrets Manager for admin auth
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['secretsmanager:GetSecretValue'],
  resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:linkkeeper/*`],
}));

// Admin: CloudWatch metrics for health dashboard
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'cloudwatch:GetMetricData',
    'cloudwatch:GetMetricStatistics',
    'cloudwatch:ListMetrics',
  ],
  resources: ['*'],
}));

// Admin: Lambda function info for health dashboard
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['lambda:ListFunctions', 'lambda:GetFunction', 'lambda:InvokeFunction'],
  resources: [`arn:aws:lambda:${this.region}:${this.account}:function:linkkeeper-*`],
}));

// Admin: SES stats for health dashboard
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ses:GetSendStatistics', 'ses:GetSendQuota'],
  resources: ['*'],
}));

// Admin: EventBridge rules for schedule info
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['events:ListRules', 'events:DescribeRule'],
  resources: [`arn:aws:events:${this.region}:${this.account}:rule/linkkeeper-*`],
}));

// Admin: DynamoDB describe for table metrics
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:DescribeTable'],
  resources: [mainTable.tableArn],
}));
```

**Step 6: Synth to verify no errors**

Run: `cd cdk && npx cdk synth --quiet`
Expected: No errors

**Step 7: Commit**

```bash
git add cdk/lib/linkkeeper-stack.ts
git commit -m "feat: CDK updates for admin dashboard (cert, CloudFront, Route53, IAM)"
```

---

## Task 3: Backend Admin Auth Module

**Files:**
- Create: `api/lib/admin_auth.py`
- Modify: `api/requirements.txt`

**Step 1: Add bcrypt to API requirements**

Add to `api/requirements.txt`:

```
boto3>=1.34.0
python-jose[cryptography]>=3.3.0
stripe>=8.0.0
python-ulid>=2.0.0
bcrypt>=4.0.0
```

**Step 2: Write the admin auth module**

Create `api/lib/admin_auth.py`:

```python
"""Admin authentication via AWS Secrets Manager + bcrypt + JWT."""

from __future__ import annotations

import json
import os
import time

import bcrypt
import boto3
from jose import jwt

REGION = os.environ.get("AWS_REGION", "us-east-1")
SECRET_NAME = "linkkeeper/admin-credentials"

_secret_cache = None
_secret_cache_time = 0
SECRET_CACHE_TTL = 300  # 5 minutes


def _get_admin_secret() -> dict:
    """Fetch admin credentials from Secrets Manager with caching."""
    global _secret_cache, _secret_cache_time
    now = time.time()
    if _secret_cache and (now - _secret_cache_time) < SECRET_CACHE_TTL:
        return _secret_cache
    client = boto3.client("secretsmanager", region_name=REGION)
    resp = client.get_secret_value(SecretId=SECRET_NAME)
    _secret_cache = json.loads(resp["SecretString"])
    _secret_cache_time = now
    return _secret_cache


def verify_admin_login(email: str, password: str) -> str | None:
    """Verify admin email + password. Returns JWT token on success, None on failure."""
    secret = _get_admin_secret()
    if email != secret.get("email"):
        return None
    stored_hash = secret["passwordHash"].encode("utf-8")
    if not bcrypt.checkpw(password.encode("utf-8"), stored_hash):
        return None
    # Issue JWT valid for 24 hours
    token = jwt.encode(
        {
            "sub": "admin",
            "email": email,
            "iat": int(time.time()),
            "exp": int(time.time()) + 86400,
        },
        secret["jwtSecret"],
        algorithm="HS256",
    )
    return token


def verify_admin_token(event: dict) -> bool:
    """Verify admin JWT from Authorization header. Returns True if valid."""
    headers = event.get("headers", {})
    auth = headers.get("authorization", headers.get("Authorization", ""))
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:]
    try:
        secret = _get_admin_secret()
        claims = jwt.decode(token, secret["jwtSecret"], algorithms=["HS256"])
        return claims.get("sub") == "admin" and claims.get("exp", 0) > time.time()
    except Exception:
        return False
```

**Step 3: Commit**

```bash
git add api/lib/admin_auth.py api/requirements.txt
git commit -m "feat: admin auth module (Secrets Manager + bcrypt + JWT)"
```

---

## Task 4: Backend Admin Routes — Auth & Overview

**Files:**
- Create: `api/routes/admin.py`
- Modify: `api/handler.py`

**Step 1: Create the admin routes module**

Create `api/routes/admin.py`:

```python
"""Admin API routes — /api/admin/*."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta

import boto3

try:
    from lib.admin_auth import verify_admin_login, verify_admin_token
    from lib.db import (
        _get_table, scan_all_users, scan_all_links, scan_all_pitches,
        get_user, get_links, get_pitches, update_user_plan,
        delete_link, delete_pitch, update_link, update_pitch,
        increment_link_count,
    )
    from lib.response import ok, error, unauthorized, not_found, forbidden
except ImportError:
    from api.lib.admin_auth import verify_admin_login, verify_admin_token
    from api.lib.db import (
        _get_table, scan_all_users, scan_all_links, scan_all_pitches,
        get_user, get_links, get_pitches, update_user_plan,
        delete_link, delete_pitch, update_link, update_pitch,
        increment_link_count,
    )
    from api.lib.response import ok, error, unauthorized, not_found, forbidden

REGION = os.environ.get("AWS_REGION", "us-east-1")


def _parse_body(event: dict) -> dict:
    body = event.get("body", "{}")
    if event.get("isBase64Encoded"):
        import base64
        body = base64.b64decode(body).decode("utf-8")
    return json.loads(body) if isinstance(body, str) else body


def _require_admin(event: dict):
    """Returns an error response if admin auth fails, None if OK."""
    if not verify_admin_token(event):
        return unauthorized("Invalid or expired admin token")
    return None


# --- Login ---

def login(event: dict) -> dict:
    body = _parse_body(event)
    email = body.get("email", "")
    password = body.get("password", "")
    if not email or not password:
        return error("Email and password required")
    token = verify_admin_login(email, password)
    if not token:
        return error("Invalid credentials", 401)
    return ok({"token": token})


# --- Overview ---

def get_overview(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err

    users = scan_all_users()
    links = scan_all_links()

    plan_counts = {"free": 0, "starter": 0, "pro": 0}
    for u in users:
        plan = u.get("plan", "free")
        plan_counts[plan] = plan_counts.get(plan, 0) + 1

    status_counts = {}
    for lnk in links:
        s = lnk.get("status", "PENDING")
        status_counts[s] = status_counts.get(s, 0) + 1

    mrr = plan_counts.get("starter", 0) * 9 + plan_counts.get("pro", 0) * 19

    return ok({
        "totalUsers": len(users),
        "planCounts": plan_counts,
        "totalLinks": len(links),
        "statusCounts": status_counts,
        "mrr": mrr,
    })


# --- Users ---

def list_users(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    users = scan_all_users()
    # Strip DynamoDB keys, sort by createdAt desc
    cleaned = []
    for u in users:
        u.pop("pk", None)
        u.pop("sk", None)
        cleaned.append(u)
    cleaned.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return ok(cleaned)


def get_user_detail(event: dict, user_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    user = get_user(user_id)
    if not user:
        return not_found("User not found")
    user.pop("pk", None)
    user.pop("sk", None)
    user_links = get_links(user_id)
    for lnk in user_links:
        lnk.pop("pk", None)
        lnk.pop("sk", None)
    user_pitches = get_pitches(user_id)
    for p in user_pitches:
        p.pop("pk", None)
        p.pop("sk", None)
    return ok({"user": user, "links": user_links, "pitches": user_pitches})


def update_user(event: dict, user_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    user = get_user(user_id)
    if not user:
        return not_found("User not found")
    body = _parse_body(event)
    new_plan = body.get("plan")
    if new_plan and new_plan in ("free", "starter", "pro"):
        update_user_plan(user_id, new_plan)
    return ok({"updated": True})


def delete_user_account(event: dict, user_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    user = get_user(user_id)
    if not user:
        return not_found("User not found")
    # Delete all user's links
    user_links = get_links(user_id)
    for lnk in user_links:
        delete_link(user_id, lnk["linkId"])
    # Delete all user's pitches
    user_pitches = get_pitches(user_id)
    for p in user_pitches:
        delete_pitch(user_id, p["pitchId"])
    # Delete user profile
    table = _get_table()
    table.delete_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"})
    return ok({"deleted": True})


# --- Links (admin) ---

def list_all_links(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    params = event.get("queryStringParameters") or {}
    status_filter = params.get("status")
    q = params.get("q", "").lower()

    links = scan_all_links()
    for lnk in links:
        lnk.pop("pk", None)
        lnk.pop("sk", None)

    if status_filter:
        links = [l for l in links if l.get("status") == status_filter]
    if q:
        links = [l for l in links if q in l.get("pageUrl", "").lower()
                 or q in l.get("destinationUrl", "").lower()
                 or q in l.get("anchorText", "").lower()]
    links.sort(key=lambda x: x.get("lastChecked", ""), reverse=True)
    return ok(links)


def update_admin_link(event: dict, user_id: str, link_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    body = _parse_body(event)
    allowed = {"pageUrl", "destinationUrl", "anchorText", "status"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        update_link(user_id, link_id, updates)
    return ok({"updated": True})


def delete_admin_link(event: dict, user_id: str, link_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    delete_link(user_id, link_id)
    increment_link_count(user_id, -1)
    return ok({"deleted": True})


def crawl_admin_link(event: dict, user_id: str, link_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    client = boto3.client("lambda", region_name=REGION)
    client.invoke(
        FunctionName="linkkeeper-crawler",
        InvocationType="Event",
        Payload=json.dumps({"singleLink": True, "userId": user_id, "linkId": link_id}),
    )
    return ok({"crawlTriggered": True})


# --- Pitches (admin) ---

def list_all_pitches(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    pitches = scan_all_pitches()
    for p in pitches:
        p.pop("pk", None)
        p.pop("sk", None)
    pitches.sort(key=lambda x: x.get("pitchSentDate", ""), reverse=True)
    return ok(pitches)


def update_admin_pitch(event: dict, user_id: str, pitch_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    body = _parse_body(event)
    allowed = {"domain", "contactName", "contactEmail", "pitchSentDate",
               "status", "publishedUrl", "publishedDate", "notes"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        update_pitch(user_id, pitch_id, updates)
    return ok({"updated": True})


def delete_admin_pitch(event: dict, user_id: str, pitch_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    delete_pitch(user_id, pitch_id)
    return ok({"deleted": True})


# --- Health ---

def get_health(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err

    cw = boto3.client("cloudwatch", region_name=REGION)
    lam = boto3.client("lambda", region_name=REGION)
    ddb = boto3.client("dynamodb", region_name=REGION)

    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=24)

    # Lambda metrics
    functions = [
        "linkkeeper-api", "linkkeeper-crawler", "linkkeeper-alerts",
        "linkkeeper-digest", "linkkeeper-reminders",
        "linkkeeper-impact-scorer", "linkkeeper-report-generator",
    ]
    lambda_stats = {}
    for fn in functions:
        queries = [
            {"Id": "invocations", "MetricStat": {"Metric": {"Namespace": "AWS/Lambda", "MetricName": "Invocations", "Dimensions": [{"Name": "FunctionName", "Value": fn}]}, "Period": 86400, "Stat": "Sum"}},
            {"Id": "errors", "MetricStat": {"Metric": {"Namespace": "AWS/Lambda", "MetricName": "Errors", "Dimensions": [{"Name": "FunctionName", "Value": fn}]}, "Period": 86400, "Stat": "Sum"}},
            {"Id": "duration", "MetricStat": {"Metric": {"Namespace": "AWS/Lambda", "MetricName": "Duration", "Dimensions": [{"Name": "FunctionName", "Value": fn}]}, "Period": 86400, "Stat": "Average"}},
        ]
        try:
            resp = cw.get_metric_data(
                MetricDataQueries=queries,
                StartTime=start,
                EndTime=now,
            )
            results = {r["Id"]: r["Values"][0] if r["Values"] else 0 for r in resp["MetricDataResults"]}
            lambda_stats[fn] = {
                "invocations": int(results.get("invocations", 0)),
                "errors": int(results.get("errors", 0)),
                "avgDurationMs": round(results.get("duration", 0), 1),
            }
        except Exception:
            lambda_stats[fn] = {"invocations": 0, "errors": 0, "avgDurationMs": 0}

    # DynamoDB metrics
    try:
        table_desc = ddb.describe_table(TableName="linkkeeper")["Table"]
        ddb_stats = {
            "itemCount": table_desc.get("ItemCount", 0),
            "tableSizeBytes": table_desc.get("TableSizeBytes", 0),
            "provisionedRCU": table_desc.get("ProvisionedThroughput", {}).get("ReadCapacityUnits", 0),
            "provisionedWCU": table_desc.get("ProvisionedThroughput", {}).get("WriteCapacityUnits", 0),
        }
    except Exception:
        ddb_stats = {}

    # SES metrics
    try:
        ses = boto3.client("ses", region_name=REGION)
        ses_resp = ses.get_send_statistics()
        points = ses_resp.get("SendDataPoints", [])
        ses_stats = {
            "deliveryAttempts": sum(p.get("DeliveryAttempts", 0) for p in points),
            "bounces": sum(p.get("Bounces", 0) for p in points),
            "complaints": sum(p.get("Complaints", 0) for p in points),
            "rejects": sum(p.get("Rejects", 0) for p in points),
        }
    except Exception:
        ses_stats = {}

    return ok({
        "lambda": lambda_stats,
        "dynamodb": ddb_stats,
        "ses": ses_stats,
    })


# --- Actions ---

def trigger_crawl_all(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    client = boto3.client("lambda", region_name=REGION)
    client.invoke(
        FunctionName="linkkeeper-crawler",
        InvocationType="Event",
        Payload=json.dumps({"tier": "daily"}),
    )
    return ok({"triggered": "crawl-all"})


def trigger_digest(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    client = boto3.client("lambda", region_name=REGION)
    client.invoke(
        FunctionName="linkkeeper-digest",
        InvocationType="Event",
        Payload="{}",
    )
    return ok({"triggered": "digest"})


# --- Config ---

CONFIG_PK = "CONFIG"
CONFIG_SK = "GLOBAL"

DEFAULT_CONFIG = {
    "maintenanceMode": False,
    "signupsEnabled": True,
    "crawlingEnabled": True,
    "alertsEnabled": True,
    "planLimits": {"free": 5, "starter": 50, "pro": 999999},
    "crawlSettings": {"dailyCrawlHourUtc": 4, "hourlyCrawlEnabled": True, "rateLimitDelayMs": 500},
    "emailTemplates": {
        "alertSubject": "LinkKeeper Alert: Link on {domain} is now {status}",
        "digestSubject": "LinkKeeper Weekly Digest — {dateRange}",
        "reminderSubject": "LinkKeeper: Follow up with {domain}",
    },
    "pricingDisplay": {
        "starter": {"name": "Starter", "price": 9, "features": ["50 links", "Daily crawls", "Pipeline tracker"]},
        "pro": {"name": "Pro", "price": 19, "features": ["Unlimited links", "Hourly crawls", "AI impact scoring", "Monthly reports"]},
    },
}


def get_config(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    table = _get_table()
    resp = table.get_item(Key={"pk": CONFIG_PK, "sk": CONFIG_SK})
    config = resp.get("Item")
    if not config:
        # Return defaults if no config exists yet
        return ok(DEFAULT_CONFIG)
    config.pop("pk", None)
    config.pop("sk", None)
    return ok(config)


def update_config(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    body = _parse_body(event)
    table = _get_table()
    item = {"pk": CONFIG_PK, "sk": CONFIG_SK, **body}
    table.put_item(Item=item)
    return ok({"updated": True})
```

**Step 2: Wire admin routes into handler.py**

Update `api/handler.py` to import and route admin paths. Add the import at the top with the other route imports, and add admin routing before the JWT auth check:

In `handler.py`, after the existing imports (line 23), add:

```python
from routes import links, pitches, account, billing, admin
```

In `lambda_handler`, after the Stripe webhook check (line 47) and before the JWT auth check (line 50), add the admin routing block:

```python
    # Admin routes — use separate auth (Secrets Manager JWT)
    if path.startswith("/api/admin/"):
        return _admin_route(method, path, event)
```

Add the `_admin_route` function after `_route`:

```python
def _admin_route(method: str, path: str, event: dict) -> dict:
    # Login doesn't require admin JWT
    if method == "POST" and path == "/api/admin/login":
        return admin.login(event)

    # All other admin routes require admin JWT
    # (each route function calls _require_admin internally)

    if method == "GET" and path == "/api/admin/overview":
        return admin.get_overview(event)

    if method == "GET" and path == "/api/admin/users":
        return admin.list_users(event)

    m = re.match(r"^/api/admin/users/([A-Za-z0-9-]+)$", path)
    if m:
        uid = m.group(1)
        if method == "GET":
            return admin.get_user_detail(event, uid)
        if method == "PUT":
            return admin.update_user(event, uid)
        if method == "DELETE":
            return admin.delete_user_account(event, uid)

    if method == "GET" and path == "/api/admin/links":
        return admin.list_all_links(event)

    m = re.match(r"^/api/admin/links/([A-Za-z0-9-]+)/([A-Za-z0-9]+)/crawl$", path)
    if m and method == "POST":
        return admin.crawl_admin_link(event, m.group(1), m.group(2))

    m = re.match(r"^/api/admin/links/([A-Za-z0-9-]+)/([A-Za-z0-9]+)$", path)
    if m:
        uid, lid = m.group(1), m.group(2)
        if method == "PUT":
            return admin.update_admin_link(event, uid, lid)
        if method == "DELETE":
            return admin.delete_admin_link(event, uid, lid)

    if method == "GET" and path == "/api/admin/pitches":
        return admin.list_all_pitches(event)

    m = re.match(r"^/api/admin/pitches/([A-Za-z0-9-]+)/([A-Za-z0-9]+)$", path)
    if m:
        uid, pid = m.group(1), m.group(2)
        if method == "PUT":
            return admin.update_admin_pitch(event, uid, pid)
        if method == "DELETE":
            return admin.delete_admin_pitch(event, uid, pid)

    if method == "GET" and path == "/api/admin/health":
        return admin.get_health(event)

    if method == "POST" and path == "/api/admin/actions/crawl-all":
        return admin.trigger_crawl_all(event)

    if method == "POST" and path == "/api/admin/actions/send-digest":
        return admin.trigger_digest(event)

    if method == "GET" and path == "/api/admin/config":
        return admin.get_config(event)

    if method == "PUT" and path == "/api/admin/config":
        return admin.update_config(event)

    return not_found(f"No admin route: {method} {path}")
```

**Step 3: Commit**

```bash
git add api/routes/admin.py api/handler.py
git commit -m "feat: admin API routes (auth, overview, users, links, pitches, health, config)"
```

---

## Task 5: Frontend Admin API Client & Types

**Files:**
- Create: `frontend/src/admin-api.ts`
- Create: `frontend/src/admin-types.ts`

**Step 1: Create admin types**

Create `frontend/src/admin-types.ts`:

```typescript
import type { Link, Pitch, User } from './types';

export interface AdminOverview {
  totalUsers: number;
  planCounts: { free: number; starter: number; pro: number };
  totalLinks: number;
  statusCounts: Record<string, number>;
  mrr: number;
}

export interface UserDetail {
  user: User;
  links: Link[];
  pitches: Pitch[];
}

export interface LambdaStats {
  invocations: number;
  errors: number;
  avgDurationMs: number;
}

export interface HealthData {
  lambda: Record<string, LambdaStats>;
  dynamodb: {
    itemCount: number;
    tableSizeBytes: number;
    provisionedRCU: number;
    provisionedWCU: number;
  };
  ses: {
    deliveryAttempts: number;
    bounces: number;
    complaints: number;
    rejects: number;
  };
}

export interface SiteConfig {
  maintenanceMode: boolean;
  signupsEnabled: boolean;
  crawlingEnabled: boolean;
  alertsEnabled: boolean;
  planLimits: { free: number; starter: number; pro: number };
  crawlSettings: {
    dailyCrawlHourUtc: number;
    hourlyCrawlEnabled: boolean;
    rateLimitDelayMs: number;
  };
  emailTemplates: Record<string, string>;
  pricingDisplay: Record<string, { name: string; price: number; features: string[] }>;
}
```

**Step 2: Create admin API client**

Create `frontend/src/admin-api.ts`:

```typescript
import type { Link, Pitch, User } from './types';
import type { AdminOverview, UserDetail, HealthData, SiteConfig } from './admin-types';

let adminToken: string | null = null;

export function setAdminToken(token: string) {
  adminToken = token;
}

export function clearAdminToken() {
  adminToken = null;
}

export function hasAdminToken(): boolean {
  return adminToken !== null;
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!adminToken) {
    throw new Error('Not authenticated as admin');
  }

  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearAdminToken();
    window.location.href = '/';
    throw new Error('Admin session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// Auth
export async function adminLogin(email: string, password: string): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Login failed');
  }
  const data = await res.json();
  adminToken = data.token;
  return data.token;
}

// Overview
export const fetchOverview = () => adminFetch<AdminOverview>('/overview');

// Users
export const fetchUsers = () => adminFetch<User[]>('/users');
export const fetchUserDetail = (userId: string) => adminFetch<UserDetail>(`/users/${userId}`);
export const updateUser = (userId: string, data: { plan?: string }) =>
  adminFetch(`/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteUser = (userId: string) =>
  adminFetch(`/users/${userId}`, { method: 'DELETE' });

// Links
export const fetchAllLinks = (params?: { status?: string; q?: string }) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.q) qs.set('q', params.q);
  const query = qs.toString();
  return adminFetch<Link[]>(`/links${query ? `?${query}` : ''}`);
};
export const updateAdminLink = (userId: string, linkId: string, data: Partial<Link>) =>
  adminFetch(`/links/${userId}/${linkId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAdminLink = (userId: string, linkId: string) =>
  adminFetch(`/links/${userId}/${linkId}`, { method: 'DELETE' });
export const crawlAdminLink = (userId: string, linkId: string) =>
  adminFetch(`/links/${userId}/${linkId}/crawl`, { method: 'POST' });

// Pitches
export const fetchAllPitches = () => adminFetch<Pitch[]>('/pitches');
export const updateAdminPitch = (userId: string, pitchId: string, data: Partial<Pitch>) =>
  adminFetch(`/pitches/${userId}/${pitchId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAdminPitch = (userId: string, pitchId: string) =>
  adminFetch(`/pitches/${userId}/${pitchId}`, { method: 'DELETE' });

// Health
export const fetchHealth = () => adminFetch<HealthData>('/health');

// Actions
export const triggerCrawlAll = () =>
  adminFetch('/actions/crawl-all', { method: 'POST' });
export const triggerDigest = () =>
  adminFetch('/actions/send-digest', { method: 'POST' });

// Config
export const fetchConfig = () => adminFetch<SiteConfig>('/config');
export const updateConfig = (config: Partial<SiteConfig>) =>
  adminFetch('/config', { method: 'PUT', body: JSON.stringify(config) });
```

**Step 3: Commit**

```bash
git add frontend/src/admin-api.ts frontend/src/admin-types.ts
git commit -m "feat: admin API client and TypeScript types"
```

---

## Task 6: Frontend Admin Login Page

**Files:**
- Create: `frontend/src/pages/admin/AdminLogin.tsx`

**Step 1: Create the admin login page**

Create `frontend/src/pages/admin/AdminLogin.tsx`:

```tsx
import { useState, FormEvent } from 'react';
import { adminLogin } from '../../admin-api';

interface Props {
  onLogin: () => void;
}

export default function AdminLogin({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await adminLogin(email, password);
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-xl p-8">
          <div className="flex items-center gap-2 mb-6">
            <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <h1 className="text-xl font-bold text-gray-900">LinkKeeper Manager</h1>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/AdminLogin.tsx
git commit -m "feat: admin login page"
```

---

## Task 7: Frontend Admin Layout & Routing in App.tsx

**Files:**
- Create: `frontend/src/pages/admin/AdminLayout.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Create the admin layout with dark sidebar**

Create `frontend/src/pages/admin/AdminLayout.tsx`:

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearAdminToken } from '../../admin-api';

const navItems = [
  { to: '/', label: 'Overview', end: true },
  { to: '/users', label: 'Users' },
  { to: '/health', label: 'Health' },
  { to: '/data', label: 'Data' },
  { to: '/config', label: 'Config' },
];

export default function AdminLayout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAdminToken();
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-700">
          <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          <span className="font-bold text-sm">LinkKeeper Manager</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-2 py-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Update App.tsx with hostname detection and lazy-loaded admin routes**

Replace the entire `App.tsx` with:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, useContext, createContext, lazy, Suspense } from 'react';
import { getUser } from './auth';
import type { User } from './types';
import { fetchAccount } from './api';
import { hasAdminToken } from './admin-api';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import VerifyPage from './pages/auth/VerifyPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import LinksPage from './pages/dashboard/LinksPage';
import PipelinePage from './pages/dashboard/PipelinePage';
import SettingsPage from './pages/dashboard/SettingsPage';
import ReportsPage from './pages/dashboard/ReportsPage';

// Admin pages — lazy loaded (only fetched on manager.linkkeeper.co)
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminOverview = lazy(() => import('./pages/admin/OverviewPage'));
const AdminUsers = lazy(() => import('./pages/admin/UsersPage'));
const AdminHealth = lazy(() => import('./pages/admin/HealthPage'));
const AdminData = lazy(() => import('./pages/admin/DataPage'));
const AdminConfig = lazy(() => import('./pages/admin/ConfigPage'));

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

const isManagerHost = window.location.hostname === 'manager.linkkeeper.co';

function AdminApp() {
  const [authenticated, setAuthenticated] = useState(hasAdminToken());

  if (!authenticated) {
    return (
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-900"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" /></div>}>
        <AdminLogin onLogin={() => setAuthenticated(true)} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="health" element={<AdminHealth />} />
          <Route path="data" element={<AdminData />} />
          <Route path="config" element={<AdminConfig />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Suspense>
  );
}

function UserApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const cognitoUser = await getUser();
      if (cognitoUser) {
        const account = await fetchAccount();
        setUser(account);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<LinksPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="reports" element={<ReportsPage />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}

export default function App() {
  return isManagerHost ? <AdminApp /> : <UserApp />;
}
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/AdminLayout.tsx frontend/src/App.tsx
git commit -m "feat: admin routing with hostname detection and lazy loading"
```

---

## Task 8: Admin Overview Page

**Files:**
- Create: `frontend/src/pages/admin/OverviewPage.tsx`

**Step 1: Create the overview page with stat cards**

Create `frontend/src/pages/admin/OverviewPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { fetchOverview } from '../../admin-api';
import type { AdminOverview } from '../../admin-types';

export default function OverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOverview()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  const cards = [
    { label: 'Total Users', value: data.totalUsers, sub: `Free: ${data.planCounts.free} / Starter: ${data.planCounts.starter} / Pro: ${data.planCounts.pro}` },
    { label: 'MRR', value: `$${data.mrr}`, sub: `${data.planCounts.starter}×$9 + ${data.planCounts.pro}×$19` },
    { label: 'Total Links', value: data.totalLinks, sub: Object.entries(data.statusCounts).map(([k, v]) => `${k}: ${v}`).join(' / ') },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{card.value}</p>
            <p className="mt-1 text-xs text-gray-400">{card.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/OverviewPage.tsx
git commit -m "feat: admin overview page with stat cards"
```

---

## Task 9: Admin Users Page

**Files:**
- Create: `frontend/src/pages/admin/UsersPage.tsx`

**Step 1: Create the users page with expandable rows**

Create `frontend/src/pages/admin/UsersPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { fetchUsers, fetchUserDetail, updateUser, deleteUser } from '../../admin-api';
import type { User } from '../../types';
import type { UserDetail } from '../../admin-types';
import StatusBadge from '../../components/StatusBadge';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    fetchUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = async (userId: string) => {
    if (expandedId === userId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(userId);
    try {
      const d = await fetchUserDetail(userId);
      setDetail(d);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePlanChange = async (userId: string, plan: string) => {
    await updateUser(userId, { plan });
    load();
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Delete this user and all their data?')) return;
    await deleteUser(userId);
    setExpandedId(null);
    load();
  };

  const filtered = users.filter(
    (u) => !search || u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users ({users.length})</h1>
        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-64"
        />
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Plan</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Links</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((u) => (
              <>
                <tr
                  key={u.userId}
                  onClick={() => toggleExpand(u.userId)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.plan}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handlePlanChange(u.userId, e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="free">Free</option>
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.linkCount}</td>
                  <td className="px-4 py-3 text-gray-500">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(u.userId); }}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {expandedId === u.userId && detail && (
                  <tr key={`${u.userId}-detail`}>
                    <td colSpan={5} className="px-4 py-4 bg-gray-50">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h3 className="font-semibold text-gray-900 mb-2">Links ({detail.links.length})</h3>
                          {detail.links.length === 0 ? (
                            <p className="text-gray-400 text-xs">No links</p>
                          ) : (
                            <div className="space-y-1 max-h-48 overflow-auto">
                              {detail.links.map((l) => (
                                <div key={l.linkId} className="flex items-center gap-2 text-xs">
                                  <StatusBadge status={l.status} />
                                  <span className="text-gray-600 truncate">{l.pageUrl}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 mb-2">Pitches ({detail.pitches.length})</h3>
                          {detail.pitches.length === 0 ? (
                            <p className="text-gray-400 text-xs">No pitches</p>
                          ) : (
                            <div className="space-y-1 max-h-48 overflow-auto">
                              {detail.pitches.map((p) => (
                                <div key={p.pitchId} className="text-xs text-gray-600">
                                  {p.domain} — {p.status}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-gray-400">User ID: {u.userId}</p>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/UsersPage.tsx
git commit -m "feat: admin users page with search, plan management, expandable details"
```

---

## Task 10: Admin Health Page

**Files:**
- Create: `frontend/src/pages/admin/HealthPage.tsx`

**Step 1: Create the health monitoring page**

Create `frontend/src/pages/admin/HealthPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { fetchHealth } from '../../admin-api';
import type { HealthData } from '../../admin-types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    fetchHealth()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
        <button onClick={load} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Refresh</button>
      </div>

      {/* Lambda Functions */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Lambda Functions (24h)</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Object.entries(data.lambda).map(([name, stats]) => (
          <div key={name} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-900 mb-2">{name.replace('linkkeeper-', '')}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.invocations}</p>
                <p className="text-xs text-gray-500">Invocations</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${stats.errors > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stats.errors}</p>
                <p className="text-xs text-gray-500">Errors</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.avgDurationMs}</p>
                <p className="text-xs text-gray-500">Avg ms</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DynamoDB */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">DynamoDB</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Items</span><span className="font-medium">{data.dynamodb.itemCount.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Table Size</span><span className="font-medium">{formatBytes(data.dynamodb.tableSizeBytes)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Provisioned RCU</span><span className="font-medium">{data.dynamodb.provisionedRCU}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Provisioned WCU</span><span className="font-medium">{data.dynamodb.provisionedWCU}</span></div>
          </div>
        </div>

        {/* SES */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">SES Email</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Delivery Attempts</span><span className="font-medium">{data.ses.deliveryAttempts}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Bounces</span><span className={`font-medium ${data.ses.bounces > 0 ? 'text-red-600' : ''}`}>{data.ses.bounces}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Complaints</span><span className={`font-medium ${data.ses.complaints > 0 ? 'text-red-600' : ''}`}>{data.ses.complaints}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Rejects</span><span className="font-medium">{data.ses.rejects}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/HealthPage.tsx
git commit -m "feat: admin health page with Lambda, DynamoDB, SES metrics"
```

---

## Task 11: Admin Data Page

**Files:**
- Create: `frontend/src/pages/admin/DataPage.tsx`

**Step 1: Create the data management page**

Create `frontend/src/pages/admin/DataPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import {
  fetchAllLinks, fetchAllPitches,
  deleteAdminLink, crawlAdminLink, deleteAdminPitch,
  triggerCrawlAll, triggerDigest,
} from '../../admin-api';
import type { Link, Pitch } from '../../types';
import StatusBadge from '../../components/StatusBadge';

type Tab = 'links' | 'pitches';

export default function DataPage() {
  const [tab, setTab] = useState<Tab>('links');
  const [links, setLinks] = useState<Link[]>([]);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const loadLinks = () => {
    setLoading(true);
    fetchAllLinks({ status: statusFilter || undefined, q: search || undefined })
      .then(setLinks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const loadPitches = () => {
    setLoading(true);
    fetchAllPitches()
      .then(setPitches)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab === 'links') loadLinks();
    else loadPitches();
  }, [tab, statusFilter]);

  const handleDeleteLink = async (userId: string, linkId: string) => {
    if (!confirm('Delete this link?')) return;
    await deleteAdminLink(userId, linkId);
    loadLinks();
  };

  const handleCrawl = async (userId: string, linkId: string) => {
    await crawlAdminLink(userId, linkId);
    setActionMsg('Crawl triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const handleDeletePitch = async (userId: string, pitchId: string) => {
    if (!confirm('Delete this pitch?')) return;
    await deleteAdminPitch(userId, pitchId);
    loadPitches();
  };

  const handleCrawlAll = async () => {
    await triggerCrawlAll();
    setActionMsg('Crawl-all triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const handleDigest = async () => {
    await triggerDigest();
    setActionMsg('Digest triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const statuses = ['LIVE', 'MISSING', '404', 'REDIRECT', 'ERROR', 'PENDING'];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Management</h1>
        <div className="flex gap-2">
          <button onClick={handleCrawlAll} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Crawl All</button>
          <button onClick={handleDigest} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Send Digest</button>
        </div>
      </div>

      {actionMsg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{actionMsg}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <button onClick={() => setTab('links')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'links' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>Links</button>
        <button onClick={() => setTab('pitches')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'pitches' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>Pitches</button>
      </div>

      {tab === 'links' && (
        <>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Search URLs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadLinks()}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm flex-1"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={loadLinks} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Search</button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Page URL</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Destination</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
                ) : links.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No links found</td></tr>
                ) : links.map((l) => (
                  <tr key={`${l.userId}-${l.linkId}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                    <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{l.pageUrl}</td>
                    <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{l.destinationUrl}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{(l as any).userId?.slice(0, 8)}...</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => handleCrawl((l as any).userId, l.linkId)} className="text-indigo-600 hover:text-indigo-800 text-xs">Crawl</button>
                      <button onClick={() => handleDeleteLink((l as any).userId, l.linkId)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'pitches' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Domain</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Contact</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Pitched</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : pitches.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No pitches found</td></tr>
              ) : pitches.map((p) => (
                <tr key={`${(p as any).userId}-${p.pitchId}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.domain}</td>
                  <td className="px-4 py-3 text-xs">{p.status}</td>
                  <td className="px-4 py-3 text-gray-600">{p.contactName}</td>
                  <td className="px-4 py-3 text-gray-500">{p.pitchSentDate ? new Date(p.pitchSentDate).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{(p as any).userId?.slice(0, 8)}...</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDeletePitch((p as any).userId, p.pitchId)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/DataPage.tsx
git commit -m "feat: admin data page with links/pitches browser and bulk actions"
```

---

## Task 12: Admin Config Page

**Files:**
- Create: `frontend/src/pages/admin/ConfigPage.tsx`

**Step 1: Create the config management page**

Create `frontend/src/pages/admin/ConfigPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '../../admin-api';
import type { SiteConfig } from '../../admin-types';

export default function ConfigPage() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>;
  if (!config) return null;

  const toggle = (key: keyof SiteConfig) => {
    setConfig({ ...config, [key]: !config[key] });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Site Configuration</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
          <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Feature Toggles */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Feature Toggles</h2>
          <div className="space-y-3">
            {([
              ['maintenanceMode', 'Maintenance Mode', 'Shows a "back soon" page to all visitors'],
              ['signupsEnabled', 'Signups Enabled', 'Allow new user registrations'],
              ['crawlingEnabled', 'Crawling Enabled', 'Run scheduled link crawls'],
              ['alertsEnabled', 'Alerts Enabled', 'Send status change alert emails'],
            ] as const).map(([key, label, desc]) => (
              <label key={key} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
                <button
                  onClick={() => toggle(key)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config[key] ? 'bg-indigo-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config[key] ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </label>
            ))}
          </div>
        </div>

        {/* Plan Limits */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Limits</h2>
          <div className="grid grid-cols-3 gap-4">
            {(['free', 'starter', 'pro'] as const).map((plan) => (
              <div key={plan}>
                <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">{plan} — Max Links</label>
                <input
                  type="number"
                  value={config.planLimits[plan]}
                  onChange={(e) => setConfig({
                    ...config,
                    planLimits: { ...config.planLimits, [plan]: parseInt(e.target.value) || 0 },
                  })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Crawl Settings */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Crawl Settings</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Daily Crawl Hour (UTC)</label>
              <input
                type="number"
                min="0"
                max="23"
                value={config.crawlSettings.dailyCrawlHourUtc}
                onChange={(e) => setConfig({
                  ...config,
                  crawlSettings: { ...config.crawlSettings, dailyCrawlHourUtc: parseInt(e.target.value) || 0 },
                })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rate Limit Delay (ms)</label>
              <input
                type="number"
                value={config.crawlSettings.rateLimitDelayMs}
                onChange={(e) => setConfig({
                  ...config,
                  crawlSettings: { ...config.crawlSettings, rateLimitDelayMs: parseInt(e.target.value) || 0 },
                })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.crawlSettings.hourlyCrawlEnabled}
                  onChange={(e) => setConfig({
                    ...config,
                    crawlSettings: { ...config.crawlSettings, hourlyCrawlEnabled: e.target.checked },
                  })}
                  className="rounded border-gray-300 text-indigo-600"
                />
                <span className="text-sm text-gray-700">Hourly Pro Crawls</span>
              </label>
            </div>
          </div>
        </div>

        {/* Email Templates */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Email Templates</h2>
          <div className="space-y-4">
            {Object.entries(config.emailTemplates).map(([key, value]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{key}</label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setConfig({
                    ...config,
                    emailTemplates: { ...config.emailTemplates, [key]: e.target.value },
                  })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/admin/ConfigPage.tsx
git commit -m "feat: admin config page with toggles, plan limits, crawl settings, email templates"
```

---

## Task 13: Deploy & Verify

**Step 1: Run CDK deploy to update infrastructure**

Run: `cd ~/.openclaw/workspace/linkkeeper && bash scripts/deploy.sh`
Expected: ACM cert will be replaced (adds manager.linkkeeper.co SAN), CloudFront updated, Route53 record added. ~20-30 min.

**Step 2: Set up admin credentials**

Run: `bash scripts/setup-admin.sh`
Expected: Prompts for password, creates Secrets Manager secret.

**Step 3: Verify DNS for manager.linkkeeper.co**

Run: `dig manager.linkkeeper.co +short`
Expected: CloudFront IPs returned

**Step 4: Test admin login**

Run: `curl -s https://manager.linkkeeper.co/api/admin/login -X POST -H 'Content-Type: application/json' -d '{"email":"kevinmarkwert@gmail.com","password":"YOUR_PASSWORD"}' | python3 -m json.tool`
Expected: `{"token": "eyJ..."}`

**Step 5: Test admin overview**

Run: `TOKEN=$(curl -s https://manager.linkkeeper.co/api/admin/login -X POST -H 'Content-Type: application/json' -d '{"email":"kevinmarkwert@gmail.com","password":"YOUR_PASSWORD"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])') && curl -s https://manager.linkkeeper.co/api/admin/overview -H "Authorization: Bearer $TOKEN" | python3 -m json.tool`
Expected: JSON with totalUsers, planCounts, totalLinks, statusCounts, mrr

**Step 6: Commit everything and verify**

```bash
git add -A
git commit -m "feat: LinkKeeper admin dashboard v1 — manager.linkkeeper.co"
```
