"""Site config: the CONFIG | GLOBAL record the admin site edits (feature toggles, plan limits, job settings, email
templates), merged over DEFAULT_CONFIG so a fresh install (no record yet) and older records missing newer keys both work.

This is the single source of the plan limits: items.create_item and the billing downgrade checks enforce them, and the
frontend reads them from GET /api/account (and GET /api/public-config for the landing page) instead of hardcoding them.

Read through a short per-container cache (CACHE_TTL); an admin save clears this container's copy at once, other warm
Lambda containers pick it up within CACHE_TTL seconds.
"""

from __future__ import annotations

import copy
import logging
import os
import time
from decimal import Decimal

try:
    from lib import db
    from lib.params import BadRequest
except ImportError:
    from api.lib import db
    from api.lib.params import BadRequest

CONFIG_KEY = "GLOBAL"  # pk=CONFIG, sk=GLOBAL
CACHE_TTL = 30  # seconds

# ---- Billing (code config; the AI site builder fills it from site.spec modules.billing, ai/site.spec.schema.json) ----
# The mode itself comes from the stack (cdk.json context billingMode -> BILLING_MODE): billing_mode() below.

BILLING_MODES = ("none", "subscriptions", "credits", "both")

# Subscription tiers (spec `plans[]`); "free" is implicit and always first. `limits`: limit name -> max (None =
# unlimited); "items" is the template entity's limit, which the admin site can override per plan (planLimits).
# scripts/stripe-setup.py creates one monthly price per paid plan (lookup_key yourapp_plan_{id}).
FREE_PLAN: dict = {"id": "free", "name": "Free", "monthlyUsd": 0, "limits": {"items": 10},
                   "features": ["Daily processing", "Instant alerts", "Weekly digest"]}
PAID_PLANS: list[dict] = [
    {"id": "starter", "name": "Starter", "monthlyUsd": 9, "limits": {"items": 100},
     "features": ["Daily processing", "Advanced features"]},
    {"id": "pro", "name": "Pro", "monthlyUsd": 19, "limits": {"items": None},
     "features": ["Hourly processing", "AI scoring", "Monthly reports"]},
]

# Credits wallet (spec creditName, packs, creditCosts, signupGift, regions; the rest are template knobs). 100 units = $1:
# one paid unit is one cent paid. docs/payments.md has the rules.
BILLING: dict = {
    "creditName": "credits",
    "packs": [{"usd": 5, "bonusPct": 0}, {"usd": 10, "bonusPct": 0}, {"usd": 20, "bonusPct": 10}, {"usd": 50, "bonusPct": 20}],
    "custom": {"minUsd": 5, "maxUsd": 500},     # any whole-dollar amount in this range, no bonus; None: packs only
    "creditCosts": {"example_action": 10},      # action -> units, for credits.spend(user, action, ...)
    "signupGift": 0,                            # bonus units for a new account (0: off)
    "dailyBonus": 0,                            # bonus units once a day for accounts with a paid top-up (0: off)
    "referral": {"referrer": 0, "referred": 0},  # bonus units, on hold until the friend's first top-up clears (0: off)
    "regions": [],                              # ISO countries allowed to pay; [] = no gating (api/lib/regions.py)
    "localPrices": False,                       # approximate local-currency hints on the wallet (api/lib/fx.py)
    "refundDays": 14,                           # paid units go back to the card up to this long after their top-up
    "refundHoldMinutes": 60,                    # and only after this long (the payment clears first)
    "autoReload": {"maxPerDay": 3, "defaultBelow": 200},
    "graceDays": 7,                             # subscriptions: a failed renewal keeps the plan this long
}

# Trust and safety (api/lib/accounts.py): warnings expire, the Nth active one bans read-only for banDays.
ACCOUNT_RULES: dict = {"warningDays": 90, "warningsToBan": 3, "banDays": 365}

# Support requests (api/routes/support.py; spec modules.support). Topic id -> label, in the order the form shows them.
# Each request and follow-up emails ADMIN_EMAIL; the limits keep that (and the 400 KB DynamoDB item) in check.
SUPPORT: dict = {
    "topics": {"billing": "Billing or payments", "account": "My account", "bug": "Something isn't working",
               "other": "Something else"},
    "maxOpen": 3,            # open requests per customer
    "followUpsPerDay": 10,   # a customer's follow-ups on one request per UTC day
}

PLANS = ("free", *(p["id"] for p in PAID_PLANS))
# Max items per plan; None = unlimited.
DEFAULT_PLAN_LIMITS: dict[str, int | None] = {p["id"]: p["limits"].get("items") for p in (FREE_PLAN, *PAID_PLANS)}

TOGGLES = ("maintenanceMode", "signupsEnabled", "jobsEnabled", "alertsEnabled")

DEFAULT_CONFIG: dict = {
    "maintenanceMode": False,   # user API routes answer 503 (admin routes and Stripe webhooks keep working)
    "signupsEnabled": True,     # False: GET /api/account refuses to create profiles for new accounts
    "jobsEnabled": True,        # read by lambdas/daily-job: False skips the scheduled run
    "alertsEnabled": True,      # for your alert emails (the template sends none yet)
    "planLimits": DEFAULT_PLAN_LIMITS,
    "jobSettings": {
        "dailyJobHourUtc": 8,       # informational: the schedule itself is the EventBridge rule in the CDK stack
        "hourlyJobEnabled": False,
        "rateLimitDelayMs": 1000,
    },
    "emailTemplates": {
        "welcomeSubject": "Welcome to YourApp",
        "digestSubject": "Your YourApp weekly digest",
        "alertSubject": "YourApp: an item changed status",
    },
}

_cache: tuple[dict, float] | None = None


def _plain(value):
    """DynamoDB numbers come back as Decimal: whole ones become int (JSON and comparisons stay simple); others stay
    Decimal, which DynamoDB accepts on the way back (a float it would refuse)."""
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else value
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def _limit(value, default):
    """A stored plan limit: a whole number >= 0, or None (unlimited). Anything else falls back to the default."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value != int(value):
        return default
    return int(value)


def _merge(stored: dict) -> dict:
    merged = copy.deepcopy(DEFAULT_CONFIG)
    for key in TOGGLES:
        if isinstance(stored.get(key), bool):
            merged[key] = stored[key]
    limits = stored.get("planLimits") if isinstance(stored.get("planLimits"), dict) else {}
    for plan in PLANS:
        if plan in limits:
            merged["planLimits"][plan] = _limit(limits[plan], DEFAULT_PLAN_LIMITS[plan])
    for section in ("jobSettings", "emailTemplates"):
        if isinstance(stored.get(section), dict):
            merged[section].update(stored[section])
    return merged


def get_site_config(fresh: bool = False) -> dict:
    """The effective config (defaults + the stored record). `fresh` skips the cache (the admin site's reads)."""
    global _cache
    if not fresh and _cache and time.time() - _cache[1] < CACHE_TTL:
        return copy.deepcopy(_cache[0])
    merged = _merge(_plain(db.get_config(CONFIG_KEY) or {}))
    _cache = (merged, time.time())
    return copy.deepcopy(merged)


def invalidate() -> None:
    global _cache
    _cache = None


def _validate(updates: dict) -> dict:
    """Checks an admin update (only the keys it sends) and returns it cleaned. Unknown keys or bad values -> BadRequest."""
    clean: dict = {}
    for key, value in updates.items():
        if key in TOGGLES:
            if not isinstance(value, bool):
                raise BadRequest(f"{key} must be true or false")
            clean[key] = value
        elif key == "planLimits":
            if not isinstance(value, dict) or set(value) - set(PLANS):
                raise BadRequest(f"planLimits takes {', '.join(PLANS)}")
            for plan, limit in value.items():
                if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or limit < 0):
                    raise BadRequest(f"planLimits.{plan} must be a whole number >= 0, or null for unlimited")
            clean[key] = dict(value)
        elif key == "jobSettings":
            if not isinstance(value, dict) or set(value) - set(DEFAULT_CONFIG["jobSettings"]):
                raise BadRequest(f"jobSettings takes {', '.join(DEFAULT_CONFIG['jobSettings'])}")
            for name, v in value.items():
                want = type(DEFAULT_CONFIG["jobSettings"][name])
                if isinstance(v, bool) != (want is bool) or not isinstance(v, want):
                    raise BadRequest(f"jobSettings.{name} must be {'true or false' if want is bool else 'a whole number'}")
            clean[key] = dict(value)
        elif key == "emailTemplates":
            if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
                raise BadRequest("emailTemplates must map names to text")
            clean[key] = dict(value)
        else:
            raise BadRequest(f"Unknown config key: {key}")
    return clean


def save_site_config(updates: dict) -> dict:
    """Merges an admin update into the stored record (a page that saves one section never wipes the others) and
    returns the new effective config."""
    clean = _validate(updates)
    stored = _plain(db.get_config(CONFIG_KEY) or {})
    for key, value in clean.items():
        if key in ("planLimits", "jobSettings", "emailTemplates") and isinstance(stored.get(key), dict):
            stored[key] = {**stored[key], **value}
        else:
            stored[key] = value
    db.put_config(CONFIG_KEY, stored)
    invalidate()
    return get_site_config(fresh=True)


def plan_limits() -> dict[str, int | None]:
    return get_site_config()["planLimits"]


def plan_limit(plan: str) -> int | None:
    """Max items for `plan` (None = unlimited); an unknown plan gets the free plan's limit."""
    limits = plan_limits()
    return limits.get(plan, limits["free"])


# ---- Billing accessors

def billing_mode() -> str:
    """BILLING_MODE (cdk.json context billingMode, set on the API Lambda): none | subscriptions | credits | both. An
    unknown value turns billing off rather than guessing."""
    mode = os.environ.get("BILLING_MODE", "both").strip().lower()
    if mode not in BILLING_MODES:
        logging.getLogger("yourapp.config").error("BILLING_MODE=%r is not one of %s: billing is off", mode, BILLING_MODES)
        return "none"
    return mode


def subscriptions_on() -> bool:
    return billing_mode() in ("subscriptions", "both")


def credits_on() -> bool:
    return billing_mode() in ("credits", "both")


def billing() -> dict:
    return copy.deepcopy(BILLING)


def pack_id(usd) -> str:
    return "p" + f"{float(usd):g}".replace(".", "_")


def packs() -> list[dict]:
    """The credit packs: id, what the card pays (payCents) and the units it buys (paid part = payCents, plus bonus)."""
    out = []
    for p in BILLING["packs"]:
        pay = int(round(float(p["usd"]) * 100))
        bonus = int(pay * float(p.get("bonusPct", 0)) // 100)
        out.append({"id": pack_id(p["usd"]), "usd": p["usd"], "payCents": pay, "bonus": bonus, "credits": pay + bonus,
                    "bonusPct": p.get("bonusPct", 0)})
    return out


def pack(pid: str) -> dict | None:
    return next((p for p in packs() if p["id"] == pid), None)


def credit_cost(action: str) -> int | None:
    cost = BILLING["creditCosts"].get(action)
    return None if cost is None else int(cost)


def plans() -> list[dict]:
    """Every plan, free first, with the effective item limit (admin planLimits override) in limits.items."""
    limits = plan_limits()
    return [{**copy.deepcopy(p), "limits": {**p.get("limits", {}), "items": limits.get(p["id"])}}
            for p in (FREE_PLAN, *PAID_PLANS)]


def plan_rank(plan: str) -> int:
    """free = 0, then PAID_PLANS in order; an unknown plan ranks as free."""
    return PLANS.index(plan) if plan in PLANS else 0
