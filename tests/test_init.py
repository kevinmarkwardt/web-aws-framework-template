"""The AI site-builder tooling (scripts/spec.py, init.py, new-entity.py, gen-fixtures.py; scripts/sitegen/), run on a
temporary copy of the repo with ai/site.spec.example.yaml: placeholders, config, languages, the Items example removed,
idempotent re-runs, hand edits kept, fixtures deterministic and valid, design tokens into theme.css, and api/site.json
read by api/lib/config.py."""

from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from sitegen import design, init_site  # noqa: E402
from sitegen import spec as specs  # noqa: E402

EXAMPLE = yaml.safe_load((ROOT / "ai" / "site.spec.example.yaml").read_text(encoding="utf-8"))


def run(repo: Path, script: str, *args: str) -> str:
    out = subprocess.run([sys.executable, str(repo / "scripts" / script), *args], cwd=repo, capture_output=True,
                         text=True, timeout=300)
    assert out.returncode == 0, out.stdout + out.stderr
    return out.stdout


TEMPLATE = not (ROOT / "api" / "site.json").exists()  # init.py writes it: this repo is a site now, not the template


@pytest.fixture(scope="module")
def site(tmp_path_factory) -> Path:
    """A copy of the template, initialized from the example spec (with a second language), entities generated."""
    if not TEMPLATE:
        pytest.skip("runs on the template (this repo has been initialized: api/site.json exists)")
    repo = tmp_path_factory.mktemp("site") / "repo"
    init_site.copy_tree(repo)
    spec = copy.deepcopy(EXAMPLE)
    spec["modules"]["i18n"]["languages"] = ["en", "es"]
    spec["modules"]["googleTags"] = {"ga4Id": "G-TEST123"}
    (repo / "site.spec.yaml").write_text(yaml.safe_dump(spec, sort_keys=False), encoding="utf-8")
    run(repo, "init.py", "--spec", "site.spec.yaml")
    run(repo, "new-entity.py", "--all")
    run(repo, "gen-fixtures.py")
    return repo


def read(repo: Path, rel: str) -> str:
    return (repo / rel).read_text(encoding="utf-8")


# ---- the spec

def test_the_example_spec_is_valid():
    assert specs.problems(EXAMPLE) == []
    assert "Recipe (/recipes" in specs.summary(EXAMPLE)


def test_cross_field_checks():
    bad = copy.deepcopy(EXAMPLE)
    bad["entities"][0]["fields"].append({"name": "editor", "type": "ref", "ref": "Editor"})
    bad["entities"][0]["fields"].append({"name": "level", "type": "enum"})
    bad["pages"].append({"path": "/x", "title": "X", "archetype": "detail", "entity": "Nope"})
    bad["modules"]["billing"]["plans"] = [{"id": "pro", "name": "Pro", "monthlyUsd": 9}]
    found = "\n".join(specs.problems(bad))
    assert "ref Editor is not an entity" in found
    assert "an enum field needs values" in found
    assert "entity Nope is not in entities" in found and "needs :id" in found
    assert "plans are only for mode subscriptions or both" in found


def test_schema_errors_come_first():
    assert any("displayName" in p for p in specs.problems({**EXAMPLE, "site": {"name": "x1", "domain": "x.com"}}))


# ---- init.py

def test_placeholders_and_renames(site):
    assert not (site / "cdk/bin/yourapp.ts").exists() and (site / "cdk/bin/mise.ts").exists()
    assert (site / "cdk/lib/mise-stack.ts").exists()
    assert json.loads(read(site, "package.json"))["name"] == "mise"
    assert json.loads(read(site, "packages/shared/package.json"))["name"] == "@mise/shared"
    assert "../lib/mise-stack" in read(site, "cdk/bin/mise.ts")
    for rel in ("frontend/src/site.ts", "api/handler.py", "CLAUDE.md", "frontend/index.html"):
        assert not re.search(r"yourapp|YourApp", read(site, rel)), rel
    assert "domainName: 'mise.example.com'" in read(site, "cdk/bin/mise.ts")


def test_config_for_the_api_the_sites_and_cdk(site):
    sj = json.loads(read(site, "api/site.json"))
    assert sj["billing"]["mode"] == "credits" and sj["billing"]["signupGift"] == 300 and len(sj["billing"]["packs"]) == 3
    assert "displayName: \"Mise\"" in read(site, "packages/shared/src/site.generated.ts")
    assert "billingMode: \"credits\"" in read(site, "packages/shared/src/site.generated.ts")
    ctx = json.loads(read(site, "cdk/cdk.json"))["context"]
    assert (ctx["billingMode"], ctx["adminEmail"], ctx["region"], ctx["googleTags"]) == ("credits", "admin@example.com", "us-east-1", True)
    assert "VITE_GA4_ID=G-TEST123" in read(site, "frontend/.env.production")


def test_a_second_language_gets_english_copies(site):
    assert "{ code: 'es', name: 'Español' }" in read(site, "packages/shared/src/i18n/languages.ts")
    en = sorted(p.name for p in (site / "packages/shared/src/locales/en").glob("*.json"))
    assert sorted(p.name for p in (site / "packages/shared/src/locales/es").glob("*.json")) == en
    assert "entity-recipes.json" in en and (site / "api/locales/es.json").exists()


def test_the_items_example_is_gone(site):
    assert not (site / "frontend/src/pages/dashboard/ItemsPage.tsx").exists()
    assert not (site / "admin/src/tabs/ItemsTab.tsx").exists()
    for rel in ("frontend/src/App.tsx", "frontend/src/pages/dashboard/DashboardLayout.tsx", "admin/src/tabs/app.ts"):
        assert "example:items" not in read(site, rel) and "ItemsPage" not in read(site, rel)
    limit = json.loads(read(ROOT, "packages/shared/src/locales/en/items.json"))["items"]["limit"]
    assert json.loads(read(site, "packages/shared/src/locales/en/items.json")) == {"items": {"limit": limit}}
    assert "index: true" in read(site, "frontend/src/entities/routes.gen.ts")
    assert (site / "api/routes/items.py").exists()  # the backend example stays


def test_init_is_idempotent(site):
    assert "0 change(s)" in run(site, "init.py", "--spec", "site.spec.yaml")


# ---- new-entity.py

def test_entities_generated(site):
    contract = read(site, "packages/shared/src/contracts/recipe.ts")
    assert "export type RecipeInput = {" in contract and '"path": "/api/recipes"' in contract
    assert "recipeContract" in read(site, "packages/shared/src/contracts/all.gen.ts")
    assert "recipes: true" in read(site, "packages/shared/src/mocks/mocks.config.ts")
    routes = read(site, "frontend/src/entities/routes.gen.ts")
    assert "path: '/recipes'" in routes and "path: '/chefs/:id'" in routes
    assert "adminEntityRecipes.tab" in read(site, "admin/src/tabs/entities.gen.ts")
    texts = json.loads(read(site, "packages/shared/src/locales/en/entity-recipes.json"))["entityRecipes"]
    assert texts["fields"]["publishedAt"] == "Published at" and texts["values"]["difficulty"]["easy"] == "Easy"
    # generated pages are built on the archetypes (which carry font-display and the design tokens)
    assert "/shared/archetypes'" in read(site, "frontend/src/entities/recipes/RecipesListPage.tsx")
    assert "<Detail" in read(site, "frontend/src/entities/recipes/RecipeDetailPage.tsx")


def test_new_entity_keeps_hand_edits(site):
    page = site / "frontend/src/entities/chefs/ChefsListPage.tsx"
    original = page.read_text(encoding="utf-8")
    out = run(site, "new-entity.py", "--all")
    assert "already up to date" in out and "created" not in out and "updated" not in out
    page.write_text(original + "// my change\n", encoding="utf-8")
    out = run(site, "new-entity.py", "Chef")
    assert "kept" in out and page.read_text(encoding="utf-8").endswith("// my change\n")
    run(site, "new-entity.py", "Chef", "--force")
    assert page.read_text(encoding="utf-8") == original


def test_texts_keep_edits_and_follow_the_spec(site):
    path = site / "packages/shared/src/locales/en/entity-chefs.json"
    tree = json.loads(path.read_text(encoding="utf-8"))
    tree["entityChefs"]["many"] = "Our chefs"
    path.write_text(json.dumps(tree), encoding="utf-8")
    run(site, "new-entity.py", "Chef")
    assert json.loads(path.read_text(encoding="utf-8"))["entityChefs"]["many"] == "Our chefs"


# ---- gen-fixtures.py

def test_fixtures_are_deterministic_and_valid(site):
    from api.lib import entities

    recipes = read(site, "packages/shared/src/mocks/fixtures/recipes.json")
    chefs = json.loads(read(site, "packages/shared/src/mocks/fixtures/chefs.json"))
    run(site, "gen-fixtures.py")
    assert read(site, "packages/shared/src/mocks/fixtures/recipes.json") == recipes
    rows = json.loads(recipes)
    assert len(rows) == 60 and len(chefs) == 12
    chef_ids = {c["id"] for c in chefs}
    fields = [f for f in EXAMPLE["entities"][0]["fields"]]
    ent = entities.Entity(name="Recipe", plural="recipes", kind="RECIPE", title_field="title", fields=fields)
    for r in rows:
        entities.validate(ent, {k: v for k, v in r.items() if k not in ("id", "createdAt", "updatedAt")}, partial=False)
        assert r["chef"] is None or r["chef"] in chef_ids
    by_chef: dict = {}
    for r in rows:
        by_chef[r["chef"]] = by_chef.get(r["chef"], 0) + 1
    assert 20 in by_chef.values()                                   # "one chef with 20 recipes"
    assert max(len(r["title"]) for r in rows) > 120                 # "recipe with very long title"
    assert any(r["image"] is None for r in rows)                    # "recipe with no image"
    assert len({r["cuisine"] for r in rows}) > 3
    img = rows[0]["image"] or next(r["image"] for r in rows if r["image"])
    assert (site / "frontend/public" / img.lstrip("/")).exists() and (site / "admin/public" / img.lstrip("/")).exists()


# ---- --apply-design (theme.css token blocks)

THEME = """:root {
  /* tokens:begin */
  --brand-600: oklch(51% 0.26 277);
  --ink: oklch(21% 0.03 265);
  --warn: oklch(55% 0.16 49);
  /* tokens:end */
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* dark:begin */
    --ink: oklch(95% 0.01 265);
    /* dark:end */
  }
}
@theme inline {
  --color-ink: var(--ink);
}
"""


def test_design_tokens_land_between_the_markers():
    tokens = copy.deepcopy(EXAMPLE["design"]["tokens"])
    tokens["colors"]["dark"] = {"bg": "#14110e", "ink": "#f4efe8", "accent": "#e07a4f"}
    css = design.apply_theme(THEME, tokens)
    head, rest = css.split("/* tokens:end */", 1)
    assert "--ink: #1f1b16;" in head and "--surface: #faf7f2;" in head and "--panel: #ffffff;" in head
    assert "--warn: oklch(55% 0.16 49);" in head                    # not in the spec: kept
    assert all(f"--brand-{s}:" in head for s in design.BRAND_STEPS)
    assert "--typeface-display: 'Fraunces Variable'" in head and "--corner-card: 0.75rem;" in head and "--density: 1;" in head
    dark = rest.split("/* dark:end */")[0]
    assert "--ink: #f4efe8;" in dark and "--surface: #14110e;" in dark and "--brand-600:" in dark
    assert "@theme inline {\n  --color-ink: var(--ink);\n}" in css     # never touched
    assert design.apply_theme(css, tokens) == css                    # idempotent
    with pytest.raises(design.MarkersMissing):
        design.apply_theme("@theme { --color-ink: red; }", tokens)


def test_brand_scale_is_a_lightness_ramp():
    scale = design.brand_scale("#b4532a")
    lights = [float(re.match(r"oklch\(([\d.]+)%", scale[f"--brand-{s}"]).group(1)) for s in design.BRAND_STEPS]
    assert lights == sorted(lights, reverse=True) and lights[0] > 95 and lights[-1] < 35
    assert abs(design.hex_to_oklch("#ffffff")[0] - 1) < 1e-3


def test_fonts_self_hosted_or_linked():
    _, _, fonts = design.token_vars({"fonts": {"display": "Fraunces", "body": "Some Rare Font"}})
    assert fonts == {"Fraunces": "fontsource", "Some Rare Font": "google"}
    assert "import '@fontsource-variable/fraunces';" in design.fonts_ts(fonts)
    assert "family=Some+Rare+Font" in design.google_link(fonts)


# ---- api/site.json -> api/lib/config.py

def test_site_json_overrides_the_code_config(monkeypatch, tmp_path):
    from api.lib import config

    for name in ("PAID_PLANS", "BILLING", "SUPPORT"):
        monkeypatch.setattr(config, name, copy.deepcopy(getattr(config, name)))
    path = tmp_path / "site.json"
    path.write_text(json.dumps({"billing": {"plans": [{"id": "plus", "name": "Plus", "monthlyUsd": 7}],
                                            "packs": [{"usd": 3}], "signupGift": 50}, "support": False}))
    monkeypatch.setenv("SITE_CONFIG", str(path))
    config.apply_site_settings(config._site_settings())
    assert [p["id"] for p in config.PAID_PLANS] == ["plus"] and config.BILLING["signupGift"] == 50
    assert config.BILLING["packs"] == [{"usd": 3, "bonusPct": 0}] and not config.support_on()
    monkeypatch.setenv("SITE_CONFIG", "off")
    assert config._site_settings() == {}
