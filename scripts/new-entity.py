#!/usr/bin/env python3
"""Generate everything for a site.spec.yaml entity, mocked in the browser first.

  python3 scripts/new-entity.py Recipe [Chef ...]     # one or more entities (name or plural)
  python3 scripts/new-entity.py --all                 # every entity in the spec
  python3 scripts/new-entity.py --backend Recipe      # later: make it real (API route, test, mock flag off)
  options: --spec path (default site.spec.yaml), --force (overwrite hand-edited files), --dry-run

Front end (per entity):
  packages/shared/src/contracts/<entity>.ts            the contract: TS type, field metadata, endpoint list
  packages/shared/src/mocks/fixtures/<plural>.json     mock data ([] until scripts/gen-fixtures.py fills it)
  packages/shared/src/mocks/mocks.config.ts            <plural>: true (answered by the browser mocks)
  frontend/src/entities/<plural>/                      api.ts, list + detail pages (+ form when owner is user|both)
  admin/src/tabs/entities/<Plural>Tab.tsx              the admin tab (table + drawer, CRUD), unless adminTab: false
  packages/shared/src/locales/*/entity-<plural>.json   texts (and admin-entity-<plural>.json), merged, never clobbered
  + the lists of all entities: contracts/all.gen.ts, frontend/src/entities/routes.gen.ts and paths.gen.ts (routes and
    nav), admin/src/tabs/entities.gen.ts (tab registrations)
--backend:
  api/routes/<plural>.py, api/routes/entity_routes.py, tests/test_entity_<plural>.py, the entity's filter parameters in
  cdk API_CACHE_QUERY_KEYS, and <plural>: false in mocks.config.ts. The pages don't change.

Idempotent: re-running rewrites generated files that nobody edited (they carry a hash), keeps hand-edited ones (and
says so; --force overwrites) and only adds missing text keys. Pages come from scripts/templates/entity/.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sitegen import ensure_deps  # noqa: E402

ensure_deps()

from sitegen import backend, entities as front  # noqa: E402
from sitegen import spec as specs  # noqa: E402
from sitegen.files import Writer  # noqa: E402


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("entities", nargs="*", help="entity names or plurals from the spec")
    ap.add_argument("--all", action="store_true", help="every entity in the spec")
    ap.add_argument("--backend", action="store_true", help="make the entities real (API route + contract test)")
    ap.add_argument("--spec", default=None, help="the spec (default: site.spec.yaml)")
    ap.add_argument("--force", action="store_true", help="overwrite generated files even when hand-edited")
    ap.add_argument("--dry-run", action="store_true", help="show what would change")
    args = ap.parse_args(argv)
    try:
        spec = specs.load_valid(args.spec)
        wanted = specs.entities(spec) if args.all else [specs.find_entity(spec, n) for n in args.entities]
    except specs.SpecError as e:
        print("\n".join(f"  - {p}" for p in e.problems), file=sys.stderr)
        return 1
    if not wanted:
        ap.error("name an entity, or pass --all")

    w = Writer(force=args.force, dry=args.dry_run, by="scripts/new-entity.py")
    for e in wanted:
        if args.backend:
            if not front.generated(e):
                print(f"{e.name}: generate it first (python3 scripts/new-entity.py {e.name})", file=sys.stderr)
                return 1
            backend.generate(w, spec, e)
        else:
            front.generate(w, spec, e)
    front.write_aggregators(w, spec)

    print(f"{'[dry run] ' if args.dry_run else ''}{'backend for' if args.backend else 'entities'}: "
          f"{', '.join(e.name for e in wanted)}")
    print(w.report())
    if w.kept:
        print(f"\n{len(w.kept)} hand-edited file(s) kept. Compare with a fresh copy (--dry-run --force shows the list) "
              "and merge by hand, or pass --force.")
    if args.backend:
        print("\nNext: .venv/bin/python -m pytest " + " ".join(f"tests/test_entity_{e.module}.py" for e in wanted)
              + "; then deploy. The pages now call the real API.")
    else:
        empty = [e for e in wanted if (front.FIXTURES / f"{e.plural}.json").read_text(encoding="utf-8").strip() == "[]"] if not args.dry_run else []
        if empty:
            print(f"\nNext: python3 scripts/gen-fixtures.py (mock data for {', '.join(e.name for e in empty)}), then "
                  "npm run dev and open the pages.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
