#!/usr/bin/env python3
"""Check or summarize a site spec (ai/site.spec.schema.json: the single source of truth for a site).

  python3 scripts/spec.py validate [site.spec.yaml]   # schema + cross-field checks; exit 1 with the problems
  python3 scripts/spec.py summary  [site.spec.yaml]   # a short readable overview (validates first)

Cross-field checks: entity and field names unique, ref targets exist, enum fields have values, page entities exist (and
detail paths have :id), billing fields match the billing mode, mock counts name entities, design colors are colors.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sitegen import ensure_deps  # noqa: E402

ensure_deps()

from sitegen import spec as specs  # noqa: E402


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("validate", "summary"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    path = argv[1] if len(argv) > 1 else None
    try:
        spec = specs.load_valid(path)
    except specs.SpecError as e:
        print(f"{path or 'site.spec.yaml'}: {len(e.problems)} problem(s)", file=sys.stderr)
        for p in e.problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    if argv[0] == "summary":
        print(specs.summary(spec))
    else:
        print(f"{path or 'site.spec.yaml'}: ok ({len(spec.get('entities') or [])} entities, {len(spec.get('pages') or [])} pages)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
