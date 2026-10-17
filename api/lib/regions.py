"""Optional country gating for payments (config.BILLING["regions"]: ISO country codes; [] = no gating).

Everyone can browse in any country; with a list set, only visitors from those countries, with cards issued in those
countries, can pay (top-ups, saved cards, auto reload, subscriptions). Two pieces of evidence, both checked:
  - the visitor's country: CloudFront's CloudFront-Viewer-Country header (forwarded by the /api/* origin request
    policy), trusted only when the request carries X-Origin-Verify (params.from_cloudfront): the Function URL is public,
    so the header alone could be made up. Unknown country: refused, except on the local API and in tests
    (ALLOW_NO_VIEWER_COUNTRY=1).
  - the card's issuing country (Stripe's card.country), which can't be spoofed; checked before any saved-card charge.
Why gate at all: some places require tax registration from the first sale of digital goods. Stripe Radar can only
block by country on its paid plan, so it is enforced here.
"""

from __future__ import annotations

import os

try:
    from lib import config, params, response
    from lib.i18n import Text
except ImportError:
    from api.lib import config, params, response
    from api.lib.i18n import Text

NOT_HERE = Text("Payments aren't available in your country yet.")
CARD_NOT_ACCEPTED = Text("Cards issued in that country can't be used here yet. Use a card from a supported country.")


def countries() -> list[str]:
    return [c.upper() for c in config.BILLING.get("regions") or []]


def gating() -> bool:
    return bool(countries())


def viewer_country(event: dict | None) -> str | None:
    """The visitor's country per CloudFront, or None when it can't be trusted (didn't come through CloudFront) or is absent."""
    if not params.from_cloudfront(event):
        return None
    return params.header(event, "cloudfront-viewer-country").upper() or None


def can_pay_here(event: dict | None) -> bool:
    if not gating():
        return True
    c = viewer_country(event)
    if c is None:
        return os.environ.get("ALLOW_NO_VIEWER_COUNTRY") == "1"
    return c in countries()


def refusal(event: dict | None) -> dict | None:
    """The 403 for a visitor outside the payment countries, or None. Every route that takes money, saves a card, turns
    on auto reload or starts a subscription calls this."""
    return None if can_pay_here(event) else response.error(NOT_HERE, 403, "REGION")


def card_accepted(country: str | None) -> bool:
    """A card may pay when gating is off, or its issuing country is on the list (no country reported: refused)."""
    return not gating() or (country or "").upper() in countries()
