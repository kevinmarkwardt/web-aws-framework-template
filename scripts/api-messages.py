#!/usr/bin/env python3
"""The API's customer-facing messages, for translation (CLAUDE.md, "i18n").

Finds every message the API can send a customer: string literals passed to response.error / not_found / forbidden /
unauthorized / unavailable, raised as errors (`raise XError("...")`, `params.BadRequest("...")`), and templates passed
to i18n.t(...). f-strings can't be looked up: they are listed separately so they can be turned into
t("... {name} ...", name=...) templates. The admin API (admin_handler.py, routes/admin.py, lib/admins.py) is
English-only and left out.

  scripts/api-messages.py            # list the messages (one per line)
  scripts/api-messages.py --fstrings # f-string messages still to convert
  scripts/api-messages.py --missing  # messages missing from each api/locales/*.json
  scripts/api-messages.py --write-en # rewrite api/locales/en.json (every message, value = key)
"""

from __future__ import annotations

import ast
import builtins
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = ROOT / "api"
LOCALES = API / "locales"
CALLS = {"error", "not_found", "forbidden", "unauthorized", "unavailable", "t", "Text"}  # response.*, i18n.t / Text
ADMIN_ONLY = {API / "admin_handler.py", API / "routes" / "admin.py", API / "lib" / "admins.py"}


def _name(node: ast.Call) -> str:
    f = node.func
    return f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else ""


def _is_message_call(node: ast.Call) -> bool:
    """response.* / i18n.t / Text, or the API's own errors (built-in ones like ValueError are for developers)."""
    name = _name(node)
    f = node.func
    if isinstance(f, ast.Attribute) and (
            (isinstance(f.value, ast.Name) and f.value.id in ("log", "logger", "logging"))
            or (isinstance(f.value, ast.Call) and _name(f.value) == "getLogger")):
        return False  # log.error(...)
    return name in CALLS or (name.endswith("Error") and not hasattr(builtins, name)) or name in ("BadRequest", "Invalid")


def scan() -> tuple[set[str], list[str]]:
    messages, fstrings = set(), []
    for path in sorted(API.rglob("*.py")):
        if path in ADMIN_ONLY or "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and _is_message_call(node) and node.args):
                continue
            arg = node.args[0]
            # "a" if x else "b": both are messages
            options = [arg.body, arg.orelse] if isinstance(arg, ast.IfExp) else [arg]
            for a in options:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) and len(a.value) > 3 and (" " in a.value or _name(node) in ("t", "Text")):
                    messages.add(a.value)
            if isinstance(arg, ast.JoinedStr):
                fstrings.append(f"{path.relative_to(ROOT)}:{node.lineno}: {ast.unparse(arg)[:140]}")
    return messages, fstrings


def main() -> None:
    messages, fstrings = scan()
    if "--fstrings" in sys.argv:
        print("\n".join(fstrings))
    elif "--missing" in sys.argv:
        for f in sorted(LOCALES.glob("*.json")):
            have = json.loads(f.read_text(encoding="utf-8"))
            missing = sorted(messages - set(have))
            print(f"{f.name}: {len(missing)} missing, {len(set(have) - messages)} unused")
            for m in missing:
                print(f"  {m}")
    elif "--write-en" in sys.argv:
        (LOCALES / "en.json").write_text(json.dumps({m: m for m in sorted(messages)}, ensure_ascii=False, indent=2) + "\n",
                                         encoding="utf-8")
        print(f"api/locales/en.json: {len(messages)} messages")
    else:
        print("\n".join(sorted(messages)))


if __name__ == "__main__":
    main()
