"""Shared code of the AI site-builder scripts (scripts/spec.py, init.py, new-entity.py, gen-fixtures.py): reading and
checking site.spec.yaml, entity naming, and writing generated files safely."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def ensure_deps() -> None:
    """The scripts need PyYAML, jsonschema and Faker (scripts/requirements.txt). Run with a Python that lacks them (the
    system python3), re-run under the repo's .venv when it has them; otherwise say how to install."""
    try:
        import jsonschema  # noqa: F401
        import yaml  # noqa: F401
    except ImportError:
        venv = ROOT / ".venv" / "bin" / "python"
        if venv.exists() and Path(sys.executable).resolve() != venv.resolve() and not os.environ.get("SITEGEN_REEXEC"):
            os.environ["SITEGEN_REEXEC"] = "1"
            os.execv(str(venv), [str(venv), *sys.argv])
        sys.exit("Missing PyYAML / jsonschema. Install the tooling once:\n"
                 "  python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt")
