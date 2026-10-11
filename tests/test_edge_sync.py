"""The /api/* cache policy's query-string allowlist (cdk/lib/yourapp-stack.ts API_CACHE_QUERY_KEYS) names every query
parameter the API reads (params.query / query_int / day in api/). A parameter missing from the key would let CloudFront
serve one query's cached answer for another as soon as a route sends Cache-Control."""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _api_query_names() -> set[str]:
    names = set()
    for path in (ROOT / "api").rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        names |= set(re.findall(r"\bquery(?:_int)?\(event,\s*\"([A-Za-z0-9_]+)\"", src))
        for args in re.findall(r"\bparams\.day\(event(?:,\s*\"([A-Za-z0-9_]+)\")?\)", src):
            names.add(args or "day")
    return names


def _cdk_allowlist() -> set[str]:
    src = (ROOT / "cdk" / "lib" / "yourapp-stack.ts").read_text(encoding="utf-8")
    m = re.search(r"API_CACHE_QUERY_KEYS\s*=\s*\[([^\]]*)\]", src)
    assert m, "API_CACHE_QUERY_KEYS not found in the stack"
    return set(re.findall(r"'([^']+)'", m.group(1)))


def test_every_query_parameter_the_api_reads_is_in_the_cache_key():
    read, keyed = _api_query_names(), _cdk_allowlist()
    assert read, "found no query parameters in api/ (the pattern is stale)"
    assert read <= keyed, f"add to API_CACHE_QUERY_KEYS: {sorted(read - keyed)}"


def test_the_cache_key_has_no_stale_names():
    assert _cdk_allowlist() <= _api_query_names(), "API_CACHE_QUERY_KEYS names a parameter the API no longer reads"
