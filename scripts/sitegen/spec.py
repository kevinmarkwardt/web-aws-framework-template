"""site.spec.yaml: loading, schema + cross-field validation, defaults and entity naming."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import ROOT

SCHEMA_PATH = ROOT / "ai" / "site.spec.schema.json"
DEFAULT_SPEC = ROOT / "site.spec.yaml"
RESERVED_FIELDS = {"id", "createdAt", "updatedAt", "ownerId"}
COLOR_KEYS = {"bg", "surface", "ink", "muted", "line", "accent", "accentInk", "danger", "success"}
COLOR_VALUE = re.compile(r"^(#[0-9a-fA-F]{3,8}|(oklch|rgb|rgba|hsl|hsla)\([^)]*\))$")
LANGUAGE = re.compile(r"^[a-z]{2,3}(-[A-Z]{2})?$")


class SpecError(Exception):
    """The spec can't be used: .problems lists why."""

    def __init__(self, problems: list[str]):
        super().__init__("\n".join(problems))
        self.problems = problems


def load(path: str | Path | None = None) -> dict:
    import yaml

    p = Path(path) if path else DEFAULT_SPEC
    if not p.exists():
        raise SpecError([f"{p}: no such file (copy ai/site.spec.example.yaml to start one)"])
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise SpecError([f"{p}: not valid YAML: {e}"]) from None
    if not isinstance(data, dict):
        raise SpecError([f"{p}: the spec must be a mapping"])
    return data


def _schema_problems(spec: dict) -> list[str]:
    import jsonschema

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    out = []
    for err in sorted(validator.iter_errors(spec), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in err.absolute_path) or "(top)"
        out.append(f"{where}: {err.message}")
    return out


def plural_of(name: str) -> str:
    """Recipe -> recipes, Category -> categories, Box -> boxes, MenuItem -> menu-items."""
    words = re.findall(r"[A-Z][a-z0-9]*|[a-z0-9]+", name)
    last = words[-1].lower()
    if re.search(r"[^aeiou]y$", last):
        last = last[:-1] + "ies"
    elif re.search(r"(s|x|z|ch|sh)$", last):
        last += "es"
    else:
        last += "s"
    return "-".join([w.lower() for w in words[:-1]] + [last])


def _cross_problems(spec: dict) -> list[str]:
    out: list[str] = []
    entities = spec.get("entities") or []
    names = [e.get("name") for e in entities]
    for n in {n for n in names if names.count(n) > 1}:
        out.append(f"entities: {n} is defined twice")
    plurals = [e.get("plural") or plural_of(e.get("name", "X")) for e in entities]
    for p in {p for p in plurals if plurals.count(p) > 1}:
        out.append(f"entities: two entities have the plural {p}")
    for e, p in zip(entities, plurals):
        if not re.fullmatch(r"[a-z][a-z0-9-]*", p or ""):
            out.append(f"entities/{e.get('name')}: plural {p!r} must be lowercase letters, digits and -")
        fnames = [f.get("name") for f in e.get("fields") or []]
        for fn in {f for f in fnames if fnames.count(f) > 1}:
            out.append(f"entities/{e.get('name')}: field {fn} is defined twice")
        if not any(f.get("type") in ("string", "email") for f in e.get("fields") or []):
            out.append(f"entities/{e.get('name')}: needs a string field to name its records (title, name, ...)")
        for f in e.get("fields") or []:
            where = f"entities/{e.get('name')}/fields/{f.get('name')}"
            if f.get("name") in RESERVED_FIELDS:
                out.append(f"{where}: {f.get('name')} is added automatically; pick another name")
            t = f.get("type")
            if t == "ref":
                if not f.get("ref"):
                    out.append(f"{where}: a ref field needs ref: <Entity>")
                elif f["ref"] not in names:
                    out.append(f"{where}: ref {f['ref']} is not an entity in this spec")
            elif f.get("ref"):
                out.append(f"{where}: ref is only for type ref")
            if t == "enum":
                vals = f.get("values") or []
                if not vals:
                    out.append(f"{where}: an enum field needs values")
                elif len(set(vals)) != len(vals):
                    out.append(f"{where}: values repeat")
            elif f.get("values") and t != "tags":
                out.append(f"{where}: values are only for enum (or tags suggestions)")

    paths = [p.get("path") for p in spec.get("pages") or []]
    for p in {p for p in paths if paths.count(p) > 1}:
        out.append(f"pages: {p} is listed twice")
    for page in spec.get("pages") or []:
        where = f"pages/{page.get('path')}"
        ent = page.get("entity")
        if ent and ent not in names:
            out.append(f"{where}: entity {ent} is not in entities")
        if page.get("archetype") in ("browse", "detail", "form") and not ent:
            out.append(f"{where}: a {page.get('archetype')} page needs entity")
        if page.get("archetype") == "detail" and ":id" not in str(page.get("path")):
            out.append(f"{where}: a detail page's path needs :id")

    billing = (spec.get("modules") or {}).get("billing") or {}
    mode = billing.get("mode")
    subs = mode in ("subscriptions", "both")
    credits = mode in ("credits", "both")
    if subs and not billing.get("plans"):
        out.append(f"modules/billing: mode {mode} needs plans")
    if not subs and billing.get("plans"):
        out.append(f"modules/billing: plans are only for mode subscriptions or both (mode is {mode})")
    if credits and not billing.get("packs"):
        out.append(f"modules/billing: mode {mode} needs packs")
    for key in ("packs", "creditCosts", "signupGift", "creditName"):
        if not credits and billing.get(key) not in (None, [], {}, 0):
            out.append(f"modules/billing: {key} is only for mode credits or both (mode is {mode})")
    if mode == "none" and billing.get("regions"):
        out.append("modules/billing: regions gate payments; with mode none there are none")
    plan_ids = [p.get("id") for p in billing.get("plans") or []]
    if "free" in plan_ids:
        out.append("modules/billing/plans: free is implicit; don't list it")
    for pid in {p for p in plan_ids if plan_ids.count(p) > 1}:
        out.append(f"modules/billing/plans: {pid} is listed twice")
    usds = [p.get("usd") for p in billing.get("packs") or []]
    if len(set(usds)) != len(usds):
        out.append("modules/billing/packs: two packs have the same price")

    langs = ((spec.get("modules") or {}).get("i18n") or {}).get("languages") or ["en"]
    if langs[0] != "en":
        out.append("modules/i18n/languages: English (en) comes first: it is the complete fallback")
    for lang in langs:
        if not LANGUAGE.match(str(lang)):
            out.append(f"modules/i18n/languages: {lang!r} is not a language code like es or pt-BR")
    if len(set(langs)) != len(langs):
        out.append("modules/i18n/languages: a language repeats")

    tags = (spec.get("modules") or {}).get("googleTags") or {}
    if tags.get("ga4Id") and not re.fullmatch(r"G-[A-Z0-9]+", tags["ga4Id"]):
        out.append("modules/googleTags/ga4Id: looks like G-XXXXXXX")
    if tags.get("adsenseClient") and not re.fullmatch(r"ca-pub-\d+", tags["adsenseClient"]):
        out.append("modules/googleTags/adsenseClient: looks like ca-pub-1234567890")

    counts = (spec.get("mocks") or {}).get("counts") or {}
    for k in counts:
        if k not in names:
            out.append(f"mocks/counts: {k} is not an entity")

    colors = (((spec.get("design") or {}).get("tokens") or {}).get("colors")) or {}
    for k, v in colors.items():
        if k == "dark":
            if not isinstance(v, dict):
                out.append("design/tokens/colors/dark: a mapping of the same keys")
                continue
            pairs = v.items()
        else:
            pairs = [(k, v)]
        for ck, cv in pairs:
            if ck not in COLOR_KEYS:
                out.append(f"design/tokens/colors: unknown key {ck} (use {', '.join(sorted(COLOR_KEYS))})")
            elif not isinstance(cv, str) or not COLOR_VALUE.match(cv.strip()):
                out.append(f"design/tokens/colors/{ck}: {cv!r} is not a color (#rrggbb or oklch(...))")
    return out


def problems(spec: dict) -> list[str]:
    """Everything wrong with `spec`: schema errors first; the cross-field checks only once the shape is right."""
    found = _schema_problems(spec)
    return found or _cross_problems(spec)


def load_valid(path: str | Path | None = None) -> dict:
    spec = load(path)
    found = problems(spec)
    if found:
        raise SpecError(found)
    return spec


# ---- naming

def _words(name: str) -> list[str]:
    return re.findall(r"[A-Z][a-z0-9]*|[a-z0-9]+", name)


def humanize(name: str) -> str:
    """publishedAt -> Published at, MenuItem -> Menu item."""
    words = [w.lower() for w in _words(name)]
    text = " ".join(words)
    return text[:1].upper() + text[1:]


@dataclass
class Entity:
    spec: dict
    name: str = ""          # Recipe
    plural: str = ""        # recipes / menu-items
    key: str = ""           # recipe (camel singular)
    keys: str = ""          # recipes / menuItems (camel plural)
    Plural: str = ""        # Recipes / MenuItems
    kind: str = ""          # RECIPE / MENU_ITEM (DynamoDB prefix, listPk)
    module: str = ""        # recipes / menu_items (Python)
    owner: str = "site"
    public: bool = True
    admin_tab: bool = True
    fields: list = field(default_factory=list)

    @property
    def site_area(self) -> str:
        return "entity" + self.Plural

    @property
    def admin_area(self) -> str:
        return "adminEntity" + self.Plural

    @property
    def label(self) -> str:
        return humanize(self.name)

    @property
    def labels(self) -> str:
        return humanize(self.Plural)

    @property
    def title_field(self) -> str:
        fs = self.fields
        for pick in (lambda f: f["type"] == "string" and f.get("required"), lambda f: f["type"] == "string",
                     lambda f: f["type"] == "email"):
            hit = next((f for f in fs if pick(f)), None)
            if hit:
                return hit["name"]
        return fs[0]["name"]

    @property
    def image_field(self) -> str | None:
        return next((f["name"] for f in self.fields if f["type"] == "image"), None)

    @property
    def path(self) -> str:
        return f"/api/{self.plural}"

    @property
    def admin_path(self) -> str:
        return f"/api/admin/{self.plural}"

    @property
    def user_writes(self) -> bool:
        return self.owner in ("user", "both")


def entity(spec_entity: dict) -> Entity:
    name = spec_entity["name"]
    plural = spec_entity.get("plural") or plural_of(name)
    parts = re.split(r"[-_]", plural)
    keys = parts[0] + "".join(p.title() for p in parts[1:])
    words = _words(name)
    return Entity(
        spec=spec_entity, name=name, plural=plural, key=name[:1].lower() + name[1:], keys=keys,
        Plural="".join(p[:1].upper() + p[1:] for p in parts), kind="_".join(w.upper() for w in words),
        module=plural.replace("-", "_"), owner=spec_entity.get("owner", "site"), public=spec_entity.get("public", True),
        admin_tab=spec_entity.get("adminTab", True), fields=list(spec_entity["fields"]),
    )


def entities(spec: dict) -> list[Entity]:
    return [entity(e) for e in spec.get("entities") or []]


def find_entity(spec: dict, wanted: str) -> Entity:
    for e in entities(spec):
        if wanted in (e.name, e.plural, e.key, e.keys):
            return e
    raise SpecError([f"no entity {wanted!r} in the spec (entities: {', '.join(e.name for e in entities(spec)) or 'none'})"])


def summary(spec: dict) -> str:
    site = spec["site"]
    mods = spec.get("modules") or {}
    billing = mods.get("billing") or {}
    lines = [f"{site['displayName']} ({site['name']}) at {site['domain']}"]
    if site.get("tagline"):
        lines.append(f"  {site['tagline']}")
    if site.get("audience"):
        lines.append(f"  for: {site['audience']}")
    money = billing.get("mode", "none")
    if billing.get("plans"):
        money += ": plans " + ", ".join(f"{p['name']} ${p['monthlyUsd']}/mo" for p in billing["plans"])
    if billing.get("packs"):
        money += f"; {billing.get('creditName', 'credits')} packs " + ", ".join(
            f"${p['usd']}" + (f" (+{p['bonusPct']}%)" if p.get("bonusPct") else "") for p in billing["packs"])
    if billing.get("signupGift"):
        money += f"; sign-up gift {billing['signupGift']}"
    lines.append(f"billing: {money}")
    langs = (mods.get("i18n") or {}).get("languages") or ["en"]
    lines.append(f"languages: {', '.join(langs)}; support: {'on' if mods.get('support', True) else 'off'}; "
                 f"google tags: {', '.join(k for k, v in (mods.get('googleTags') or {}).items() if v) or 'none'}")
    counts = (spec.get("mocks") or {}).get("counts") or {}
    lines.append(f"entities ({len(spec.get('entities') or [])}):")
    for e in entities(spec):
        refs = [f"{f['name']}->{f['ref']}" for f in e.fields if f["type"] == "ref"]
        lines.append(f"  {e.name} (/{e.plural}, owner {e.owner}, {'public' if e.public else 'signed-in'}"
                     f"{', ' + str(counts[e.name]) + ' mock records' if e.name in counts else ''}): "
                     f"{', '.join(f['name'] + ':' + f['type'] for f in e.fields)}"
                     + (f"; refs {', '.join(refs)}" if refs else ""))
    lines.append(f"pages ({len(spec.get('pages') or [])}):")
    for p in spec.get("pages") or []:
        lines.append(f"  {p['path']:<24} {p['archetype']:<9} {p.get('entity', '')}{' (signed in)' if p.get('auth') == 'user' else ''}")
    for j in spec.get("journeys") or []:
        lines.append(f"journey {j['name']} ({j.get('actor', 'user')}): {' -> '.join(j['steps'])}")
    tokens = (spec.get("design") or {}).get("tokens") or {}
    if tokens:
        lines.append(f"design: {', '.join(f'{k}={v}' for k, v in tokens.items() if not isinstance(v, dict))}"
                     f"{'; colors ' + str(len(tokens.get('colors') or {})) if tokens.get('colors') else ''}"
                     f"{'; fonts ' + ', '.join((tokens.get('fonts') or {}).values()) if tokens.get('fonts') else ''}")
    mocks = spec.get("mocks") or {}
    if mocks.get("edgeCases"):
        lines.append(f"mock edge cases: {'; '.join(mocks['edgeCases'])}")
    return "\n".join(lines)
