"""__Entities__: the real API of the __Entity__ contract (packages/shared/src/contracts/__entity__.ts), the same answers
the browser mocks gave. The work is api/lib/entities.py; this file holds what is particular to __plural__. Business
rules (plan limits, credits.spend, extra checks) go here: wrap or replace entities.route for your cases."""

from __future__ import annotations

try:
    from lib import entities, params
except ImportError:
    from api.lib import entities, params

ENTITY = entities.Entity(
    name="__Entity__",
    plural="__plural__",
    kind="__KIND__",
    owner="__owner__",
    public=__public__,
    title_field="__titleField__",
    default_sort="__defaultSort__",
    page_size=__pageSize__,
    fields=[
__fields__
    ],
)


def filters(event: dict) -> dict[str, str]:
    """The list's filter parameters. Each one is in the CloudFront cache key too (cdk API_CACHE_QUERY_KEYS;
    tests/test_edge_sync.py checks)."""
    _ = params  # (an entity without filters reads none)
    return {
__filters__
    }
