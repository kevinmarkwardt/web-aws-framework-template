# web-aws-framework-template Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract YourApp into a reusable GitHub Template Repository (`web-aws-framework-template`) — a fully working, deployable opinionated AWS SaaS starter with a `scripts/init.sh` that bootstraps new projects in one command.

**Architecture:** Copy YourApp wholesale, replace all project-specific strings with `yourapp`/`YourApp`/`yourapp.com` placeholders, remove domain-specific Lambda workers (replace with one `daily-job` example), genericize the CRUD entity (`Link` → `Item`), strip YourApp-specific frontend pages, write comprehensive README and CLAUDE.md for template users, and mark as a GitHub Template Repository.

**Tech Stack:** React 19 + Vite + Tailwind CSS 4, Python 3.12 Lambda, AWS CDK v2 (TypeScript), DynamoDB single-table, Cognito, CloudFront + S3, SES, Bedrock Claude Haiku, Stripe, EventBridge, pytest + moto

**Design doc:** `docs/plans/2026-03-03-web-aws-framework-template-design.md`

---

## Pre-flight: understand the source repo

Before starting, note these key paths in the source (`~/.openclaw/workspace/yourapp/`):
- CDK: `cdk/bin/yourapp.ts`, `cdk/lib/yourapp-stack.ts`
- API: `api/handler.py`, `api/lib/db.py`, `api/routes/links.py`, `api/routes/pitches.py`
- Frontend: `frontend/src/App.tsx`, `frontend/src/types.ts`, `frontend/src/api.ts`
- Tests: `tests/conftest.py`, `tests/test_api_links.py`, `tests/test_api_pitches.py`
- Lambdas: `lambdas/crawler/`, `lambdas/alerts/`, `lambdas/digest/`, `lambdas/reminders/`, `lambdas/impact-scorer/`, `lambdas/report-generator/`

---

## Task 1: Create new repo and copy YourApp as base

**Files:**
- Create: `~/.openclaw/workspace/web-aws-framework-template/` (new repo root)

**Step 1: Create the GitHub repo**

```bash
gh repo create kevinmarkwardt/web-aws-framework-template \
  --public \
  --description "Opinionated AWS SaaS starter: React 19, Python Lambda, CDK, Cognito, DynamoDB, Stripe, SES, Bedrock" \
  --clone \
  --clone-dir ~/.openclaw/workspace/web-aws-framework-template
```

**Step 2: Copy YourApp files (excluding build artifacts and secrets)**

```bash
cd ~/.openclaw/workspace

rsync -av --progress yourapp/ web-aws-framework-template/ \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='cdk/node_modules' \
  --exclude='frontend/dist' \
  --exclude='cdk/cdk.out' \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='cdk-outputs.json' \
  --exclude='frontend/.env' \
  --exclude='.env' \
  --exclude='SPEC.md'
```

**Step 3: Remove files that are specific to YourApp and should not be in the template**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template

# Remove YourApp-specific files
rm -f SPEC.md
rm -f cdk-outputs.json
rm -f frontend/.env
```

**Step 4: Initial commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add .
git commit -m "chore: initial copy from yourapp"
git push -u origin main
```

Expected: Files pushed to GitHub. Repo has the full YourApp structure.

---

## Task 2: Global placeholder substitution

**Files:**
- Modify: all `.ts`, `.tsx`, `.py`, `.sh`, `.json`, `.md` files throughout repo

**Step 1: Run the substitutions (in this exact order — longer strings first)**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template

# Cross-platform sed helper
if [[ "$OSTYPE" == "darwin"* ]]; then
  sedi() { sed -i '' "$@"; }
else
  sedi() { sed -i "$@"; }
fi

# File types to update
FILES=$(find . \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -not -path './frontend/node_modules/*' \
  -not -path './cdk/node_modules/*' \
  -not -path './.venv/*' \
  -not -path './__pycache__/*' \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.sh' \
     -o -name '*.json' -o -name '*.md' -o -name '*.txt' -o -name '*.css' \) \
  -type f)

# 1. AWS account ID → placeholder
echo "$FILES" | xargs sedi 's/YOUR_AWS_ACCOUNT_ID/YOUR_AWS_ACCOUNT_ID/g'

# 2. Subdomain (before root domain)
echo "$FILES" | xargs sedi 's/manager\.yourapp\.co/manager.yourapp.com/g'

# 3. Root domain
echo "$FILES" | xargs sedi 's/yourapp\.co/yourapp.com/g'

# 4. Title case (must come before lowercase)
echo "$FILES" | xargs sedi 's/YourApp/YourApp/g'

# 5. Lowercase (all remaining occurrences)
echo "$FILES" | xargs sedi 's/yourapp/yourapp/g'

# 6. Test table name
echo "$FILES" | xargs sedi 's/yourapp-test/yourapp-test/g'  # no-op, confirm

echo "Done."
```

**Step 2: Update package.json names**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template

# frontend/package.json: name field
sedi 's/"name": "yourapp-frontend"/"name": "yourapp-frontend"/' frontend/package.json
# (name was already yourapp-frontend → yourapp-frontend from step above)

# cdk/package.json: name field
sedi 's/"name": "yourapp"/"name": "yourapp-cdk"/' cdk/package.json
```

**Step 3: Verify key replacements happened**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template

# Should show NO results (no lingering hardcoded values)
grep -r "YOUR_AWS_ACCOUNT_ID" --include="*.ts" --include="*.py" --include="*.json" .
grep -r "yourapp\.co" --include="*.ts" --include="*.py" .
grep -r "YourApp" --include="*.ts" --include="*.tsx" --include="*.py" .

# Should show references to yourapp (good)
grep -r "yourapp" --include="*.ts" -l . | head -10
```

Expected: No results for the first three greps. Multiple files in the fourth.

**Step 4: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add -A
git commit -m "chore: replace all yourapp placeholders with yourapp"
git push
```

---

## Task 3: Rename CDK files and update cdk.json

**Files:**
- Rename: `cdk/bin/yourapp.ts` → `cdk/bin/yourapp.ts`
- Rename: `cdk/lib/yourapp-stack.ts` → `cdk/lib/yourapp-stack.ts`
- Modify: `cdk/cdk.json`

**Step 1: Rename the files**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template/cdk

mv bin/yourapp.ts bin/yourapp.ts
mv lib/yourapp-stack.ts lib/yourapp-stack.ts
```

**Step 2: Update cdk.json to point to new entry**

Open `cdk/cdk.json`. Change the `app` field:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/yourapp.ts",
  ...
}
```

**Step 3: Update the import in bin/yourapp.ts**

The file currently imports from `../lib/yourapp-stack` — after the rename and global replace it should already say `../lib/yourapp-stack`. Verify:

```bash
cat cdk/bin/yourapp.ts
# Should contain: import { YourAppStack } from '../lib/yourapp-stack';
```

**Step 4: Update the CDK entry to use env vars instead of hardcoded account**

Edit `cdk/bin/yourapp.ts` to read account from environment:

```typescript
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { YourAppStack } from '../lib/yourapp-stack';

const app = new cdk.App();

new YourAppStack(app, 'YourAppStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  domainName: process.env.DOMAIN_NAME || 'yourapp.com',
});
```

**Step 5: Verify CDK TypeScript compiles**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template/cdk
npm ci
npx tsc --noEmit
```

Expected: No TypeScript errors.

**Step 6: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add -A
git commit -m "refactor: rename CDK files to yourapp, read account from env"
git push
```

---

## Task 4: Remove domain lambdas, create daily-job example

**Files:**
- Delete: `lambdas/crawler/`, `lambdas/alerts/`, `lambdas/digest/`, `lambdas/reminders/`, `lambdas/impact-scorer/`, `lambdas/report-generator/`, `lambdas/stripe-webhook/`
- Create: `lambdas/daily-job/handler.py`
- Create: `lambdas/daily-job/requirements.txt`

**Step 1: Delete domain-specific lambda directories**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template

rm -rf lambdas/crawler
rm -rf lambdas/alerts
rm -rf lambdas/digest
rm -rf lambdas/reminders
rm -rf lambdas/impact-scorer
rm -rf lambdas/report-generator
rm -rf lambdas/stripe-webhook

ls lambdas/  # Should be empty now
```

**Step 2: Create daily-job lambda**

Create `lambdas/daily-job/handler.py`:

```python
"""
daily-job — Example EventBridge-scheduled Lambda.

This is a template. Replace this handler with your business logic.

Demonstrates:
  - Reading all items from DynamoDB
  - Optional Bedrock (Claude) AI call
  - Optional SES email summary

EventBridge triggers this daily at 8 AM UTC via the CDK schedule in
lib/yourapp-stack.ts. Adjust the cron expression there to change frequency.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ["TABLE_NAME"]
FROM_EMAIL = os.environ["FROM_EMAIL"]
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

dynamodb = boto3.resource("dynamodb")
ses = boto3.client("ses")
bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)


def handler(event, context):
    """
    Main entry point — called by EventBridge on schedule.

    Replace this function with your application's scheduled job logic.
    """
    table = dynamodb.Table(TABLE_NAME)

    # ----------------------------------------------------------------
    # Step 1: Query DynamoDB for items to process
    # ----------------------------------------------------------------
    # Prefer Query over Scan in production — add a GSI if you need
    # to filter by status or other attributes.
    response = table.scan(
        FilterExpression=Key("sk").begins_with("ITEM#")
    )
    items = response.get("Items", [])
    print(f"[daily-job] Found {len(items)} items to process")

    # ----------------------------------------------------------------
    # Step 2: Process each item (replace with your logic)
    # ----------------------------------------------------------------
    results = []
    for item in items:
        item_id = item.get("itemId")
        # TODO: Add your business logic here.
        # Examples:
        #   - Check an external API for status changes
        #   - Update DynamoDB with new status
        #   - Send per-item alerts
        results.append({"itemId": item_id, "processed": True})

    # ----------------------------------------------------------------
    # Step 3: Optional — call Bedrock (Claude) for AI analysis
    # ----------------------------------------------------------------
    # Uncomment to enable:
    #
    # ai_response = bedrock.invoke_model(
    #     modelId=BEDROCK_MODEL_ID,
    #     body=json.dumps({
    #         "anthropic_version": "bedrock-2023-05-31",
    #         "max_tokens": 512,
    #         "messages": [{
    #             "role": "user",
    #             "content": f"Summarize these results: {json.dumps(results[:20])}"
    #         }]
    #     }),
    #     contentType="application/json",
    # )
    # summary = json.loads(ai_response["body"].read())["content"][0]["text"]
    # print(f"[daily-job] AI summary: {summary}")

    # ----------------------------------------------------------------
    # Step 4: Optional — send summary email via SES
    # ----------------------------------------------------------------
    # Uncomment to enable:
    #
    # ses.send_email(
    #     Source=FROM_EMAIL,
    #     Destination={"ToAddresses": ["admin@yourapp.com"]},
    #     Message={
    #         "Subject": {
    #             "Data": f"Daily Job — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    #         },
    #         "Body": {
    #             "Text": {
    #                 "Data": f"Processed {len(results)} items.\n\n{json.dumps(results, indent=2)}"
    #             }
    #         },
    #     }
    # )

    print(f"[daily-job] Done. Processed {len(results)} items.")
    return {
        "statusCode": 200,
        "body": json.dumps({
            "processed": len(results),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }),
    }
```

**Step 3: Create requirements.txt**

Create `lambdas/daily-job/requirements.txt`:

```
boto3>=1.38.0
```

**Step 4: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add -A
git commit -m "feat: replace domain lambdas with daily-job example worker"
git push
```

---

## Task 5: Update CDK stack — swap domain lambdas for daily-job

**Files:**
- Modify: `cdk/lib/yourapp-stack.ts`

This is the largest single-file change. The stack is ~577 lines. You need to:

**Step 1: Read the current stack**

```bash
cat ~/.openclaw/workspace/web-aws-framework-template/cdk/lib/yourapp-stack.ts
```

**Step 2: Remove the 6 domain Lambda definitions**

Find and delete these blocks (each is a `new lambda.Function(...)` call):
- `functionName: 'yourapp-crawler'`
- `functionName: 'yourapp-alerts'`
- `functionName: 'yourapp-digest'`
- `functionName: 'yourapp-reminders'`
- `functionName: 'yourapp-impact-scorer'`
- `functionName: 'yourapp-report-generator'`

Also remove any IAM grants between these lambdas (e.g., `crawlerFn.grantInvoke(alertsFn)`).

**Step 3: Remove the 5 domain EventBridge rules**

Find and delete blocks with:
- `ruleName: 'yourapp-daily-crawl'`
- `ruleName: 'yourapp-hourly-crawl'`
- `ruleName: 'yourapp-monday-digest'`
- `ruleName: 'yourapp-daily-reminders'`
- `ruleName: 'yourapp-monthly-report'`

**Step 4: Remove domain Lambda environment variables from the API Lambda**

The api Lambda currently passes `ALERTS_FUNCTION` and `IMPACT_SCORER_FUNCTION` env vars. Remove those lines from the `environment` block of the `yourapp-api` Lambda definition.

**Step 5: Add daily-job Lambda definition**

Find the section after the api Lambda definition and add:

```typescript
// ========================================================================
// daily-job Lambda — Example scheduled worker (replace with your logic)
// ========================================================================
const dailyJobFn = new lambda.Function(this, 'DailyJobFunction', {
  functionName: 'yourapp-daily-job',
  runtime: lambda.Runtime.PYTHON_3_12,
  architecture: lambda.Architecture.ARM_64,
  handler: 'handler.handler',
  code: lambda.Code.fromAsset('../../lambdas/daily-job'),
  timeout: cdk.Duration.minutes(5),
  memorySize: 256,
  logGroup: makeLogGroup('daily-job'),
  environment: {
    TABLE_NAME: mainTable.tableName,
    FROM_EMAIL: `noreply@${domainName}`,
    BEDROCK_MODEL_ID: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    AWS_ACCOUNT_ID: this.account,
  },
});

mainTable.grantReadWriteData(dailyJobFn);

// Grant SES send permission
dailyJobFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ses:SendEmail'],
  resources: ['*'],
}));

// Grant Bedrock access (optional — remove if not using AI)
dailyJobFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: ['*'],
}));
```

**Step 6: Add daily-job EventBridge rule**

Find the EventBridge section and replace the domain rules with:

```typescript
// ========================================================================
// EventBridge — Daily job schedule (8 AM UTC = 3 AM ET)
// Change cron expression to match your needs
// ========================================================================
new events.Rule(this, 'DailyJobRule', {
  ruleName: 'yourapp-daily-job',
  schedule: events.Schedule.cron({ minute: '0', hour: '8' }),
  targets: [new eventsTargets.LambdaFunction(dailyJobFn)],
});
```

**Step 7: Update Secrets Manager IAM resource pattern**

Find the policy statement with:
```typescript
resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:yourapp/*`],
```
This should be correct already after the global replace in Task 2.

**Step 8: Verify CDK compiles**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template/cdk
npx tsc --noEmit
```

Expected: No TypeScript errors.

**Step 9: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add cdk/
git commit -m "feat: update CDK stack — remove domain lambdas, add daily-job"
git push
```

---

## Task 6: TDD — api/routes/items.py (generic CRUD)

**Files:**
- Create: `tests/test_api_items.py`
- Create: `api/routes/items.py`

**Step 1: Write the failing tests first**

Create `tests/test_api_items.py`:

```python
"""Tests for Items CRUD API routes."""

import json

import pytest
from moto import mock_aws
from unittest.mock import patch

from tests.conftest import make_api_event
from api.routes import items
from api.lib import db


@mock_aws
class TestListItems:
    def test_list_empty(self, dynamodb_table, create_test_user):
        create_test_user()
        result = items.list_items("user-123", make_api_event("GET", "/api/items"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body == []

    def test_list_with_items(self, dynamodb_table, create_test_user, create_test_item):
        create_test_user()
        create_test_item(item_id="item-001")
        create_test_item(item_id="item-002", name="Second item")

        result = items.list_items("user-123", make_api_event("GET", "/api/items"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert len(body) == 2


@mock_aws
class TestCreateItem:
    def test_create_item(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/items", body={
            "name": "My first item",
            "status": "ACTIVE",
        })

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert body["name"] == "My first item"
        assert body["status"] == "ACTIVE"
        assert "itemId" in body

    def test_create_item_missing_name(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/items", body={"status": "ACTIVE"})

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 400

    def test_free_plan_limit(self, dynamodb_table, create_test_user):
        create_test_user(item_count=10)  # free plan limit is 10
        event = make_api_event("POST", "/api/items", body={"name": "overflow item"})

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 403
        body = json.loads(result["body"])
        assert "limit" in body["error"].lower()

    def test_starter_plan_higher_limit(self, dynamodb_table, create_test_user):
        create_test_user(plan="starter", item_count=10)
        event = make_api_event("POST", "/api/items", body={"name": "ok item"})

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 201


@mock_aws
class TestUpdateItem:
    def test_update_item(self, dynamodb_table, create_test_user, create_test_item):
        create_test_user()
        create_test_item(item_id="item-001", name="Old name")

        event = make_api_event("PUT", "/api/items/item-001", body={"name": "New name"})
        result = items.update_item("user-123", "item-001", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["name"] == "New name"

    def test_update_missing_item(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("PUT", "/api/items/missing-id", body={"name": "x"})
        result = items.update_item("user-123", "missing-id", event)
        assert result["statusCode"] == 404


@mock_aws
class TestDeleteItem:
    def test_delete_item(self, dynamodb_table, create_test_user, create_test_item):
        create_test_user()
        create_test_item(item_id="item-001")

        event = make_api_event("DELETE", "/api/items/item-001")
        result = items.delete_item("user-123", "item-001", event)
        assert result["statusCode"] == 200

        # Verify deleted
        result = items.list_items("user-123", make_api_event("GET", "/api/items"))
        body = json.loads(result["body"])
        assert len(body) == 0

    def test_delete_missing_item(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("DELETE", "/api/items/missing-id")
        result = items.delete_item("user-123", "missing-id", event)
        assert result["statusCode"] == 404
```

**Step 2: Run tests — expect ImportError (module doesn't exist yet)**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
python -m pytest tests/test_api_items.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError: No module named 'api.routes.items'`

**Step 3: Create api/routes/items.py**

```python
"""Items CRUD routes.

This is the generic CRUD template. Rename 'items' to your domain entity
(e.g., 'posts', 'products', 'jobs') and extend with your business logic.
"""

from __future__ import annotations

import json

import ulid

try:
    from lib import db, response
except ImportError:
    from api.lib import db, response


def list_items(user_id: str, event: dict) -> dict:
    """GET /api/items — return all items for this user."""
    result = db.get_items(user_id)
    return response.ok(result)


def create_item(user_id: str, event: dict) -> dict:
    """POST /api/items — create a new item."""
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    plan = user.get("plan", "free")
    current_count = user.get("itemCount", 0)
    limit = db.ITEM_LIMITS.get(plan, 10)

    body = json.loads(event.get("body", "{}"))
    name = body.get("name", "").strip()
    status = body.get("status", "ACTIVE").strip()

    if not name:
        return response.error("name is required", 400)

    if current_count >= limit:
        return response.error(
            f"Plan limit reached. {plan.title()} plan allows {int(limit)} items. "
            f"You have {current_count}.",
            403,
        )

    item_id = str(ulid.ULID())
    item = db.create_item(user_id, item_id, name, status)
    db.increment_item_count(user_id, 1)
    return response.ok(item, 201)


def update_item(user_id: str, item_id: str, event: dict) -> dict:
    """PUT /api/items/{itemId} — update name or status."""
    existing = db.get_item(user_id, item_id)
    if not existing:
        return response.not_found("Item not found")

    body = json.loads(event.get("body", "{}"))
    updates = {}
    if "name" in body:
        updates["name"] = body["name"].strip()
    if "status" in body:
        updates["status"] = body["status"].strip()

    updated = db.update_item(user_id, item_id, updates)
    return response.ok(updated)


def delete_item(user_id: str, item_id: str, event: dict) -> dict:
    """DELETE /api/items/{itemId} — remove an item."""
    existing = db.get_item(user_id, item_id)
    if not existing:
        return response.not_found("Item not found")

    db.delete_item(user_id, item_id)
    db.increment_item_count(user_id, -1)
    return response.ok({"deleted": True})
```

**Step 4: Run tests — expect db function errors (db not updated yet)**

```bash
python -m pytest tests/test_api_items.py -v 2>&1 | head -30
```

Expected: AttributeError — `db.get_items` doesn't exist yet. That's fine, you'll fix db in Task 7.

**Step 5: Commit items.py (tests will pass after Task 7)**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add api/routes/items.py tests/test_api_items.py
git commit -m "feat: add items CRUD routes and tests (tests pass after db update)"
git push
```

---

## Task 7: Update api/lib/db.py and api/handler.py — swap Link→Item

**Files:**
- Modify: `api/lib/db.py`
- Modify: `api/handler.py`
- Delete: `api/routes/links.py`, `api/routes/pitches.py`

**Step 1: Read the current db.py**

```bash
cat ~/.openclaw/workspace/web-aws-framework-template/api/lib/db.py
```

**Step 2: Update db.py — rename constants and functions**

Make these exact changes:

1. **LINK_LIMITS → ITEM_LIMITS** with updated defaults:
```python
# Before:
LINK_LIMITS = {"free": 5, "starter": 50, "pro": float("inf")}

# After:
ITEM_LIMITS = {"free": 10, "starter": 100, "pro": float("inf")}
```

2. **TABLE_NAME default** (was already updated by global replace, but verify):
```python
TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")
```

3. **User profile creation — rename linkCount → itemCount**:
```python
# In create_user() or wherever the profile dict is built:
# Before: "linkCount": 0,
# After:  "itemCount": 0,
```

4. **increment_link_count → increment_item_count**:
```python
# Before:
def increment_link_count(user_id: str, delta: int) -> None:
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET linkCount = linkCount + :d",
        ...
    )

# After:
def increment_item_count(user_id: str, delta: int) -> None:
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET itemCount = itemCount + :d",
        ...
    )
```

5. **Rename all link DB functions → item DB functions** (find these by searching `LINK#`):
```python
# get_links → get_items
def get_items(user_id: str) -> list:
    resp = table.query(
        KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("ITEM#"),
    )
    return resp.get("Items", [])

# get_link → get_item
def get_item(user_id: str, item_id: str) -> dict | None:
    resp = table.get_item(Key={"pk": f"USER#{user_id}", "sk": f"ITEM#{item_id}"})
    return resp.get("Item")

# create_link → create_item
def create_item(user_id: str, item_id: str, name: str, status: str = "ACTIVE") -> dict:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "pk": f"USER#{user_id}",
        "sk": f"ITEM#{item_id}",
        "userId": user_id,
        "itemId": item_id,
        "name": name,
        "status": status,
        "createdAt": now,
        "updatedAt": now,
    }
    table.put_item(Item=item)
    return item

# update_link → update_item
def update_item(user_id: str, item_id: str, updates: dict) -> dict:
    from datetime import datetime, timezone
    updates["updatedAt"] = datetime.now(timezone.utc).isoformat()

    expr_parts = [f"#{k} = :{k}" for k in updates]
    expr_names = {f"#{k}": k for k in updates}
    expr_values = {f":{k}": v for k, v in updates.items()}

    resp = table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": f"ITEM#{item_id}"},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]

# delete_link → delete_item
def delete_item(user_id: str, item_id: str) -> None:
    table.delete_item(Key={"pk": f"USER#{user_id}", "sk": f"ITEM#{item_id}"})
```

6. **Remove all pitch-related functions** (get_pitches, get_pitch, create_pitch, update_pitch, delete_pitch, and any `PITCH#` references in admin scan functions). The admin scan in `admin.py` that scans for `PITCH#` items can be left but the data type should be updated if it also scans `ITEM#`.

**Step 3: Update api/handler.py — swap routing**

```python
# Remove these imports:
from routes import links, pitches, account, billing, admin
# (or the try/except equivalent)

# Add items import:
from routes import items, account, billing, admin

# Remove the _route() body's link and pitch routing:
# DELETE: all blocks referencing links.* and pitches.*

# Add items routing:
def _route(method: str, path: str, user_id: str, event: dict) -> dict:
    """Route authenticated user requests."""

    if method == "GET" and path == "/api/items":
        return items.list_items(user_id, event)

    if method == "POST" and path == "/api/items":
        return items.create_item(user_id, event)

    m = re.match(r"^/api/items/([A-Za-z0-9]+)$", path)
    if m:
        item_id = m.group(1)
        if method == "PUT":
            return items.update_item(user_id, item_id, event)
        if method == "DELETE":
            return items.delete_item(user_id, item_id, event)

    return account._route(method, path, user_id, event)
```

Also update the account routing to call the right module (check current handler for `account.*` routes).

**Step 4: Delete domain route files**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
rm api/routes/links.py
rm api/routes/pitches.py
```

**Step 5: Update tests/conftest.py**

Make these changes to `conftest.py`:

1. Change `TABLE_NAME`:
```python
os.environ["TABLE_NAME"] = "yourapp-test"
```

2. Change email/URL env vars:
```python
os.environ["SES_FROM_EMAIL"] = "test@yourapp.com"
os.environ["FRONTEND_URL"] = "https://yourapp.com"
os.environ["REPORTS_BUCKET"] = "yourapp-reports-test"
```

3. Remove domain-specific env vars:
```python
# DELETE these lines:
os.environ["ALERTS_FUNCTION"] = "yourapp-alerts-test"
os.environ["IMPACT_SCORER_FUNCTION"] = "yourapp-impact-scorer-test"
```

4. In `create_test_user` fixture, rename `link_count` → `item_count` and `linkCount` → `itemCount`:
```python
def _create(user_id="user-123", email="test@example.com", plan="free",
            item_count=0, stripe_customer_id="", stripe_subscription_id=""):
    item = {
        ...
        "itemCount": item_count,
        ...
    }
```

5. Remove `create_test_link` and `create_test_pitch` fixtures. Add `create_test_item`:
```python
@pytest.fixture
def create_test_item(dynamodb_table):
    """Factory fixture to insert an item into DynamoDB."""
    def _create(user_id="user-123", item_id="item-001",
                name="Test item", status="ACTIVE"):
        dynamodb_table.put_item(Item={
            "pk": f"USER#{user_id}",
            "sk": f"ITEM#{item_id}",
            "userId": user_id,
            "itemId": item_id,
            "name": name,
            "status": status,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "updatedAt": "2026-01-01T00:00:00+00:00",
        })
        return item_id
    return _create
```

**Step 6: Delete domain-specific tests**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
rm tests/test_api_links.py
rm tests/test_api_pitches.py
rm tests/test_crawler.py
rm tests/test_alerts.py
```

**Step 7: Run full test suite — verify all pass**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
python -m pytest tests/ -v
```

Expected: All tests pass. `test_api_items.py`, `test_auth.py`, `test_api_billing.py` should all be green.

**Step 8: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add -A
git commit -m "feat: genericize db/handler/tests — Link→Item, remove pitch, delete domain routes"
git push
```

---

## Task 8: Update frontend types and API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

**Step 1: Read current types.ts**

```bash
cat ~/.openclaw/workspace/web-aws-framework-template/frontend/src/types.ts
```

**Step 2: Replace Link and Pitch types with Item**

Remove `Link`, `Pitch`, and any YourApp-specific interfaces. Add:

```typescript
export interface Item {
  itemId: string;
  userId: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemRequest {
  name: string;
  status?: string;
}

export interface UpdateItemRequest {
  name?: string;
  status?: string;
}
```

Keep the `User` interface — it's generic. Remove any fields specific to YourApp (e.g., `linkCount` → rename to `itemCount` in the User interface).

**Step 3: Update api.ts — replace link/pitch calls with item calls**

Read the current file, then replace all `fetchLinks`, `createLink`, `updateLink`, `deleteLink`, `fetchPitches`, etc. with:

```typescript
import type { Item, CreateItemRequest, UpdateItemRequest } from './types';

// Items

export async function fetchItems(): Promise<Item[]> {
  const res = await authedFetch('/api/items');
  return res.json();
}

export async function createItem(data: CreateItemRequest): Promise<Item> {
  const res = await authedFetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateItem(itemId: string, data: UpdateItemRequest): Promise<Item> {
  const res = await authedFetch(`/api/items/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteItem(itemId: string): Promise<void> {
  const res = await authedFetch(`/api/items/${itemId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
}
```

Keep `fetchAccount`, `updateSettings`, `createCheckoutSession`, `createPortalSession` — these are generic.

**Step 4: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: genericize frontend types and API client — Link→Item"
git push
```

---

## Task 9: Remove domain-specific frontend files, create generic replacements

**Files:**
- Delete: multiple YourApp-specific components and pages
- Create: `frontend/src/pages/dashboard/ItemsPage.tsx`
- Create: `frontend/src/components/ItemsTable.tsx`
- Create: `frontend/src/components/AddItemForm.tsx`

**Step 1: Delete domain-specific frontend files**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template/frontend/src

rm pages/dashboard/LinksPage.tsx
rm pages/dashboard/PipelinePage.tsx
rm components/AddLinkForm.tsx
rm components/AddPitchModal.tsx
rm components/BulkPasteModal.tsx
rm components/CSVUploadModal.tsx
rm components/LinksTable.tsx
rm components/LinkDetailDrawer.tsx
rm components/PipelineTable.tsx
```

**Step 2: Create ItemsTable.tsx**

Create `frontend/src/components/ItemsTable.tsx`:

```tsx
import type { Item } from '../types';
import StatusBadge from './StatusBadge';

interface Props {
  items: Item[];
  onDelete: (itemId: string) => void;
  onEdit: (item: Item) => void;
}

export default function ItemsTable({ items, onDelete, onEdit }: Props) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg font-medium">No items yet</p>
        <p className="text-sm mt-1">Add your first item to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-600 uppercase text-xs tracking-wider">
            <th className="px-4 py-3 border-b">Name</th>
            <th className="px-4 py-3 border-b">Status</th>
            <th className="px-4 py-3 border-b">Created</th>
            <th className="px-4 py-3 border-b">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.itemId} className="border-b hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-3 text-gray-500">
                {new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 flex gap-2">
                <button
                  onClick={() => onEdit(item)}
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${item.name}"?`)) onDelete(item.itemId);
                  }}
                  className="text-red-500 hover:text-red-700 text-sm font-medium"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 3: Create AddItemForm.tsx**

Create `frontend/src/components/AddItemForm.tsx`:

```tsx
import { useState } from 'react';
import type { CreateItemRequest } from '../types';

interface Props {
  onSubmit: (data: CreateItemRequest) => Promise<void>;
  onCancel: () => void;
}

export default function AddItemForm({ onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), status });
      setName('');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter item name"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="flex-1 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Adding…' : 'Add Item'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
```

**Step 4: Create ItemsPage.tsx**

Create `frontend/src/pages/dashboard/ItemsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchItems, createItem, deleteItem } from '../../api';
import type { Item } from '../../types';
import ItemsTable from '../../components/ItemsTable';
import AddItemForm from '../../components/AddItemForm';

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await fetchItems();
      setItems(data);
    } catch {
      setError('Failed to load items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (data: { name: string; status?: string }) => {
    await createItem(data);
    setShowForm(false);
    await load();
  };

  const handleDelete = async (itemId: string) => {
    await deleteItem(itemId);
    setItems((prev) => prev.filter((i) => i.itemId !== itemId));
  };

  const handleEdit = (item: Item) => {
    // TODO: open an edit modal or inline editor
    alert(`Edit item: ${item.name} — add edit UI here`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Items</h1>
          <p className="text-sm text-gray-500 mt-1">{items.length} item{items.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Add Item
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Item</h2>
          <AddItemForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <ItemsTable items={items} onDelete={handleDelete} onEdit={handleEdit} />
      </div>
    </div>
  );
}
```

**Step 5: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add -A
git commit -m "feat: replace LinksPage/PipelinePage with generic ItemsPage and components"
git push
```

---

## Task 10: Update App.tsx, LandingPage, and verify frontend builds

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/LandingPage.tsx`

**Step 1: Update App.tsx**

Open `frontend/src/App.tsx`. Make these changes:

1. Remove imports:
```typescript
// DELETE these lines:
import LinksPage from './pages/dashboard/LinksPage';
import PipelinePage from './pages/dashboard/PipelinePage';
```

2. Add import:
```typescript
import ItemsPage from './pages/dashboard/ItemsPage';
```

3. In `UserApp` routes, update the dashboard:
```tsx
<Route
  path="/dashboard"
  element={
    <ProtectedRoute>
      <DashboardLayout />
    </ProtectedRoute>
  }
>
  <Route index element={<ItemsPage />} />
  {/* <Route path="pipeline" element={<PipelinePage />} /> — removed, add your own */}
  <Route path="settings" element={<SettingsPage />} />
  <Route path="reports" element={<ReportsPage />} />
</Route>
```

4. Update the `isManagerHost` comment:
```typescript
// Admin app served on manager.yourapp.com
const isManagerHost = window.location.hostname.startsWith('manager.');
```

**Step 2: Update LandingPage.tsx with generic copy**

Open `frontend/src/pages/LandingPage.tsx`. This file is YourApp-specific (backlinks, SEO, etc.). Replace the marketing copy with generic placeholders:

Key sections to update:
- **Hero headline:** Change to `Track Your [Thing]. Know When It Changes.` (or similar generic SaaS copy)
- **Subheadline:** Remove references to backlinks/SEO/guest posts
- **Feature bullets:** Replace with generic "Monitor items", "Get alerts", "Pro analytics"
- **Pricing section:** Update plan names/features to match generic `ITEM_LIMITS`
- **CTA buttons:** Keep as-is (point to /signup)

This page has a lot of content. Focus on removing product-specific terminology. The exact copy doesn't matter — users will replace it.

Example hero replacement (find the hero section and update):
```tsx
<h1 className="...">
  Track Everything.<br />
  <span className="text-indigo-600">Know When It Changes.</span>
</h1>
<p className="...">
  YourApp monitors your items and alerts you the moment something changes.
  Built for teams who can't afford to miss a thing.
</p>
```

**Step 3: Update DashboardLayout.tsx nav links**

Open `frontend/src/pages/dashboard/DashboardLayout.tsx`. Remove any "Pipeline" nav link and ensure the nav reflects the generic `Items` page.

Find the nav array and remove the pipeline entry:
```tsx
const navItems = [
  { to: '/dashboard', label: 'Items', icon: /* ... */ },
  // Remove: { to: '/dashboard/pipeline', label: 'Pipeline', icon: /* ... */ },
  { to: '/dashboard/settings', label: 'Settings', icon: /* ... */ },
  { to: '/dashboard/reports', label: 'Reports', icon: /* ... */ },
];
```

**Step 4: Build the frontend to verify no TypeScript errors**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template/frontend
npm ci
npm run build
```

Expected: Build succeeds with no errors. Fix any TypeScript import errors before continuing.

**Step 5: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add -A
git commit -m "feat: update App.tsx router, LandingPage, and DashboardLayout for generic template"
git push
```

---

## Task 11: Create scripts/init.sh

**Files:**
- Create: `scripts/init.sh`

**Step 1: Create the script**

Create `scripts/init.sh`:

```bash
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

# Cross-platform sed -i
if [[ "$OSTYPE" == "darwin"* ]]; then
  sedi() { sed -i '' "$@"; }
else
  sedi() { sed -i "$@"; }
fi

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

echo "$FILES" | xargs sedi "s/YOUR_AWS_ACCOUNT_ID/$AWS_ACCOUNT_ID/g"
echo -e "  ${GREEN}✓${NC} AWS Account ID"

echo "$FILES" | xargs sedi "s/manager\.yourapp\.com/manager.$DOMAIN/g"
echo "$FILES" | xargs sedi "s/yourapp\.com/$DOMAIN/g"
echo -e "  ${GREEN}✓${NC} Domain name"

echo "$FILES" | xargs sedi "s/YourApp/$DISPLAY_NAME/g"
echo -e "  ${GREEN}✓${NC} Display name"

echo "$FILES" | xargs sedi "s/yourapp/$PROJECT_NAME/g"
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
echo "Good luck! 🚀"
echo ""
```

**Step 2: Make it executable**

```bash
chmod +x ~/.openclaw/workspace/web-aws-framework-template/scripts/init.sh
```

**Step 3: Test it with a dry run (on a copy)**

```bash
cd /tmp
cp -r ~/.openclaw/workspace/web-aws-framework-template web-aws-framework-test
cd web-aws-framework-test

# Test: run init.sh
./scripts/init.sh
# Enter: myapp / MyApp / myapp.com / 111122223333

# Verify substitutions
grep -r "myapp" cdk/bin/ | head -5
grep -r "111122223333" cdk/bin/ | head -5
ls cdk/bin/   # Should show myapp.ts
ls cdk/lib/   # Should show myapp-stack.ts

# Clean up
cd /tmp && rm -rf web-aws-framework-test
```

Expected: All substitutions applied correctly, CDK files renamed.

**Step 4: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add scripts/init.sh
git commit -m "feat: add init.sh — one-command project bootstrapping"
git push
```

---

## Task 12: Update deploy-lambdas.sh for new structure

**Files:**
- Modify: `scripts/deploy-lambdas.sh`

**Step 1: Read the current deploy-lambdas.sh**

```bash
cat ~/.openclaw/workspace/web-aws-framework-template/scripts/deploy-lambdas.sh
```

**Step 2: Update to only package daily-job (and api)**

The current script loops over all lambdas or packages specific ones. Update it to only reference `daily-job` and `api`:

Find the lambda list/array and replace with:
```bash
LAMBDA_DIRS=("daily-job")
# Note: api is packaged separately (it's in the api/ directory, not lambdas/)
```

Remove any references to crawler, alerts, digest, reminders, impact-scorer, report-generator.

**Step 3: Verify deploy.sh references are correct**

```bash
cat ~/.openclaw/workspace/web-aws-framework-template/scripts/deploy.sh
```

Ensure it doesn't reference any removed lambdas. The deploy.sh orchestrates the full deployment — verify all 6 steps still reference valid paths.

**Step 4: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add scripts/
git commit -m "chore: update deploy scripts for daily-job lambda only"
git push
```

---

## Task 13: Write README.md

**Files:**
- Create/overwrite: `README.md`

**Step 1: Write the README**

Create `README.md` at the repo root:

```markdown
# web-aws-framework-template

An opinionated, production-ready AWS SaaS starter. Everything you need to ship a subscription web app in a weekend.

**What's included out of the box:**
- User auth (sign up, log in, email verification, forgot password) via Cognito
- Protected dashboard with generic CRUD (replace "items" with your entity)
- Admin panel with user management, billing overview, feature toggles
- Stripe subscription billing (Checkout + Customer Portal)
- Scheduled background job (EventBridge + Lambda)
- Transactional email via SES
- AI integration via Bedrock (Claude Haiku)
- Full test suite (pytest + moto) with all AWS services mocked
- One-command deploy via CDK

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS 4 |
| Backend | Python 3.12 + AWS Lambda (ARM64) |
| Infrastructure | AWS CDK v2 (TypeScript) |
| Auth | AWS Cognito (user pool + JWT) |
| Database | DynamoDB (single-table design) |
| CDN + Hosting | CloudFront + S3 |
| Email | AWS SES |
| AI | AWS Bedrock (Claude Haiku) |
| Payments | Stripe (subscriptions) |
| Scheduling | EventBridge |
| DNS | Route53 |

## Prerequisites

- Node.js 20+ and npm
- Python 3.12 and pip
- AWS CLI v2 configured (`aws configure`)
- CDK CLI: `npm install -g aws-cdk`
- AWS account with a domain registered in Route53
- Stripe account (for billing)

## Quick Start

### 1. Use this template

Click **"Use this template"** on GitHub, create your repo, then clone it:

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME
cd YOUR_REPO_NAME
```

### 2. Initialize the project

```bash
./scripts/init.sh
```

This prompts for your project name, display name, domain, and AWS account ID — then does a global find-replace across all files and renames the CDK stack.

### 3. Configure secrets

```bash
cp .env.example .env
# Edit .env and fill in:
#   STRIPE_SECRET_KEY
#   STRIPE_WEBHOOK_SECRET
#   STRIPE_PRICE_STARTER
#   STRIPE_PRICE_PRO
```

### 4. Deploy to AWS

```bash
./scripts/deploy.sh
```

This runs in 6 steps:
1. Install frontend and Lambda dependencies
2. Deploy CDK infrastructure (DynamoDB, Cognito, Lambda, CloudFront, SES, Route53)
3. Extract Cognito IDs → `frontend/.env`
4. Build the React app
5. Sync to S3 and invalidate CloudFront
6. Done — your app is live at your domain

### 5. Set up admin access

```bash
./scripts/setup-admin.sh
```

Creates an admin JWT secret in Secrets Manager. Admin panel is at `manager.yourdomain.com`.

## Architecture

```
yourapp.com (CloudFront + S3)
├── / — Landing page
├── /login, /signup, /verify — Auth flows (Cognito)
├── /dashboard — Protected user app
│   ├── /dashboard — Items page (generic CRUD)
│   ├── /dashboard/settings — User settings
│   └── /dashboard/reports — Reports (Pro)
└── manager.yourapp.com — Admin panel
    ├── /users — All users
    ├── /billing — Revenue overview
    ├── /health — Lambda/DB status
    └── /config — Feature flags, plan limits

API (Lambda Function URL — no API Gateway)
├── GET/POST /api/items — CRUD for your entity
├── GET/PUT /api/account — User profile
├── POST /api/billing/checkout — Stripe checkout
├── POST /api/billing/portal — Stripe customer portal
├── POST /api/webhooks/stripe — Stripe webhook
└── /api/admin/* — Admin endpoints

DynamoDB (single-table design)
├── USER#{userId} | PROFILE — User + plan + Stripe IDs
├── USER#{userId} | ITEM#{itemId} — Your entity
└── CONFIG | GLOBAL — Feature flags, plan limits

Scheduled Lambda (EventBridge, daily 8 AM UTC)
└── lambdas/daily-job/handler.py — Add your scheduled logic here
```

## Customization Guide

### Replace "items" with your entity

The template uses a generic "Item" entity (name + status). To replace it with your domain entity (e.g., "Link", "Post", "Order"):

1. **Backend:** Rename `api/routes/items.py` and update DynamoDB key prefix from `ITEM#` to your entity
2. **Frontend:** Replace `ItemsPage`, `ItemsTable`, `AddItemForm` with your components
3. **Types:** Update `frontend/src/types.ts`
4. **API client:** Update `frontend/src/api.ts`
5. **DB helpers:** Update `api/lib/db.py` (get_items, create_item, etc.)
6. **Tests:** Update `tests/test_api_items.py`

### Add new Lambda workers

Copy the `daily-job` pattern:
```bash
mkdir lambdas/my-worker
cp lambdas/daily-job/handler.py lambdas/my-worker/handler.py
```

Then add to `cdk/lib/yourapp-stack.ts`:
```typescript
const myWorkerFn = new lambda.Function(this, 'MyWorkerFunction', {
  functionName: 'yourapp-my-worker',
  // ... same as daily-job
});
new events.Rule(this, 'MyWorkerRule', {
  schedule: events.Schedule.cron({ minute: '0', hour: '10' }),
  targets: [new eventsTargets.LambdaFunction(myWorkerFn)],
});
```

### Modify plan tiers

Edit `api/lib/db.py`:
```python
ITEM_LIMITS = {
  "free": 10,
  "starter": 100,
  "pro": float("inf"),
}
```

And update pricing in `frontend/src/pages/LandingPage.tsx` and the Stripe price IDs in `.env`.

## Running Tests

```bash
cd root-of-repo
python -m pytest tests/ -v
```

All AWS services are mocked via [moto](https://github.com/getmoto/moto). No real AWS calls during tests.

## Cost Estimate

At low traffic (~0-100 users):
- DynamoDB: ~$0 (25 RCU/WCU free tier)
- Lambda: ~$0 (1M free requests/month)
- CloudFront: ~$0 (1TB free transfer/month)
- SES: ~$0 (62,000 emails/month free)
- Cognito: ~$0 (50,000 MAU free)
- Route53: ~$0.50/month (hosted zone)
- ACM: $0 (certificates are free)
- **Total: ~$0.50/month at low traffic**

At scale (1,000 users):
- Estimated: $15-30/month

## License

MIT
```

**Step 2: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add README.md
git commit -m "docs: write comprehensive README for template users"
git push
```

---

## Task 14: Write CLAUDE.md

**Files:**
- Overwrite: `CLAUDE.md`

**Step 1: Replace the current CLAUDE.md (which has YourApp-specific content)**

Create `CLAUDE.md`:

````markdown
# CLAUDE.md — web-aws-framework-template

## What This Is

A reusable AWS SaaS starter built from a working production app. Clone via GitHub template, run `./scripts/init.sh`, and you have a fully deployable SaaS with auth, billing, admin, email, and AI.

## Placeholder Values

All project-specific values use these placeholders (replaced by `init.sh`):

| Placeholder | Replaced with |
|-------------|--------------|
| `yourapp` | Project name (lowercase) |
| `YourApp` | Display name (title case) |
| `yourapp.com` | Your domain |
| `manager.yourapp.com` | Admin subdomain |
| `YOUR_AWS_ACCOUNT_ID` | AWS account ID |

If you need to find all placeholder occurrences:
```bash
grep -r "yourapp" --include="*.ts" --include="*.py" --include="*.json" .
```

## Architecture Decisions (Don't Change These Lightly)

**Lambda Function URLs instead of API Gateway:** Avoids $3.50/million request overhead. CORS is handled manually in `api/handler.py`. Both Lambda Function URL and API Gateway v1 formats are supported for local testing.

**DynamoDB single-table design:** Everything in one table with `pk`/`sk` composite keys. Prefixes: `USER#`, `ITEM#`, `CONFIG`. Add GSIs when you need to query by non-key attributes.

**Cognito ID token (not Access token):** The frontend sends the ID token as `Bearer`. It contains `sub` (user ID), `email`, `name` — useful for user context without extra DB calls.

**Dual-app single bundle:** User app + admin app in one React build, split by hostname (`manager.*` → admin). Admin pages are lazy-loaded.

**Admin auth is separate from Cognito:** Admin JWT lives in Secrets Manager (HS256), not in Cognito. This keeps admin access independent of user accounts.

## Where to Add New Entities

When replacing "items" with your domain entity (e.g., "links"):

1. **`api/lib/db.py`** — Add `get_links()`, `create_link()`, `update_link()`, `delete_link()` using `LINK#` prefix. Add `LINK_LIMITS` dict.
2. **`api/routes/links.py`** — Copy `api/routes/items.py`, rename functions, add domain logic.
3. **`api/handler.py`** — Add routing: `from routes import links` and add routes in `_route()`.
4. **`frontend/src/types.ts`** — Add `Link` interface.
5. **`frontend/src/api.ts`** — Add `fetchLinks()`, `createLink()`, etc.
6. **`frontend/src/pages/dashboard/LinksPage.tsx`** — Create page component.
7. **`frontend/src/components/LinksTable.tsx`** — Create table component.
8. **`frontend/src/App.tsx`** — Add route: `<Route path="links" element={<LinksPage />} />`.
9. **`tests/test_api_links.py`** — Write tests first (TDD).

## How to Add New Lambda Workers

1. Create `lambdas/my-worker/handler.py` (copy from `lambdas/daily-job/`).
2. Add `lambdas/my-worker/requirements.txt`.
3. In `cdk/lib/yourapp-stack.ts`, add a `lambda.Function` and an `events.Rule`.
4. Deploy: `./scripts/deploy-lambdas.sh my-worker`.

## Stripe Plan Tiers

Plans live in two places:
- **`api/lib/db.py`** — `ITEM_LIMITS` dict controls per-plan entity limits.
- **`CONFIG | STRIPE`** DynamoDB record — holds Stripe price IDs (set via admin panel or directly in DynamoDB after first deploy).

The admin panel (`/config/plans`) lets you update plan limits without redeploying.

## Deployment

```bash
# Full deploy (CDK infra + frontend)
./scripts/deploy.sh

# Frontend only (fast, after infra exists)
./scripts/deploy-frontend.sh

# Lambda code only (fast, no CDK)
./scripts/deploy-lambdas.sh

# Admin credentials (first time only)
./scripts/setup-admin.sh
```

## Testing

```bash
# Run all tests
python -m pytest tests/ -v

# Run specific test file
python -m pytest tests/test_api_items.py -v

# Run specific test
python -m pytest tests/test_api_items.py::TestCreateItem::test_create_item -v
```

All AWS services are mocked via moto. No real AWS calls. Fixtures are in `tests/conftest.py`.

## Key File Map

| File | Purpose |
|------|---------|
| `cdk/lib/yourapp-stack.ts` | All AWS infrastructure |
| `api/handler.py` | Lambda entry point + routing |
| `api/lib/db.py` | DynamoDB helpers + entity functions |
| `api/lib/auth.py` | Cognito JWT verification |
| `api/routes/items.py` | CRUD for your main entity |
| `api/routes/billing.py` | Stripe checkout + webhooks |
| `api/routes/admin.py` | Admin endpoints |
| `lambdas/daily-job/handler.py` | Example scheduled worker |
| `frontend/src/App.tsx` | React router (user + admin apps) |
| `frontend/src/auth.ts` | Cognito Amplify integration |
| `frontend/src/api.ts` | API client functions |
| `frontend/src/types.ts` | TypeScript interfaces |
| `tests/conftest.py` | pytest fixtures + moto setup |
| `scripts/init.sh` | Project initialization script |
| `scripts/deploy.sh` | Full deployment |

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Stripe (required for billing)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
```

Lambda environment variables are set by CDK (from `cdk/lib/yourapp-stack.ts`) — you don't set them manually.
````

**Step 2: Commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add CLAUDE.md
git commit -m "docs: write CLAUDE.md for template users and Claude Code"
git push
```

---

## Task 15: Final cleanup and configure GitHub Template

**Files:**
- Verify: all files clean, no remaining YourApp references
- Configure: GitHub repo as Template Repository

**Step 1: Final grep for leftover YourApp references**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template

# These should all return NO results:
grep -r "yourapp" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.sh" --include="*.json" . 2>/dev/null | grep -v ".git"
grep -r "YourApp" --include="*.ts" --include="*.tsx" --include="*.py" . 2>/dev/null | grep -v ".git"
grep -r "yourapp\.co" . --include="*.ts" --include="*.md" 2>/dev/null | grep -v ".git"
grep -r "YOUR_AWS_ACCOUNT_ID" . --include="*.ts" --include="*.json" 2>/dev/null | grep -v ".git"
```

Fix any remaining occurrences manually before proceeding.

**Step 2: Verify frontend builds clean**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template/frontend
npm ci
npm run build
```

Expected: Build succeeds with no errors.

**Step 3: Run full test suite one more time**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
python -m pytest tests/ -v
```

Expected: All tests pass.

**Step 4: Verify CDK compiles**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template/cdk
npm ci
npx tsc --noEmit
```

Expected: No TypeScript errors.

**Step 5: Final commit**

```bash
cd ~/.openclaw/workspace/web-aws-framework-template
git add -A
git status  # Review what's staged
git commit -m "chore: final cleanup — all templates verified, builds passing"
git push
```

**Step 6: Mark as GitHub Template Repository**

```bash
gh api repos/kevinmarkwardt/web-aws-framework-template \
  -X PATCH \
  -f is_template=true

# Verify
gh repo view kevinmarkwardt/web-aws-framework-template --json isTemplate
```

Expected: `{"isTemplate": true}`

**Step 7: Verify from GitHub UI**

Open: `https://github.com/kevinmarkwardt/web-aws-framework-template`

You should see the green **"Use this template"** button near the top right.

**Step 8: Test the template by spinning up a throwaway project**

```bash
# Create a test project from the template
gh repo create kevinmarkwardt/template-test --template kevinmarkwardt/web-aws-framework-template --private --clone /tmp/template-test

cd /tmp/template-test
./scripts/init.sh
# Enter: testapp / TestApp / testapp.com / 111122223333

# Verify
grep -r "testapp" cdk/bin/ | head -3
ls cdk/bin/   # Should show testapp.ts

# Clean up
cd ~
gh repo delete kevinmarkwardt/template-test --yes
rm -rf /tmp/template-test
```

---

## Done

The `web-aws-framework-template` repo is live at:
`https://github.com/kevinmarkwardt/web-aws-framework-template`

New projects are created with the **"Use this template"** button → clone → `./scripts/init.sh` → `./scripts/deploy.sh`.
