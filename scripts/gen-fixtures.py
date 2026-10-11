#!/usr/bin/env python3
"""Mock data for the browser mocks, from site.spec.yaml (`mocks.seed`, `mocks.counts`, `mocks.edgeCases`).

  python3 scripts/gen-fixtures.py                  # every entity -> packages/shared/src/mocks/fixtures/<plural>.json
  python3 scripts/gen-fixtures.py --entity Recipe  # just one (the others are generated in memory for valid refs)
  python3 scripts/gen-fixtures.py --sample 5       # also print 5 records per entity (show the user)
  options: --spec path, --dry-run

Deterministic: the same spec gives the same files. Values follow each field's type, name and hint; enums and refs are
skewed; dates lean recent; images are local SVG placeholders (frontend/public/mock-images/, admin/public/mock-images/).
Edge cases written as plain sentences are applied when recognised ("one chef with 20 recipes", "recipe with very long
title", "recipe with no image", "empty search result", "many pages") and listed either way. Domain-specific realism goes
in scripts/fixtures/<entity>.py (see scripts/sitegen/fixtures.py for the hooks). A changed fixture reseeds every
browser's mock store on its next load.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sitegen import ensure_deps  # noqa: E402

ensure_deps()

from sitegen import fixtures as fx  # noqa: E402
from sitegen import spec as specs  # noqa: E402
from sitegen.files import Writer  # noqa: E402


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--entity", action="append", default=[], help="only this entity (repeatable)")
    ap.add_argument("--spec", default=None)
    ap.add_argument("--sample", type=int, default=0, help="print N records per entity")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    try:
        spec = specs.load_valid(args.spec)
        wanted = [specs.find_entity(spec, n) for n in args.entity] if args.entity else specs.entities(spec)
    except specs.SpecError as e:
        print("\n".join(f"  - {p}" for p in e.problems), file=sys.stderr)
        return 1
    try:
        gen = fx.Generator(spec)
    except ImportError:
        print("Faker is missing: .venv/bin/pip install -r scripts/requirements.txt", file=sys.stderr)
        return 1
    rows = gen.generate()
    w = Writer(dry=args.dry_run, by="scripts/gen-fixtures.py")
    for e in wanted:
        w.plain(fx.FIXTURES / f"{e.plural}.json", fx.dump(rows[e.name]))
        fx.write_images(gen, e, w)
    print(f"{'[dry run] ' if args.dry_run else ''}fixtures (seed {gen.seed}): "
          + ", ".join(f"{e.name} {len(rows[e.name])}" for e in wanted))
    images = [(s, p) for s, p in w.log if "/mock-images/" in p]
    w.log = [(s, p) for s, p in w.log if "/mock-images/" not in p]
    print(w.report())
    changed = [s for s, _ in images if s != "unchanged"]
    if images:
        print(f"  placeholder images: {len(images) // 2} per site in {{frontend,admin}}/public/mock-images/"
              + (f" ({len(changed)} file(s) written or removed)" if changed else " (up to date)"))
    if gen.notes:
        print("edge cases:\n" + "\n".join(f"  - {n}" for n in gen.notes))
    if args.sample:
        for e in wanted:
            print(f"\n{e.name} (first {args.sample} of {len(rows[e.name])}):")
            for r in rows[e.name][:args.sample]:
                print("  " + json.dumps({k: v for k, v in r.items() if k not in ("createdAt", "updatedAt")}, ensure_ascii=False)[:300])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
