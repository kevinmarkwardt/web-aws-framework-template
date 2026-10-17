"""Optional approximate local prices (config.BILLING["localPrices"]; off by default).

Everything is charged in US dollars; the wallet can show roughly what that is in the visitor's own currency
("≈ NT$320"). Rates come from a free daily feed (open.er-api.com, USD base), kept in CONFIG / FX (refreshed once a day;
after a failed try, not again for RETRY_S, shared by every Lambda) and in memory for an hour. A rate older than
MAX_AGE_S isn't shown. Anything going wrong here shows nothing extra, never an error: the dollar price is the real one,
and the bank does the actual conversion. With country gating on (api/lib/regions.py) only those countries get a hint.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request

try:
    from lib import config, db, regions
except ImportError:
    from api.lib import config, db, regions

log = logging.getLogger("yourapp.fx")

SOURCE = "https://open.er-api.com/v6/latest/USD"
# viewer country -> currency (US and dollar countries show nothing extra); extend as needed
CURRENCY = {"CA": "CAD", "AU": "AUD", "NZ": "NZD", "GB": "GBP", "JP": "JPY", "TW": "TWD", "HK": "HKD", "SG": "SGD",
            "KR": "KRW", "IN": "INR", "MX": "MXN", "BR": "BRL", "CH": "CHF", "SE": "SEK", "NO": "NOK", "DK": "DKK",
            "PL": "PLN", "ZA": "ZAR", "DE": "EUR", "FR": "EUR", "ES": "EUR", "IT": "EUR", "NL": "EUR", "IE": "EUR",
            "AT": "EUR", "BE": "EUR", "FI": "EUR", "PT": "EUR"}
STALE_S = 24 * 3600
RETRY_S = 6 * 3600
MAX_AGE_S = 7 * 24 * 3600
MEMORY_S = 3600
_mem: dict = {}


def _fetch() -> dict[str, str]:
    with urllib.request.urlopen(SOURCE, timeout=3) as r:  # noqa: S310 - fixed https URL
        data = json.loads(r.read())
    if data.get("result") != "success":
        raise ValueError(f"fx feed: {data.get('result')}")
    out = {}
    for c in set(CURRENCY.values()):
        try:
            v = float(data["rates"][c])
        except (KeyError, TypeError, ValueError):
            continue
        if v > 0:
            out[c] = str(v)
    if not out:
        raise ValueError("fx feed empty")
    return out


def _stored() -> tuple[dict[str, str], float, float]:
    """(rates, at, triedAt) from CONFIG / FX; anything unreadable counts as missing, so the next refresh overwrites it."""
    try:
        item = db._get_table().get_item(Key={"pk": "CONFIG", "sk": "FX"}).get("Item") or {}
    except Exception as e:  # noqa: BLE001
        log.warning("fx: can't read the stored rates: %s", e)
        return {}, 0.0, float("inf")  # can't read, so don't hammer the feed either

    def num(v) -> float:
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0
    got = item.get("rates")
    return (dict(got) if isinstance(got, dict) else {}), num(item.get("at")), num(item.get("triedAt"))


def rates() -> dict[str, str]:
    """{currency: units per US dollar} (strings, as stored), or {} when none is recent enough. Remembered in memory for
    MEMORY_S whatever happened, so a problem costs at most one try per container per hour."""
    now = time.time()
    if _mem.get("at", 0) > now - MEMORY_S:
        return _mem["rates"]
    got, at, tried = _stored()
    try:
        if at < now - STALE_S and tried < now - RETRY_S:
            try:
                got, at = _fetch(), now
            except Exception as e:  # noqa: BLE001 - an older rate (or none) is fine: it's only a hint
                log.warning("fx rates not refreshed: %s", e)
                db._get_table().update_item(Key={"pk": "CONFIG", "sk": "FX"}, UpdateExpression="SET triedAt = :t",
                                            ExpressionAttributeValues={":t": str(int(now))})
            else:
                db._get_table().put_item(Item={"pk": "CONFIG", "sk": "FX", "rates": got, "at": str(int(now)),
                                               "triedAt": str(int(now)), "source": SOURCE})
    except Exception as e:  # noqa: BLE001 - couldn't store them: the rates just fetched still serve this container
        log.warning("fx: can't store the rates: %s", e)
    fresh = got if at >= now - MAX_AGE_S else {}
    _mem.update(rates=fresh, at=now)
    return fresh


def local_for(event: dict | None) -> dict | None:
    """{currency, perUsd} for the visitor's country, or None (off, a dollar country, unknown, no recent rate, an error)."""
    if not config.BILLING.get("localPrices"):
        return None
    try:
        country = regions.viewer_country(event) or ""
        if regions.gating() and country not in regions.countries():
            return None
        currency = CURRENCY.get(country)
        if not currency:
            return None
        rate = rates().get(currency)
        return {"currency": currency, "perUsd": rate} if rate and float(rate) > 0 else None
    except Exception as e:  # noqa: BLE001 - a hint only: never let it break the wallet
        log.warning("fx: %s", e)
        return None
