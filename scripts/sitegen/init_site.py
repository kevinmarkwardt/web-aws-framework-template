"""scripts/init.py: apply site.spec.yaml to the template. Every step is idempotent (a second run changes nothing)."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from . import ROOT, design
from . import entities as front
from .files import Writer, rel
from .spec import entities

PLACEHOLDER_EXT = {".ts", ".tsx", ".py", ".sh", ".json", ".md", ".txt", ".css", ".html", ".in", ".yaml", ".yml", ".mjs",
                   ".example"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "cdk.out", "__pycache__", ".worktrees", ".pytest_cache"}
# the tooling that looks for the placeholders keeps them
KEEP_PLACEHOLDERS = {"scripts/init.py", "scripts/init.sh", "tests/test_init.py", "scripts/template-selftest.sh",
                     ".github/workflows/template-ci.yml"}
KEEP_DIRS = ("scripts/sitegen/",)

LANGUAGE_NAMES = {
    "en": "English", "es": "Español", "fr": "Français", "de": "Deutsch", "it": "Italiano", "pt": "Português",
    "pt-BR": "Português (Brasil)", "nl": "Nederlands", "sv": "Svenska", "da": "Dansk", "nb": "Norsk bokmål",
    "fi": "Suomi", "pl": "Polski", "cs": "Čeština", "tr": "Türkçe", "ru": "Русский", "uk": "Українська",
    "ja": "日本語", "ko": "한국어", "zh": "中文", "zh-TW": "中文（台灣）", "ar": "العربية", "he": "עברית", "hi": "हिन्दी",
    "id": "Bahasa Indonesia", "vi": "Tiếng Việt", "th": "ไทย", "el": "Ελληνικά", "ro": "Română", "hu": "Magyar",
}

SITE_JSON = ROOT / "api" / "site.json"
SITE_TS = ROOT / "packages" / "shared" / "src" / "site.generated.ts"
LANGUAGES_TS = ROOT / "packages" / "shared" / "src" / "i18n" / "languages.ts"
LOCALES = ROOT / "packages" / "shared" / "src" / "locales"
API_LOCALES = ROOT / "api" / "locales"
CDK_JSON = ROOT / "cdk" / "cdk.json"
ENV_PRODUCTION = ROOT / "frontend" / ".env.production"

ITEMS_FILES = ["frontend/src/pages/dashboard/ItemsPage.tsx", "frontend/src/components/ItemsTable.tsx",
               "frontend/src/components/AddItemForm.tsx", "frontend/src/components/StatusBadge.tsx",
               "frontend/src/components/UpgradeBanner.tsx", "admin/src/tabs/ItemsTab.tsx"]
ITEMS_MARKED = ["frontend/src/App.tsx", "frontend/src/pages/dashboard/DashboardLayout.tsx", "admin/src/tabs/app.ts"]


class InitError(Exception):
    pass


# ---- identity: the placeholders

def _files():
    for path in ROOT.rglob("*"):
        parts = path.relative_to(ROOT).parts
        if any(p in SKIP_DIRS or p.startswith(".venv") for p in parts[:-1]):
            continue
        if not path.is_file() or (path.suffix not in PLACEHOLDER_EXT and not path.name.endswith(".example")):
            continue
        r = path.relative_to(ROOT).as_posix()
        if r in KEEP_PLACEHOLDERS or r.startswith(KEEP_DIRS):
            continue
        yield path


def replacements(spec: dict) -> list[tuple[str, str]]:
    site = spec["site"]
    out = []
    if site.get("awsAccountId"):
        out.append(("YOUR_AWS_ACCOUNT_ID", site["awsAccountId"]))
    out += [("yourapp.com", site["domain"]), ("YourApp", site["displayName"]), ("yourapp", site["name"])]
    return out


def apply_identity(w: Writer, spec: dict) -> None:
    site = spec["site"]
    if re.search(r"['\"`\\]", site["displayName"]):
        raise InitError("site.displayName can't contain quotes or backslashes (it goes into code strings)")
    previous = _previous_site()
    if previous and previous.get("name") and previous["name"] != site["name"]:
        raise InitError(f"site.name was {previous['name']!r} when init.py last ran; renaming an initialized site is "
                        "manual (search for the old name), or put the old name back in the spec")
    subs = replacements(spec)
    for path in _files():
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        new = text
        for old, value in subs:
            new = new.replace(old, value)
        if new != text:
            w.plain(path, new)
    name = site["name"]
    for old, new in (("cdk/bin/yourapp.ts", f"cdk/bin/{name}.ts"), ("cdk/lib/yourapp-stack.ts", f"cdk/lib/{name}-stack.ts")):
        src, dst = ROOT / old, ROOT / new
        if src.exists() and src != dst:
            if not w.dry:
                if dst.exists():
                    raise InitError(f"both {old} and {new} exist")
                src.rename(dst)
            w.log.append(("renamed", f"{old} -> {new}"))


def _previous_site() -> dict:
    try:
        return json.loads(SITE_JSON.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


# ---- site config for the API and both sites

def site_json(spec: dict) -> dict:
    site, mods = spec["site"], spec.get("modules") or {}
    billing = mods.get("billing") or {}
    out_billing = {"mode": billing.get("mode", "none")}
    for key in ("plans", "creditName", "packs", "creditCosts", "signupGift", "regions"):
        if key in billing:
            out_billing[key] = billing[key]
    return {"_": "Written by scripts/init.py from site.spec.yaml; read by api/lib/config.py. Don't edit: change the spec.",
            "name": site["name"], "displayName": site["displayName"], "domain": site["domain"],
            "billing": out_billing, "support": bool(mods.get("support", True)),
            "languages": languages_of(spec)}


def languages_of(spec: dict) -> list[str]:
    return list(((spec.get("modules") or {}).get("i18n") or {}).get("languages") or ["en"])


def site_ts(spec: dict) -> str:
    site, mods = spec["site"], spec.get("modules") or {}
    billing = mods.get("billing") or {}
    q = lambda s: json.dumps(s or "", ensure_ascii=False)  # noqa: E731
    return f"""// Written by scripts/init.py from site.spec.yaml (site, modules). Don't edit: change the spec and re-run init.py.
// What both sites may know before the API answers. The API's own copy is api/site.json; what is sold (plans, packs,
// prices) always comes from the API (GET /api/public-config), never from here. Languages: i18n/languages.ts.

export const SITE_CONFIG = {{
  name: {q(site['name'])},
  displayName: {q(site['displayName'])},
  domain: {q(site['domain'])},
  tagline: {q(site.get('tagline'))},
  description: {q(site.get('description'))},
  /** modules.billing.mode: what the mock account (MOCK_AUTH) and design previews assume */
  billingMode: {q(billing.get('mode', 'none'))} as 'none' | 'subscriptions' | 'credits' | 'both',
  creditName: {q(billing.get('creditName', 'credits'))},
  /** modules.support: the Support pages (the API answers 404 when off) */
  support: {'true' if mods.get('support', True) else 'false'},
}};
"""


def apply_config(w: Writer, spec: dict) -> list[str]:
    notes = []
    w.plain(SITE_JSON, json.dumps(site_json(spec), indent=2, ensure_ascii=False) + "\n")
    w.plain(SITE_TS, site_ts(spec))

    # languages: languages.ts, locale folders (copies of English to translate), api/locales/<lang>.json
    langs = languages_of(spec)
    src = LANGUAGES_TS.read_text(encoding="utf-8")
    items = "".join(f"\n  {{ code: '{c}', name: {json.dumps(LANGUAGE_NAMES.get(c, c), ensure_ascii=False).replace(chr(34), chr(39))} }},"
                    for c in langs)
    new = re.sub(r"(export const LANGUAGES: readonly \{ code: string; name: string \}\[\] = \[)(.*?)(\n\];)",
                 lambda m: m.group(1) + items + m.group(3), src, flags=re.S)
    w.plain(LANGUAGES_TS, new)
    for lang in langs[1:]:
        folder = LOCALES / lang
        if not folder.exists():
            for f in sorted((LOCALES / "en").glob("*.json")):
                w.plain(folder / f.name, f.read_text(encoding="utf-8"))
            notes.append(f"{rel(folder)}: English copies to translate (keep keys, {{{{placeholders}}}} and <tags>)")
        api = API_LOCALES / f"{lang}.json"
        if not api.exists():
            w.plain(api, (API_LOCALES / "en.json").read_text(encoding="utf-8"))
            notes.append(f"{rel(api)}: an English copy to translate (keep {{placeholders}})")
    for folder in LOCALES.iterdir():
        if folder.is_dir() and folder.name not in langs:
            notes.append(f"{rel(folder)} exists but {folder.name} is not in modules.i18n.languages: delete it (and "
                         f"api/locales/{folder.name}.json) if the language is gone")

    # cdk.json context
    site, billing = spec["site"], (spec.get("modules") or {}).get("billing") or {}
    tags = (spec.get("modules") or {}).get("googleTags") or {}
    cdk = json.loads(CDK_JSON.read_text(encoding="utf-8"))
    ctx = cdk.setdefault("context", {})
    ctx["billingMode"] = billing.get("mode", "none")
    ctx["adminEmail"] = site.get("adminEmail", ctx.get("adminEmail", ""))
    ctx["region"] = site.get("awsRegion", "us-east-1")
    ctx["googleTags"] = bool(tags.get("ga4Id") or tags.get("adsenseClient"))
    w.plain(CDK_JSON, json.dumps(cdk, indent=2) + "\n")

    # Google tag ids (not secret): frontend/.env.production, read by frontend/site-plugins.ts
    managed = {"VITE_GA4_ID": tags.get("ga4Id"), "VITE_ADSENSE_CLIENT": tags.get("adsenseClient"),
               "VITE_CONSENT_REGIONS": ",".join(tags.get("consentRegions") or [])}
    old = ENV_PRODUCTION.read_text(encoding="utf-8") if ENV_PRODUCTION.exists() else ""
    kept = [line for line in old.splitlines() if line.split("=", 1)[0].strip() not in managed]
    wanted = [f"{k}={v}" for k, v in managed.items() if v]
    if wanted or old:
        head = [] if any(line.startswith("#") for line in kept) else [
            "# Committed build settings for production builds of the user site (frontend/site-plugins.ts).",
            "# The Google tag ids come from site.spec.yaml modules.googleTags (scripts/init.py); not secret."]
        w.plain(ENV_PRODUCTION, "\n".join(head + kept + wanted).strip() + "\n")
    return notes


# ---- the built-in Items example

def items_present() -> bool:
    return (ROOT / ITEMS_FILES[0]).exists()


def _prune(path: Path, drop: list[list[str]]) -> dict | None:
    if not path.exists():
        return None
    tree = json.loads(path.read_text(encoding="utf-8"))
    for keys in drop:
        node = tree
        for k in keys[:-1]:
            node = node.get(k, {}) if isinstance(node, dict) else {}
        if isinstance(node, dict):
            for k in [k for k in node if k == keys[-1] or re.fullmatch(rf"{re.escape(keys[-1])}_(zero|one|two|few|many|other)", k)]:
                del node[k]
    return tree


def remove_items_example(w: Writer) -> None:
    """The template's example entity, once the spec has its own: the user site's Items page and parts, the admin Items
    tab, their nav entries and texts. Kept: the backend example (api/routes/items.py, /api/admin/items, its tests) and
    the plan limit named "items" (api/lib/config.py), the reference for plan limits until your first entity is real."""
    for f in ITEMS_FILES:
        w.remove(ROOT / f)
    for f in ITEMS_MARKED:
        path = ROOT / f
        if path.exists():
            text = path.read_text(encoding="utf-8")
            w.plain(path, "".join(line for line in text.splitlines(keepends=True) if "example:items" not in line))
    for lang in (p for p in LOCALES.iterdir() if p.is_dir()):
        items = lang / "items.json"
        if items.exists():
            tree = json.loads(items.read_text(encoding="utf-8"))
            w.plain(items, json.dumps({"items": {"limit": tree["items"]["limit"]}}, indent=2, ensure_ascii=False) + "\n")
        for name, drop in (("app.json", [["app", "nav", "items"]]),
                           ("admin.json", [["admin", "tabs", "items"], ["admin", "items"]])):
            tree = _prune(lang / name, drop)
            if tree is not None:
                w.plain(lang / name, json.dumps(tree, indent=2, ensure_ascii=False) + "\n")


# ---- the whole run

def run(spec: dict, w: Writer, design_only: bool = False, apply_design: bool = False) -> list[str]:
    notes: list[str] = []
    if apply_design:
        tokens = ((spec.get("design") or {}).get("tokens")) or {}
        if not tokens:
            raise InitError("design.tokens is empty in the spec: nothing to apply")
        return design.apply(w, tokens)
    apply_identity(w, spec)
    notes += apply_config(w, spec)
    if entities(spec) and items_present() and not design_only:
        remove_items_example(w)
        notes.append("removed the Items example's pages and admin tab (the spec has entities); the backend example "
                     "api/routes/items.py stays until your first entity is real")
    front.write_aggregators(w, spec)
    return notes


def copy_tree(dst: Path) -> None:
    """A copy of this repo without dependencies and build output (tests, the self-test)."""
    def ignore(d, names):
        return [n for n in names if n in SKIP_DIRS or n.startswith(".venv") or n in ("cdk-outputs-prod.json", "cdk-outputs-test.json")]
    shutil.copytree(ROOT, dst, ignore=ignore, symlinks=True)
