"""scripts/new-entity.py's front end generation: an entity's contract, fixture file, mock flag, pages, admin tab and
texts, plus the aggregator files that list every generated entity (contracts/all.gen.ts, the user site's
routes.gen.ts / paths.gen.ts, the admin site's tabs/entities.gen.ts).

The pages come from scripts/templates/entity/*.tsx: edit those templates (or swap them for the page archetypes) to
change what every new entity gets; edit a generated page to change one entity."""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import ROOT
from .files import Writer, render
from .spec import Entity, entities, humanize

SHARED = ROOT / "packages" / "shared" / "src"
CONTRACTS = SHARED / "contracts"
FIXTURES = SHARED / "mocks" / "fixtures"
MOCKS_CONFIG = SHARED / "mocks" / "mocks.config.ts"
LOCALES = SHARED / "locales"
FRONT = ROOT / "frontend" / "src"
FRONT_ENTITIES = FRONT / "entities"
ADMIN_TABS = ROOT / "admin" / "src" / "tabs"
TEMPLATES = ROOT / "scripts" / "templates" / "entity"
STATIC_CONTRACT_FILES = {"types.ts", "validate.ts", "query.ts", "index.ts", "all.gen.ts"}
ITEMS_PAGE = FRONT / "pages" / "dashboard" / "ItemsPage.tsx"
SAFE_VALUE = re.compile(r"^[A-Za-z0-9 _-]+$")

TS_TYPES = {"int": "number", "number": "number", "money": "number", "bool": "boolean", "tags": "string[]"}


# ---- naming helpers

def contract_name(e: Entity) -> str:
    return f"{e.key}Contract"


def page_dir(e: Entity) -> Path:
    return FRONT_ENTITIES / e.plural


def page_files(e: Entity) -> dict[str, Path]:
    d = page_dir(e)
    out = {"api": d / "api.ts", "list": d / f"{e.Plural}ListPage.tsx", "detail": d / f"{e.name}DetailPage.tsx"}
    if e.user_writes:
        out["form"] = d / f"{e.name}FormPage.tsx"
    return out


def admin_tab_file(e: Entity) -> Path:
    return ADMIN_TABS / "entities" / f"{e.Plural}Tab.tsx"


def languages() -> list[str]:
    langs = sorted(p.name for p in LOCALES.iterdir() if p.is_dir())
    return ["en", *[lang for lang in langs if lang != "en"]]


def generated(e: Entity) -> bool:
    """Has new-entity.py run for this entity (its contract file exists)?"""
    return (CONTRACTS / f"{e.key}.ts").exists()


# ---- the contract

def _ts_type(f: dict) -> str:
    if f["type"] == "enum":
        return " | ".join(json.dumps(v) for v in f.get("values") or []) or "string"
    return TS_TYPES.get(f["type"], "string")


def endpoints(e: Entity) -> list[dict]:
    read = "public" if e.public else ("owner" if e.owner == "user" else "user")
    out = [{"op": "list", "method": "GET", "path": e.path, "access": read},
           {"op": "get", "method": "GET", "path": f"{e.path}/:id", "access": read}]
    if e.user_writes:
        out += [{"op": "create", "method": "POST", "path": e.path, "access": "user"},
                {"op": "update", "method": "PUT", "path": f"{e.path}/:id", "access": "owner"},
                {"op": "delete", "method": "DELETE", "path": f"{e.path}/:id", "access": "owner"}]
    out += [{"op": "list", "method": "GET", "path": e.admin_path, "access": "admin"},
            {"op": "get", "method": "GET", "path": f"{e.admin_path}/:id", "access": "admin"},
            {"op": "create", "method": "POST", "path": e.admin_path, "access": "admin"},
            {"op": "update", "method": "PUT", "path": f"{e.admin_path}/:id", "access": "admin"},
            {"op": "delete", "method": "DELETE", "path": f"{e.admin_path}/:id", "access": "admin"}]
    return out


def contract_dict(e: Entity) -> dict:
    fields = []
    for f in e.fields:
        meta = {"name": f["name"], "type": f["type"]}
        for k in ("required", "values", "ref", "hint"):
            if f.get(k) not in (None, False, []):
                meta[k] = f[k]
        fields.append(meta)
    out = {"name": e.name, "plural": e.plural, "owner": e.owner, "public": e.public, "titleField": e.title_field}
    if e.image_field:
        out["imageField"] = e.image_field
    sortable_date = next((f["name"] for f in e.fields if f["type"] in ("datetime", "date")), None)
    out.update({"fields": fields, "path": e.path, "adminPath": e.admin_path, "endpoints": endpoints(e),
                "defaultSort": f"-{sortable_date}" if sortable_date else "-createdAt", "pageSize": 24})
    return out


def contract_ts(e: Entity) -> str:
    lines = [f"// {e.name}: the contract the browser mocks, the pages, the admin tab and the backend all implement. It comes",
             f"// from site.spec.yaml: change the spec, then run python3 scripts/new-entity.py {e.name}.",
             "import type { EntityContract } from './types';", "",
             "/** What create takes (update takes any part of it). */", f"export type {e.name}Input = {{"]
    for f in e.fields:
        doc = f" // {f['ref']} id" if f["type"] == "ref" else (" // whole cents" if f["type"] == "money" else "")
        if f.get("required"):
            lines.append(f"  {f['name']}: {_ts_type(f)};{doc}")
        else:
            lines.append(f"  {f['name']}?: {_ts_type(f)} | null;{doc}")
    lines += ["};", "", f"export type {e.name} = {e.name}Input & {{", "  id: string;", "  createdAt: string;", "  updatedAt: string;"]
    if e.user_writes:
        lines += ["  /** the user who created it (null: made by an admin) */", "  ownerId?: string | null;"]
    lines += ["  /** pages also read fields by name, from the contract's field list */", "  [field: string]: unknown;", "};", "",
              f"export const {contract_name(e)}: EntityContract = {json.dumps(contract_dict(e), indent=2)};", ""]
    return "\n".join(lines)


# ---- texts

def _values_tree(e: Entity) -> dict:
    vals = {}
    for f in e.fields:
        if f["type"] == "enum":
            safe = {v: (humanize(v) if v.islower() else v) for v in f.get("values") or [] if SAFE_VALUE.match(v)}
            if safe:
                vals[f["name"]] = safe
    return vals


def site_tree(e: Entity) -> dict:
    one, many = humanize(e.name).lower(), humanize(e.Plural).lower()
    t = {"one": e.label, "many": e.labels, "count_one": f"{{{{count}}}} {one}", "count_other": f"{{{{count}}}} {many}",
         "search": f"Search {many}", "empty": f"No {many} found.", "related": "Related"}
    if e.user_writes:
        t.update({"mine": f"My {many}", "new": f"New {one}", "edit": f"Edit {one}", "create": f"Create {one}",
                  "save": "Save changes", "delete": f"Delete {one}", "confirmDelete": f"Delete this {one}? This can't be undone."})
    t["fields"] = {f["name"]: humanize(f["name"]) for f in e.fields}
    vals = _values_tree(e)
    if vals:
        t["values"] = vals
    return {e.site_area: t}


def admin_tree(e: Entity) -> dict:
    one, many = humanize(e.name).lower(), humanize(e.Plural).lower()
    t = {"tab": e.labels, "title": e.labels, "subtitle": f"Every {one} on the site, whoever made it.",
         "search": f"Search {many}", "empty": f"No {many} yet.", "create": f"New {one}", "edit": f"Edit {one}",
         "confirmDelete": "Delete “{{name}}”? This can't be undone.",
         "fields": {f["name"]: humanize(f["name"]) for f in e.fields}}
    vals = _values_tree(e)
    if vals:
        t["values"] = vals
    return {e.admin_area: t}


def write_texts(w: Writer, e: Entity) -> None:
    for lang in languages():
        w.locale(LOCALES / lang / f"entity-{e.plural}.json", site_tree(e))
        if e.admin_tab:
            w.locale(LOCALES / lang / f"admin-entity-{e.plural}.json", admin_tree(e))
        else:
            w.remove(LOCALES / lang / f"admin-entity-{e.plural}.json")


# ---- pages, tab, fixture, mock flag

def template_values(e: Entity) -> dict[str, str]:
    return {"__Entity__": e.name, "__entity__": e.key, "__Entities__": e.Plural, "__entities__": e.keys,
            "__plural__": e.plural, "__area__": e.site_area, "__adminArea__": e.admin_area,
            "__contract__": contract_name(e), "__Shell__": "PublicShell" if e.public else "PlainShell",
            "__adminPath__": e.admin_path}


def write_pages(w: Writer, e: Entity) -> None:
    values, flags = template_values(e), {"userWrites": e.user_writes, "public": e.public}
    sources = {"api": "api.ts", "list": "ListPage.tsx", "detail": "DetailPage.tsx", "form": "FormPage.tsx"}
    for kind, path in page_files(e).items():
        src = TEMPLATES / sources[kind]
        w.generated(path, render(src.read_text(encoding="utf-8"), values, flags), source=f"scripts/templates/entity/{sources[kind]}")
    if e.admin_tab:
        src = TEMPLATES / "AdminTab.tsx"
        w.generated(admin_tab_file(e), render(src.read_text(encoding="utf-8"), values, flags),
                    source="scripts/templates/entity/AdminTab.tsx")


def set_mock_flags(w: Writer, flags: dict[str, bool]) -> None:
    """Set entries in mocks.config.ts's entities block (others kept)."""
    text = MOCKS_CONFIG.read_text(encoding="utf-8")
    m = re.search(r"(?P<head>[ \t]*// entities:begin[^\n]*\n)(?P<body>.*?)(?P<tail>[ \t]*// entities:end)", text, re.S)
    if not m:
        raise SystemExit(f"{MOCKS_CONFIG}: the '// entities:begin' / '// entities:end' lines are missing")
    current: dict[str, bool] = {}
    for line in m.group("body").splitlines():
        hit = re.match(r"\s*['\"]?([\w-]+)['\"]?\s*:\s*(true|false)", line)
        if hit:
            current[hit.group(1)] = hit.group(2) == "true"
    current.update(flags)
    ident = re.compile(r"[A-Za-z_]\w*")
    body = "".join(f"  {k if ident.fullmatch(k) else json.dumps(k)}: {'true' if v else 'false'},\n" for k, v in current.items())
    w.plain(MOCKS_CONFIG, text[:m.start("body")] + body + text[m.end("body"):])


def mock_flags() -> dict[str, bool]:
    text = MOCKS_CONFIG.read_text(encoding="utf-8")
    return {k: v == "true" for k, v in re.findall(r"^\s*['\"]?([\w-]+)['\"]?\s*:\s*(true|false)", text, re.M)}


# ---- aggregators

def write_contract_index(w: Writer) -> None:
    keys = sorted(p.stem for p in CONTRACTS.glob("*.ts") if p.name not in STATIC_CONTRACT_FILES)
    lines = ["// Generated by scripts/new-entity.py: every entity contract in this folder. Don't edit; re-run the script.",
             "import type { EntityContract } from './types';"]
    lines += [f"import {{ {k}Contract }} from './{k}';" for k in keys]
    lines += [""] + [f"export * from './{k}';" for k in keys] + ([""] if keys else [])
    lines.append(f"export const CONTRACTS: EntityContract[] = [{', '.join(f'{k}Contract' for k in keys)}];")
    w.plain(CONTRACTS / "all.gen.ts", "\n".join(lines) + "\n")


def _spec_page(spec: dict, e: Entity, archetype: str) -> str | None:
    for p in spec.get("pages") or []:
        if p.get("entity") == e.name and p.get("archetype") == archetype:
            return p["path"]
    return None


def paths_of(spec: dict, e: Entity) -> dict[str, str]:
    """Absolute paths of the entity's pages: public entities at the top level (the spec's browse/detail paths when it
    has them), signed-in-only ones and every form under /dashboard."""
    dash = f"/dashboard/{e.plural}"
    if e.public:
        out = {"list": _spec_page(spec, e, "browse") or f"/{e.plural}", "detail": _spec_page(spec, e, "detail") or f"/{e.plural}/:id"}
    else:
        out = {"list": dash, "detail": f"{dash}/:id"}
    if e.user_writes:
        out.update({"mine": dash, "create": f"{dash}/new", "edit": f"{dash}/:id/edit"})
    return out


def write_site_aggregators(w: Writer, spec: dict) -> None:
    done = [e for e in entities(spec) if generated(e)]
    imports, public_routes, dash_routes = [], [], []
    paths, public_nav, dash_nav = {}, [], []
    browse_pages = any(p.get("archetype") == "browse" for p in spec.get("pages") or [])
    for e in done:
        files = page_files(e)
        lst, det = f"{e.Plural}ListPage", f"{e.name}DetailPage"
        imports.append(f"import {lst} from './{e.plural}/{lst}';")
        imports.append(f"import {det} from './{e.plural}/{det}';")
        p = paths_of(spec, e)
        paths[e.name] = p
        rel = lambda a: a.removeprefix("/dashboard/")  # noqa: E731
        if e.public:
            public_routes.append(f"h(Route, {{ key: '{e.plural}-list', path: '{p['list']}', element: h({lst}) }})")
            public_routes.append(f"h(Route, {{ key: '{e.plural}-detail', path: '{p['detail']}', element: h({det}) }})")
            if not browse_pages or _spec_page(spec, e, "browse"):
                public_nav.append({"to": p["list"], "label": f"{e.site_area}.many"})
        else:
            if not e.user_writes:
                dash_routes.append(f"h(Route, {{ key: '{e.plural}-list', path: '{rel(p['list'])}', element: h({lst}) }})")
            dash_routes.append(f"h(Route, {{ key: '{e.plural}-detail', path: '{rel(p['detail'])}', element: h({det}) }})")
        if e.user_writes:
            form = f"{e.name}FormPage"
            imports.append(f"import {form} from './{e.plural}/{form}';")
            dash_routes.append(f"h(Route, {{ key: '{e.plural}-mine', path: '{rel(p['mine'])}', element: h({lst}, {{ mine: true }}) }})")
            dash_routes.append(f"h(Route, {{ key: '{e.plural}-new', path: '{rel(p['create'])}', element: h({form}) }})")
            dash_routes.append(f"h(Route, {{ key: '{e.plural}-edit', path: '{rel(p['edit'])}', element: h({form}) }})")
            dash_nav.append({"to": p["mine"], "label": f"{e.site_area}.mine"})
        elif not e.public:
            dash_nav.append({"to": p["list"], "label": f"{e.site_area}.many"})
        assert files  # pages exist for every generated entity
    index = not ITEMS_PAGE.exists()
    if index:
        home = dash_nav[0]["to"] if dash_nav else "/dashboard/settings"
        dash_routes.insert(0, f"h(Route, {{ key: 'index', index: true, element: h(Navigate, {{ to: '{home}', replace: true }}) }})")
    router = ["Route"] + (["Navigate"] if index else [])
    head = ["// Generated by scripts/new-entity.py from the entity contracts and site.spec.yaml pages. Don't edit: re-run the script",
            "// (the pages it points at are yours to edit). App.tsx mounts these; the paths and nav are in paths.gen.ts.",
            "import type { ReactElement } from 'react';"]
    if public_routes or dash_routes:
        head += ["import { createElement as h } from 'react';", f"import {{ {', '.join(router)} }} from 'react-router-dom';"]
    body = head + imports + ["",
                             "/** Top-level routes (public entities' list and detail pages). */",
                             "export const publicEntityRoutes: ReactElement[] = [" + "".join(f"\n  {r}," for r in public_routes) + ("\n" if public_routes else "") + "];", "",
                             "/** Routes under /dashboard (signed in): my records, create and edit forms, signed-in-only entities. */",
                             "export const dashboardEntityRoutes: ReactElement[] = [" + "".join(f"\n  {r}," for r in dash_routes) + ("\n" if dash_routes else "") + "];", ""]
    w.plain(FRONT_ENTITIES / "routes.gen.ts", "\n".join(body))

    js = lambda v: json.dumps(v, indent=2).replace('"', "'")  # noqa: E731
    paths_ts = ["// Generated by scripts/new-entity.py from the entity contracts and site.spec.yaml pages. Don't edit: re-run the script.",
                "import type { EntityPaths } from './paths';", "",
                "/** Each entity's pages (entityHref in paths.ts fills in the id). */",
                f"export const ENTITY_PATHS: Record<string, EntityPaths> = {js(paths)};", "",
                "/** Header links on public pages (PublicShell) and dashboard nav entries (DashboardLayout); labels are i18n keys. */",
                f"export const publicEntityNav: {{ to: string; label: string }}[] = {js(public_nav)};",
                f"export const dashboardEntityNav: {{ to: string; label: string }}[] = {js(dash_nav)};", ""]
    w.plain(FRONT_ENTITIES / "paths.gen.ts", "\n".join(paths_ts))


def write_admin_aggregator(w: Writer, spec: dict) -> None:
    done = [e for e in entities(spec) if generated(e) and e.admin_tab and admin_tab_file(e).exists()]
    lines = ["// Generated by scripts/new-entity.py: one admin tab per spec entity (adminTab: true). Don't edit: re-run the script",
             "// (the tab components in tabs/entities/ are yours to edit)."]
    if done:
        lines += ["import { lazy } from 'react';", "import { registerTab } from './registry';", ""]
        for i, e in enumerate(done):
            lines.append(f"registerTab({{ id: '{e.plural}', label: '{e.admin_area}.tab', icon: 'items', section: 'admin.sections.data', "
                         f"order: {50 + i}, component: lazy(() => import('./entities/{e.Plural}Tab')) }});")
    else:
        lines.append("export {};")
    w.plain(ADMIN_TABS / "entities.gen.ts", "\n".join(lines) + "\n")


def write_aggregators(w: Writer, spec: dict) -> None:
    write_contract_index(w)
    write_site_aggregators(w, spec)
    write_admin_aggregator(w, spec)


# ---- one entity

def generate(w: Writer, spec: dict, e: Entity) -> None:
    w.generated(CONTRACTS / f"{e.key}.ts", contract_ts(e))
    w.once(FIXTURES / f"{e.plural}.json", "[]\n")
    write_pages(w, e)
    write_texts(w, e)
    if e.plural not in mock_flags():
        set_mock_flags(w, {e.plural: True})
