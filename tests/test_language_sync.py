"""The site's languages are the same everywhere: the sites (packages/shared/src/i18n/languages.ts and the locale folders
in packages/shared/src/locales) and the API (api/locales/*.json, api/lib/i18n.LANGUAGES)."""

import json
import re
from pathlib import Path

from api.lib import i18n

ROOT = Path(__file__).resolve().parents[1]


def test_every_codebase_has_the_same_languages():
    site = re.findall(r"\{\s*code:\s*'([\w-]+)'", (ROOT / "packages/shared/src/i18n/languages.ts").read_text())
    assert site and site[0] == "en" == i18n.DEFAULT == i18n.LANGUAGES[0]
    assert set(site) == set(i18n.LANGUAGES)
    assert {p.name for p in (ROOT / "packages/shared/src/locales").iterdir() if p.is_dir()} == set(site)
    assert {p.stem for p in (ROOT / "api/locales").glob("*.json")} == set(site)


def test_every_site_language_has_the_same_files_and_keys():
    """scripts/i18n-check.mjs checks every key and placeholder; this checks the files line up."""
    locales = ROOT / "packages/shared/src/locales"
    en = sorted(p.name for p in (locales / "en").glob("*.json"))
    assert "common.json" in en and "legal.json" in en
    for lang in (p for p in locales.iterdir() if p.is_dir()):
        assert sorted(p.name for p in lang.glob("*.json")) == en, lang.name
        for f in lang.glob("*.json"):
            tree = json.loads(f.read_text(encoding="utf-8"))
            area = re.sub(r"-(\w)", lambda m: m[1].upper(), f.stem)  # admin-users.json -> "adminUsers"
            assert list(tree) == [area], f"{f}: shape it {{ \"{area}\": {{ ... }} }}"
