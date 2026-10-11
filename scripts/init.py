#!/usr/bin/env python3
"""Apply site.spec.yaml to the template (non-interactive; scripts/init.sh is the interactive way in).

  python3 scripts/init.py --spec site.spec.yaml                 # the whole site: identity, modules, config
  python3 scripts/init.py --spec site.spec.yaml --design-only   # the same, but keeps the Items example (design phase)
  python3 scripts/init.py --spec site.spec.yaml --apply-design  # only design.tokens -> theme.css (+ fonts)
  add --dry-run to see what would change.

Idempotent: run it again after changing the spec; files already right are left alone. What it does:
  - placeholders everywhere (yourapp -> site.name, YourApp -> displayName, yourapp.com -> domain,
    YOUR_AWS_ACCOUNT_ID -> awsAccountId when given) and cdk/bin/yourapp.ts, cdk/lib/yourapp-stack.ts renamed
  - api/site.json (plans, packs, creditName, creditCosts, signupGift, regions, support; read by api/lib/config.py) and
    packages/shared/src/site.generated.ts (name, domain, billing mode, support, for both sites)
  - packages/shared/src/i18n/languages.ts from modules.i18n.languages; a new language gets locales/<lang>/ and
    api/locales/<lang>.json as English copies to translate
  - cdk/cdk.json context: billingMode, adminEmail, region, googleTags
  - frontend/.env.production: VITE_GA4_ID, VITE_ADSENSE_CLIENT, VITE_CONSENT_REGIONS (modules.googleTags)
  - when the spec has entities (not with --design-only): removes the built-in Items example's pages, admin tab, nav
    entries and texts (the backend example api/routes/items.py stays: it is the plan-limit reference)
  - --apply-design: design.tokens -> the token blocks of packages/shared/src/theme.css (colors incl. dark, fonts,
    radius, density; scripts/sitegen/design.py has the mapping), font packages or links
Changing site.name after the first run is manual (init refuses).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sitegen import ensure_deps  # noqa: E402

ensure_deps()

from sitegen import init_site  # noqa: E402
from sitegen import spec as specs  # noqa: E402
from sitegen.files import Writer  # noqa: E402


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--spec", default=None, help="the spec (default: site.spec.yaml)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--design-only", action="store_true", help="keep the Items example (design phase)")
    mode.add_argument("--apply-design", action="store_true", help="only write design.tokens into theme.css")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verbose", action="store_true", help="list every file")
    args = ap.parse_args(argv)
    try:
        spec = specs.load_valid(args.spec)
    except specs.SpecError as e:
        print("\n".join(f"  - {p}" for p in e.problems), file=sys.stderr)
        return 1
    w = Writer(dry=args.dry_run, by="scripts/init.py")
    try:
        notes = init_site.run(spec, w, design_only=args.design_only, apply_design=args.apply_design)
    except init_site.InitError as e:
        print(f"init.py: {e}", file=sys.stderr)
        return 1
    changed = [(s, p) for s, p in w.log if s not in ("unchanged", "exists")]
    what = "design tokens" if args.apply_design else f"{spec['site']['displayName']} ({spec['site']['name']})"
    print(f"{'[dry run] ' if args.dry_run else ''}init: {what}: {len(changed)} change(s)")
    shown = changed if args.verbose else changed[:25]
    for s, p in shown:
        print(f"  {s:<10} {p}")
    if len(changed) > len(shown):
        print(f"  ... and {len(changed) - len(shown)} more (--verbose lists them)")
    for n in notes:
        print(f"note: {n}")
    if not args.apply_design and not args.dry_run:
        print("\nNext: npm install (package names changed), python3 scripts/new-entity.py --all, "
              "python3 scripts/gen-fixtures.py, scripts/verify.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
