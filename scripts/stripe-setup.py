#!/usr/bin/env python3
"""Create (or verify) what a stage needs in Stripe, using the key already in Secrets Manager. Prints no secrets.
Dry run by default: it only reads Stripe and Secrets Manager and prints what it would change; --apply changes it.
Run it with the API's Python (.venv/bin/python: the stripe version api/requirements.txt pins).

  .venv/bin/python scripts/stripe-setup.py test [--apply]   sandbox keys, https://test.yourapp.com
  .venv/bin/python scripts/stripe-setup.py prod [--apply]   live keys,    https://yourapp.com
  .venv/bin/python scripts/stripe-setup.py test --recreate-webhook --apply

What it sets up, per billing mode (cdk/cdk.json context billingMode; BILLING_MODE overrides it):
  - subscriptions: a product per paid plan (api/lib/config.PAID_PLANS) with a monthly price, lookup_key
    yourapp_plan_{id}. The API finds prices by lookup key, so re-running is safe; a price change is a new price that
    takes over the lookup key (transfer_lookup_key), and the old one is archived.
  - credits: one "Credits" product with a price per pack (config.packs(), lookup_key yourapp_credits_{packId}), for
    receipts and reporting; on-site charges send the amount themselves.
  - the webhook endpoint https://<site>/api/webhooks/stripe for exactly the events the API handles in this mode
    (api/routes/webhooks.events_for), sending events in the API's SDK version. Stripe reveals a signing secret only when
    an endpoint is created, and an endpoint's version can't be changed, so the endpoint is replaced when no secret is
    stored, the stored one isn't this endpoint's, it sends another version, or with --recreate-webhook: the new
    endpoint is created, its secret written into the stage's secret (webhookSecret + webhookEndpointId) next to
    secretKey, and only then are the old endpoints for the URL deleted.
Refuses a live key for test or a test key for prod.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import boto3
import stripe

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from api.lib import config  # noqa: E402
from api.routes import webhooks  # noqa: E402

REGION = os.environ.get("AWS_REGION", "us-east-1")
APP = "yourapp"
SITES = {"test": "https://test.yourapp.com", "prod": "https://yourapp.com"}
USAGE = "usage: stripe-setup.py test|prod [--apply] [--recreate-webhook]   (without --apply: a dry run)"


def billing_mode() -> str:
    mode = os.environ.get("BILLING_MODE") or json.loads((ROOT / "cdk" / "cdk.json").read_text())["context"].get("billingMode", "both")
    if mode not in config.BILLING_MODES:
        raise SystemExit(f"billingMode {mode!r} is not one of {config.BILLING_MODES}")
    return mode


def version_problem() -> str:
    """The webhook must send events in the version the API's SDK reads (A17): this Python's stripe must be the pinned one."""
    pin = re.search(r"^stripe==(\S+)", (ROOT / "api" / "requirements.txt").read_text(), re.M)
    if not pin or pin.group(1) != stripe.VERSION:
        return (f"this Python has stripe {stripe.VERSION}, the API pins {pin.group(1) if pin else '?'}: run it with "
                ".venv/bin/python so the webhook's API version matches the API's")
    return ""


def _meta(obj) -> dict:
    m = getattr(obj, "metadata", None)
    return m.to_dict() if hasattr(m, "to_dict") else dict(m or {})


class Setup:
    def __init__(self, sc, apply: bool):
        self.sc, self.apply = sc, apply

    def product(self, key: str, name: str, description: str):
        """The active product tagged metadata[app] = key (list, not search: search lags about a minute)."""
        found = [p for p in self.sc.v1.products.list(params={"active": True, "limit": 100}).auto_paging_iter() if _meta(p).get("app") == key]
        found.sort(key=lambda p: p.created)
        if found:
            p = found[0]
            if p.name != name:
                if self.apply:
                    p = self.sc.v1.products.update(p.id, params={"name": name, "description": description})
                print(f"product {key}: {'renamed' if self.apply else 'would rename'} to {name}")
            else:
                print(f"product {key}: ok ({p.id})")
            return p
        p = self.sc.v1.products.create(params={"name": name, "description": description, "metadata": {"app": key}}) if self.apply else None
        print(f"product {key}: {'created ' + p.id if p else 'would create'} ({name})")
        return p

    def price(self, product, lookup: str, amount: int, nickname: str, recurring: bool, metadata: dict) -> None:
        existing = self.sc.v1.prices.list(params={"lookup_keys": [lookup], "active": True, "limit": 1}).data
        cur = existing[0] if existing else None
        same = (cur is not None and product is not None and cur.unit_amount == amount and cur.product == product.id
                and bool(getattr(cur, "recurring", None)) == recurring)
        if same:
            print(f"price {lookup}: ok (${amount / 100:.2f}{'/month' if recurring else ''})")
            return
        params = {"product": product.id if product else "", "currency": "usd", "unit_amount": amount, "lookup_key": lookup,
                  "transfer_lookup_key": True, "nickname": nickname, "metadata": metadata,
                  **({"recurring": {"interval": "month"}} if recurring else {})}
        made = self.sc.v1.prices.create(params=params) if self.apply and product else None
        if made and cur:
            self.sc.v1.prices.update(cur.id, params={"active": False})
        moved = f"; replaces {cur.id}" if cur else ""
        print(f"price {lookup}: {'created ' + made.id if made else 'would create'} (${amount / 100:.2f}){moved}")


def main(stage: str, apply: bool = False, recreate_webhook: bool = False) -> int:
    if stage not in SITES:
        print(USAGE, file=sys.stderr)
        return 2
    problem = version_problem()
    if problem:
        print(problem, file=sys.stderr)
        return 1
    mode = billing_mode()
    print(f"{stage} (billing mode {mode}): {'applying changes' if apply else 'dry run, nothing is changed (add --apply)'}")
    if mode == "none":
        print("billing is off: nothing to set up")
        return 0
    name = f"{APP}/{stage}/stripe"
    sm = boto3.client("secretsmanager", region_name=REGION)
    secret = json.loads(sm.get_secret_value(SecretId=name)["SecretString"])
    key = secret["secretKey"]
    live = key.startswith(("sk_live_", "rk_live_"))
    if (stage == "prod") != live:
        print(f"{name} holds a {'live' if live else 'test'} key; refusing to mix stages", file=sys.stderr)
        return 1
    sc = stripe.StripeClient(key, stripe_version=stripe.api_version)
    s = Setup(sc, apply)

    if mode in ("subscriptions", "both"):
        for plan in config.PAID_PLANS:
            prod = s.product(f"plan_{plan['id']}", plan["name"], f"{plan['name']} plan (monthly)")
            s.price(prod, f"{APP}_plan_{plan['id']}", int(round(plan["monthlyUsd"] * 100)), f"{plan['name']} monthly", True,
                    {"plan": plan["id"]})
    if mode in ("credits", "both"):
        unit = config.BILLING["creditName"]
        prod = s.product("credits", unit.capitalize(), f"{unit.capitalize()} for your account")
        for pack in config.packs():
            s.price(prod, f"{APP}_credits_{pack['id']}", pack["payCents"], f"${pack['payCents'] / 100:g} -> {pack['credits']:,} {unit}",
                    False, {"pack": pack["id"], "credits": str(pack["credits"])})

    events = webhooks.events_for(mode)
    url = f"{SITES[stage]}/api/webhooks/stripe"
    endpoints = [e for e in sc.v1.webhook_endpoints.list(params={"limit": 100}).auto_paging_iter() if e.url == url]
    stored_id = secret.get("webhookEndpointId")
    mine = next((e for e in endpoints if e.id == stored_id), None) if stored_id else (endpoints[0] if len(endpoints) == 1 else None)
    if not secret.get("webhookSecret"):
        why = "no signing secret is stored"
    elif mine is None:
        why = f"none of the {len(endpoints)} endpoints for the URL is the stored secret's" if endpoints else "there is no endpoint"
    elif mine.api_version != stripe.api_version:
        why = f"{mine.id} sends events in {mine.api_version or 'the account default version'}, not {stripe.api_version}"
    elif recreate_webhook:
        why = "--recreate-webhook"
    else:
        why = ""
    if not why:
        missing, extra = sorted(set(events) - set(mine.enabled_events)), sorted(set(mine.enabled_events) - set(events))
        if missing or extra:
            if apply:
                sc.v1.webhook_endpoints.update(mine.id, params={"enabled_events": events})
            print(f"webhook {mine.id}: {'updated' if apply else 'would update'} events: add {missing or 'none'}, drop {extra or 'none'}")
        else:
            print(f"webhook: ok ({mine.id} -> {url}, {stripe.api_version}, {len(events)} events)")
        old = [e for e in endpoints if e.id != mine.id]
    else:
        print(f"webhook: {'replacing' if apply else 'would replace'} the endpoint for {url}: {why}")
        if apply:
            created = sc.v1.webhook_endpoints.create(params={"url": url, "enabled_events": events, "api_version": stripe.api_version,
                                                             "description": f"{APP} {stage} API"})
            secret.update(webhookSecret=created.secret, webhookEndpointId=created.id)
            sm.put_secret_value(SecretId=name, SecretString=json.dumps(secret))
            print(f"webhook: created {created.id} ({len(events)} events); signing secret saved to {name}")
        old = endpoints  # deleted only after the new secret is stored
    for e in old:
        if apply:
            sc.v1.webhook_endpoints.delete(e.id)
        print(f"webhook: {'deleted' if apply else 'would delete'} old endpoint {e.id}")
    if not apply:
        print("dry run: nothing was changed; re-run with --apply to make the changes above")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    flags = set(args[1:])
    if not args or flags - {"--apply", "--recreate-webhook"}:
        print(USAGE, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(args[0], "--apply" in flags, "--recreate-webhook" in flags))
