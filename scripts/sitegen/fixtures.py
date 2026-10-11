"""Deterministic mock data for the browser mocks (scripts/gen-fixtures.py).

Every value comes from random generators seeded by (mocks.seed, entity, purpose), so the same spec always gives the
same files, and adding an entity or a field doesn't reshuffle the others. Values follow the field's type, its name and
its `hint` ("15-240, skewed toward 30-60", "dish name, 2-6 words", "full name"); enums and refs are skewed (a few
values and a few popular parents get most records), dates lean recent. Images are SVG placeholders written to
frontend/public/mock-images/ and admin/public/mock-images/ (offline, no third-party hosts).

Per-entity overrides: scripts/fixtures/<entity>.py (entity = the camelCase name, e.g. recipe.py) may define
    def value(field: dict, ctx) -> object | Ellipsis     one field's value (return ... to keep the generated one)
    def record(rec: dict, ctx) -> dict                    the whole record, after its fields are filled
    def records(rows: list[dict], ctx) -> list[dict]      the whole list, after edge cases
ctx has .rng (random.Random), .fake (Faker), .index, .entity (sitegen.spec.Entity), .ids (entity name -> ids) and
.rows (entity name -> records generated so far). Use them (not module-level randomness) to stay deterministic. Text an
LLM wrote for realism belongs in the override as fixed lists, never fetched at generation time.
"""

from __future__ import annotations

import colorsys
import datetime as dt
import hashlib
import importlib.util
import json
import random
import re
from dataclasses import dataclass, field
from pathlib import Path

from . import ROOT
from .spec import Entity, entities, humanize

FIXTURES = ROOT / "packages" / "shared" / "src" / "mocks" / "fixtures"
IMAGE_DIRS = [ROOT / "frontend" / "public" / "mock-images", ROOT / "admin" / "public" / "mock-images"]
OVERRIDES = ROOT / "scripts" / "fixtures"
DEFAULT_COUNT = 24
IMAGE_POOL = 24
MOCK_USER = "mock-user"  # MOCK_AUTH's account (frontend/src/api.ts): "My ..." pages have records
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
# a fixed "now" keeps the output stable from day to day; records spread back from here
NOW = dt.datetime(2026, 10, 1, 12, 0, tzinfo=dt.timezone.utc)

DISH_ADJ = ["Charred", "Braised", "Crispy", "Slow-Roasted", "Smoked", "Brown-Butter", "Herbed", "Spiced", "Citrus",
            "Miso-Glazed", "Garlicky", "Lemony", "Golden", "Wild Mushroom", "Seared", "Fire-Roasted", "Honey-Glazed",
            "Saffron", "Sesame", "Coconut"]
DISH_MAIN = ["Chicken", "Salmon", "Lamb Shoulder", "Short Ribs", "Cauliflower", "Pork Belly", "Duck Breast",
             "Scallops", "Eggplant", "Halibut", "Gnocchi", "Risotto", "Tagliatelle", "Ramen", "Tacos", "Dumplings",
             "Curry", "Tart", "Carrots", "Mussels", "Polenta", "Flatbread", "Noodles", "Chickpeas"]
DISH_WITH = ["with Salsa Verde", "with Chili Crisp", "and Shallots", "with Gremolata", "with Charred Leeks",
             "with Romesco", "with Herb Oil", "and Crispy Capers", "with Yuzu Butter", "and Pickled Onions",
             "with Tahini", "with Black Garlic"]
VENUE_ADJ = ["Little", "Golden", "Copper", "Olive", "Salt", "Fig", "Juniper", "Ember", "Wild", "Harbor", "Saffron"]
VENUE_NOUN = ["Table", "Hearth", "Kitchen", "Larder", "Fern", "Oak", "Lantern", "Pantry", "Orchard", "Tide", "Vine"]
PRODUCT_ADJ = ["Everyday", "Classic", "Compact", "Pro", "Essential", "Ultra", "Travel", "Studio", "Heritage", "Field"]
PRODUCT_NOUN = ["Backpack", "Mug", "Notebook", "Lamp", "Jacket", "Bottle", "Chair", "Speaker", "Blanket", "Pen",
                "Watch", "Planter", "Knife", "Tote"]
GENERIC_TAGS = ["new", "popular", "featured", "classic", "seasonal", "quick", "staff pick", "budget", "premium",
                "family", "weekend", "healthy", "local", "limited"]
FOOD_TAGS = ["weeknight", "vegetarian", "gluten-free", "spicy", "one-pot", "make-ahead", "dairy-free", "comfort food",
             "summer", "holiday", "date night", "high-protein", "vegan", "grill"]


def _seed(*parts) -> int:
    return int(hashlib.sha256(":".join(str(p) for p in parts).encode()).hexdigest()[:12], 16)


def _id(rng: random.Random) -> str:
    return "".join(rng.choice(CROCKFORD) for _ in range(26))


def _zipf(rng: random.Random, n: int, s: float = 1.0) -> list[float]:
    """Skewed weights for n choices (a shuffled 1/rank^s), so a few are common and the rest rare."""
    w = [1 / (r + 1) ** s for r in range(n)]
    rng.shuffle(w)
    return w


def _range(hint: str) -> tuple[float, float] | None:
    m = re.search(r"\$?(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*\$?(-?\d+(?:\.\d+)?)", hint or "")
    return (float(m.group(1)), float(m.group(2))) if m else None


def _skew(hint: str) -> tuple[float, float] | None:
    m = re.search(r"(?:skew\w*|mostly|usually|around)\D*(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)", hint or "")
    return (float(m.group(1)), float(m.group(2))) if m else None


def _words(hint: str) -> tuple[int, int] | None:
    m = re.search(r"(\d+)\s*(?:-|–|to)\s*(\d+)\s*words", hint or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


@dataclass
class Ctx:
    rng: random.Random
    fake: object
    entity: Entity
    ids: dict[str, list[str]]
    rows: dict[str, list[dict]]
    index: int = 0
    extra: dict = field(default_factory=dict)


class Generator:
    def __init__(self, spec: dict):
        from faker import Faker  # scripts/requirements.txt

        self.spec = spec
        mocks = spec.get("mocks") or {}
        self.seed = int(mocks.get("seed", 42))
        self.counts = mocks.get("counts") or {}
        self.edge_cases = list(mocks.get("edgeCases") or [])
        self.entities = entities(spec)
        self.Faker = Faker
        self.ids = {e.name: self._ids(e) for e in self.entities}
        self.rows: dict[str, list[dict]] = {}
        self.notes: list[str] = []
        self.images: dict[str, list[tuple[str, str]]] = {}

    def count(self, e: Entity) -> int:
        return int(self.counts.get(e.name, DEFAULT_COUNT))

    def _ids(self, e: Entity) -> list[str]:
        rng = random.Random(_seed(self.seed, e.name, "ids"))
        return sorted(_id(rng) for _ in range(self.count(e)))

    def _fake(self, e: Entity, purpose: str):
        f = self.Faker("en_US")
        f.seed_instance(_seed(self.seed, e.name, purpose))
        return f

    # ---- values

    def _title(self, f: dict, ctx: Ctx) -> str:
        hint, rng, fake = (f.get("hint") or "").lower(), ctx.rng, ctx.fake
        lo, hi = _words(hint) or (2, 5)
        if re.search(r"\b(dish|recipe|meal|menu)\b", hint):
            words = f"{rng.choice(DISH_ADJ)} {rng.choice(DISH_MAIN)}"
            if rng.random() < 0.55:
                words += " " + rng.choice(DISH_WITH)
            parts = words.split()
            return " ".join(parts[:max(lo, min(hi, len(parts)))])
        if re.search(r"\b(product|item for sale|gear)\b", hint):
            return f"{rng.choice(PRODUCT_ADJ)} {rng.choice(PRODUCT_NOUN)}"
        n = rng.randint(lo, hi)
        words = re.sub(r"[^\w\s'-]", "", fake.sentence(nb_words=n + 2)).split()[:n]
        return " ".join(w.capitalize() for w in words)

    def _string(self, f: dict, ctx: Ctx) -> str:
        name, hint = f["name"].lower(), (f.get("hint") or "").lower()
        fake, rng = ctx.fake, ctx.rng
        both = f"{name} {hint}"
        if re.search(r"\b(dish|recipe|meal|menu|product)\b", hint):
            return self._title(f, ctx)
        if re.search(r"full name|person|author|people", hint) or name in ("name", "fullname", "author", "owner", "contact"):
            return fake.name()
        if "firstname" in name:
            return fake.first_name()
        if "lastname" in name or "surname" in name:
            return fake.last_name()
        if re.search(r"restaurant|venue|bar|cafe|bakery|shop|store|studio|gym", both):
            pick = rng.random()
            if pick < 0.4:
                return f"{rng.choice(VENUE_ADJ)} {rng.choice(VENUE_NOUN)}"
            if pick < 0.7:
                return f"{fake.last_name()}'s"
            return f"The {rng.choice(VENUE_NOUN)} & {rng.choice(VENUE_NOUN)}"
        if re.search(r"company|business|brand|employer|organization", both):
            return fake.company()
        if "city" in both:
            return fake.city()
        if "country" in both:
            return fake.country()
        if re.search(r"address|street", both):
            return fake.street_address()
        if re.search(r"phone", both):
            return fake.phone_number()
        if re.search(r"user ?name|handle", both):
            return fake.user_name()
        if re.search(r"colou?r", both):
            return fake.color_name()
        if re.search(r"\b(sku|code)\b", both):
            return fake.bothify("??-####").upper()
        if re.search(r"title|headline|subject|label", both) or hint:
            return self._title(f, ctx)
        return " ".join(w.capitalize() for w in fake.words(nb=rng.randint(2, 4)))

    def _food(self, ctx: Ctx) -> bool:
        return bool(re.search(r"dish|recipe|food|cuisine|chef|menu|restaurant",
                              ctx.entity.name.lower() + " " + " ".join((x.get("hint") or "") + " " + x["name"] for x in ctx.entity.fields).lower()))

    def _text(self, f: dict, ctx: Ctx, rec: dict) -> str:
        name, hint, fake, rng = f["name"].lower(), (f.get("hint") or "").lower(), ctx.fake, ctx.rng
        if re.search(r"one (\w+ )?sentence|tagline|summary|blurb", f"{name} {hint}"):
            if self._food(ctx) and re.search(r"appetiz|dish|recipe|food|tasty", hint + " " + ctx.entity.name.lower()):
                main, adj, side = rng.choice(DISH_MAIN).lower(), rng.choice(DISH_ADJ).lower(), rng.choice(DISH_WITH)
                return rng.choice([
                    f"{adj.capitalize()} {main} {side.lower()}, ready in under an hour.",
                    f"Weeknight-friendly {main} with {adj} edges and a bright, punchy finish.",
                    f"A restaurant classic made simple: {adj} {main} {side.lower()}.",
                    f"Deeply savory {main}, finished {side.lower()} for crunch and contrast.",
                    f"Everything you love about {main}, with a {adj} twist from the chef.",
                ])
            return fake.sentence(nb_words=rng.randint(10, 18))
        if name in ("bio", "about") or "bio" in hint:
            who = next((v for k, v in rec.items() if k in ("name", "fullName") and isinstance(v, str)), fake.first_name())
            where = next((v for k, v in rec.items() if isinstance(v, str) and k in ("restaurant", "company", "employer", "studio")), None)
            city = next((v for k, v in rec.items() if isinstance(v, str) and k == "city"), None)
            first = (f"{who} runs {where}" + (f" in {city}" if city else "") + "." if where
                     else f"{who} has spent {rng.randint(4, 25)} years in the trade.")
            if self._food(ctx):
                more = rng.choice(["Known for patient braises and bright, acidic sauces.",
                                   "Cooks seasonally, with most produce from farms within a day's drive.",
                                   "Trained in classic French technique before falling for open-fire cooking.",
                                   "Teaches a sold-out weekend class on knife skills and stocks.",
                                   "Believes every great dish starts with one perfect ingredient."])
            else:
                more = fake.sentence(nb_words=rng.randint(10, 16))
            return f"{first} {more}"
        return "\n\n".join(fake.paragraph(nb_sentences=rng.randint(2, 5)) for _ in range(rng.randint(1, 3)))

    def _int(self, f: dict, ctx: Ctx) -> int:
        name, hint, rng = f["name"].lower(), f.get("hint") or "", ctx.rng
        rnge = _range(hint)
        if not rnge:
            rnge = next((r for k, r in (("minute", (5, 180)), ("duration", (5, 180)), ("age", (18, 80)),
                                        ("year", (1990, 2026)), ("rating", (1, 5)), ("star", (1, 5)),
                                        ("serving", (1, 12)), ("quantity", (0, 50)), ("count", (0, 120)),
                                        ("stock", (0, 300)), ("seat", (1, 200))) if k in name), (1, 100))
        lo, hi = int(rnge[0]), int(rnge[1])
        skew = _skew(hint)
        if skew and rng.random() < 0.7:
            return rng.randint(int(skew[0]), int(skew[1]))
        if "rating" in name or "star" in name:
            return min(hi, max(lo, round(rng.triangular(lo, hi, hi - 0.6))))
        return min(hi, max(lo, round(rng.triangular(lo, hi, lo + (hi - lo) * 0.3))))

    def _number(self, f: dict, ctx: Ctx) -> float:
        name, hint, rng = f["name"].lower(), f.get("hint") or "", ctx.rng
        lo, hi = _range(hint) or ((1.0, 5.0) if "rating" in name else (0.0, 100.0))
        if "rating" in name:
            return round(min(hi, max(lo, rng.triangular(lo, hi, hi - 0.4))), 1)
        return round(rng.triangular(lo, hi, lo + (hi - lo) * 0.3), 2)

    def _money(self, f: dict, ctx: Ctx) -> int:
        rng = ctx.rng
        lo, hi = _range(f.get("hint") or "") or (4.0, 120.0)
        usd = min(hi, max(lo, rng.lognormvariate(0, 0.6) * (lo + (hi - lo) * 0.2)))
        cents = int(usd) * 100 + rng.choice([0, 0, 50, 95, 99])
        return max(int(lo * 100), min(int(hi * 100), cents))

    def _date(self, f: dict, ctx: Ctx, kind: str) -> str:
        name, rng = f["name"].lower(), ctx.rng
        if re.search(r"birth|dob", name):
            d = dt.date(1960, 1, 1) + dt.timedelta(days=rng.randint(0, 45 * 365))
            return d.isoformat()
        future = re.search(r"start|due|event|deadline|expires|until|next", name)
        days = rng.triangular(0, 90, 10) if future else -rng.triangular(0, 730, 30)
        when = NOW + dt.timedelta(days=days, minutes=rng.randint(0, 24 * 60))
        return when.date().isoformat() if kind == "date" else when.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def _tags(self, f: dict, ctx: Ctx) -> list[str]:
        rng = ctx.rng
        hint = (f.get("hint") or "").lower()
        pool = list(f.get("values") or [])
        if not pool:
            food = any(re.search(r"dish|recipe|food|cuisine|chef|menu", (x.get("hint") or "") + x["name"].lower())
                       for x in ctx.entity.fields) or re.search(r"food|recipe", ctx.entity.name.lower() + hint)
            pool = FOOD_TAGS if food else GENERIC_TAGS
        weights = ctx.extra.setdefault(f"tags:{f['name']}", _zipf(random.Random(_seed(self.seed, ctx.entity.name, f["name"], "tagw")), len(pool)))
        k = min(len(pool), rng.choice([0, 1, 1, 2, 2, 2, 3, 3, 4]))
        out: list[str] = []
        while len(out) < k:
            t = rng.choices(pool, weights)[0]
            if t not in out:
                out.append(t)
        return out

    def _ref(self, f: dict, ctx: Ctx) -> str | None:
        ids = self.ids.get(f["ref"], [])
        if not ids:
            return None
        weights = ctx.extra.setdefault(f"ref:{f['name']}", _zipf(random.Random(_seed(self.seed, ctx.entity.name, f["name"], "refw")), len(ids), 0.9))
        return ctx.rng.choices(ids, weights)[0]

    def _image(self, e: Entity, f: dict, ctx: Ctx) -> str:
        pool = self.images.setdefault(e.plural, [])
        n = ctx.rng.randrange(min(IMAGE_POOL, max(1, self.count(e))))
        name = f"{f['name']}-{n + 1:02d}.svg"
        if all(p[0] != name for p in pool):
            pool.append((name, svg_placeholder(_seed(self.seed, e.name, f["name"], n))))
        return f"/mock-images/{e.plural}/{name}"

    def value(self, e: Entity, f: dict, ctx: Ctx, rec: dict):
        t = f["type"]
        rng = ctx.rng
        optional = not f.get("required")
        if optional and t not in ("bool", "tags") and rng.random() < (0.08 if t == "image" else 0.06):
            return None
        if t == "string":
            return self._string(f, ctx)
        if t == "text":
            return self._text(f, ctx, rec)
        if t == "int":
            return self._int(f, ctx)
        if t == "number":
            return self._number(f, ctx)
        if t == "money":
            return self._money(f, ctx)
        if t == "bool":
            rare = re.search(r"rare|mostly (false|no)|seldom", (f.get("hint") or "").lower())
            return rng.random() < (0.2 if rare else 0.7)
        if t in ("date", "datetime"):
            return self._date(f, ctx, t)
        if t == "enum":
            vals = f.get("values") or []
            w = ctx.extra.setdefault(f"enum:{f['name']}", _zipf(random.Random(_seed(self.seed, e.name, f["name"], "enumw")), len(vals), 0.8))
            return rng.choices(vals, w)[0]
        if t == "image":
            return self._image(e, f, ctx)
        if t == "url":
            return f"https://{ctx.fake.domain_word()}.example.com/{ctx.fake.slug()}"
        if t == "email":
            who = next((v for k, v in rec.items() if isinstance(v, str) and k in ("name", "fullName")), None) or ctx.fake.name()
            local = re.sub(r"[^a-z.]", "", who.lower().replace(" ", "."))[:30] or "someone"
            return f"{local}{rng.randint(1, 99) if rng.random() < 0.3 else ''}@example.com"
        if t == "tags":
            return self._tags(f, ctx)
        if t == "ref":
            return self._ref(f, ctx)
        return None

    # ---- records

    def _override(self, e: Entity):
        path = OVERRIDES / f"{e.key}.py"
        if not path.exists():
            return None
        spec = importlib.util.spec_from_file_location(f"fixture_override_{e.key}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def entity_rows(self, e: Entity) -> list[dict]:
        rng = random.Random(_seed(self.seed, e.name, "rows"))
        fake = self._fake(e, "rows")
        ctx = Ctx(rng=rng, fake=fake, entity=e, ids=self.ids, rows=self.rows)
        hook = self._override(e)
        owners = [MOCK_USER] + [f"user-{i:04d}" for i in range(1, 12)]
        owner_w = [6] + [1 / (i + 1) for i in range(11)]
        rows = []
        for i, rid in enumerate(self.ids[e.name]):
            ctx.index = i
            # created over the last ~14 months, more of them recently
            created = NOW - dt.timedelta(days=rng.triangular(0, 420, 20), minutes=rng.randint(0, 1440))
            updated = created + dt.timedelta(days=rng.choice([0, 0, 0, rng.uniform(0, 60)]))
            updated = min(updated, NOW)
            rec: dict = {"id": rid, "createdAt": _iso(created), "updatedAt": _iso(updated)}
            if e.user_writes:
                rec["ownerId"] = rng.choices(owners, owner_w)[0] if e.owner == "user" or rng.random() < 0.6 else None
            for f in e.fields:
                v = ...
                if hook and hasattr(hook, "value"):
                    v = hook.value(f, ctx)
                if v is ...:
                    v = self.value(e, f, ctx, rec)
                rec[f["name"]] = v
            if hook and hasattr(hook, "record"):
                rec = hook.record(rec, ctx)
            rows.append(rec)
        rows.sort(key=lambda r: r["createdAt"], reverse=True)
        return rows

    def generate(self) -> dict[str, list[dict]]:
        for e in self.entities:
            self.rows[e.name] = self.entity_rows(e)
        self.apply_edge_cases()
        for e in self.entities:
            hook = self._override(e)
            if hook and hasattr(hook, "records"):
                ctx = Ctx(rng=random.Random(_seed(self.seed, e.name, "records")), fake=self._fake(e, "records"),
                          entity=e, ids=self.ids, rows=self.rows)
                self.rows[e.name] = hook.records(self.rows[e.name], ctx)
        return self.rows

    # ---- edge cases (mocks.edgeCases: plain sentences; the ones recognised are applied, the rest reported)

    def _mentioned(self, text: str) -> list[Entity]:
        low = text.lower()
        hits = []
        for e in self.entities:
            names = {e.name.lower(), e.plural.lower(), humanize(e.name).lower(), humanize(e.Plural).lower()}
            pos = min((low.find(n) for n in names if re.search(rf"\b{re.escape(n)}\b", low)), default=-1)
            if pos >= 0:
                hits.append((pos, e))
        return [e for _, e in sorted(hits, key=lambda h: h[0])]

    def apply_edge_cases(self) -> None:
        for case in self.edge_cases:
            low = case.lower()
            ents = self._mentioned(case)
            done = None
            m = re.search(r"\bone (\w+) with (\d+) (\w+)", low)
            if m and len(ents) >= 2:
                parent, child, n = ents[0], ents[1], int(m.group(2))
                ref = next((f for f in child.fields if f["type"] == "ref" and f.get("ref") == parent.name), None)
                rows = self.rows.get(child.name, [])
                if ref and parent.name in self.ids and rows:
                    star = self.ids[parent.name][0]
                    others = [i for i in self.ids[parent.name] if i != star] or [None]
                    rng = random.Random(_seed(self.seed, case))
                    for i, r in enumerate(rows):
                        if i < n:
                            r[ref["name"]] = star
                        elif r.get(ref["name"]) == star:
                            r[ref["name"]] = rng.choice(others)
                    done = f"{min(n, len(rows))} {child.plural} point at {parent.name} {star}" + (
                        f" (only {len(rows)} {child.plural}: raise mocks.counts.{child.name})" if len(rows) < n else "")
            elif re.search(r"long (\w+ )?(title|name)|very long", low):
                e = ents[0] if ents else self.entities[0]
                rows = self.rows.get(e.name, [])
                if rows:
                    title = e.title_field
                    words = ("An Extraordinarily Long " + humanize(e.name) + " Title That Keeps Going To Test How Cards, "
                             "Tables And Detail Pages Wrap Text Across Several Lines Without Breaking The Layout At All")
                    rows[1 % len(rows)][title] = words[:190]
                    done = f"{e.name} {rows[1 % len(rows)]['id']} has a {len(words[:190])}-character {title}"
            elif re.search(r"\b(no|missing|without)( an?)? (image|photo|picture)", low):
                e = next((x for x in ents if x.image_field), next((x for x in self.entities if x.image_field), None))
                if e and self.rows.get(e.name):
                    rows = self.rows[e.name]
                    for i in (2 % len(rows), 7 % len(rows)):
                        rows[i][e.image_field] = None
                    done = f"{e.name} records {rows[2 % len(rows)]['id']} and {rows[7 % len(rows)]['id']} have no {e.image_field}"
            elif re.search(r"\bempty\b|no results|nothing found", low):
                done = "a UI state: search for something that matches nothing (no data needed)"
            elif re.search(r"many pages|pagination|paging", low):
                e = ents[0] if ents else self.entities[0]
                n = len(self.rows.get(e.name, []))
                done = f"{e.name} has {n} records ({-(-n // 24)} pages of 24)" + ("; raise mocks.counts for more" if n < 72 else "")
            self.notes.append(f"{case}: {done}" if done else f"{case}: not generated (handle it in scripts/fixtures/<entity>.py)")


def _iso(t: dt.datetime) -> str:
    return t.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def svg_placeholder(seed: int) -> str:
    """A flat, low-saturation still life (a ground, a horizon, two shapes) and a small picture glyph: reads as 'a photo
    goes here' at any size, tells cards apart, and never competes with the design (no gradients, no saturated color:
    those read as AI filler; see ai/design-guidelines.md)."""
    rng = random.Random(seed)
    h = rng.random()

    def rgb(hh, s, v):
        r, g, b = colorsys.hsv_to_rgb(hh % 1, s, v)
        return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"
    ground, far, near = rgb(h, 0.07, 0.9), rgb(h + 0.04, 0.12, 0.78), rgb(h + 0.08, 0.16, 0.62)
    horizon = rng.randint(330, 420)
    cx, r = rng.randint(180, 620), rng.randint(60, 110)
    bx, bw, bh = rng.randint(80, 520), rng.randint(140, 220), rng.randint(90, 150)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">'
            f'<rect width="800" height="600" fill="{ground}"/>'
            f'<rect y="{horizon}" width="800" height="{600 - horizon}" fill="{far}"/>'
            f'<circle cx="{cx}" cy="{horizon - r - rng.randint(20, 80)}" r="{r}" fill="{far}"/>'
            f'<rect x="{bx}" y="{horizon - bh // 2}" width="{bw}" height="{bh}" fill="{near}"/>'
            f'<g transform="translate(752 552)" fill="none" stroke="{near}" stroke-width="3">'
            f'<rect x="-24" y="-18" width="48" height="36"/><path d="M-24 10 -8 -4 4 8 12 0 24 10"/></g></svg>\n')


def dump(rows: list[dict]) -> str:
    return json.dumps(rows, indent=2, ensure_ascii=False) + "\n"


def write_images(gen: Generator, e: Entity, writer) -> None:
    for base in IMAGE_DIRS:
        folder = base / e.plural
        keep = {name for name, _ in gen.images.get(e.plural, [])}
        if folder.exists():
            for old in folder.glob("*.svg"):
                if old.name not in keep:
                    writer.remove(old)
        for name, svg in gen.images.get(e.plural, []):
            writer.plain(folder / name, svg)
