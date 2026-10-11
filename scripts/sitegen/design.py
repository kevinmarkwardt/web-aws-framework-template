"""scripts/init.py --apply-design: site.spec.yaml design.tokens -> packages/shared/src/theme.css.

theme.css keeps its source variables in two marked blocks, and only those are written (one `--name: value;` per line;
variables not set by the spec are kept):

    :root { /* tokens:begin */ --brand-600: ...; --ink: ...; ... /* tokens:end */ }
    ... { /* dark:begin */ ... /* dark:end */ }           (dark mode: the spec's colors.dark)

The `@theme inline` block that maps them to Tailwind utilities (bg-brand-600, text-ink, font-display, rounded-card...)
is never touched. Spec -> variables:
    colors  bg->--surface  surface->--panel  ink->--ink  muted->--muted (+--faint)  line->--line (+--raised)
            accent->--brand-50..950 (an OKLCH lightness ramp with the accent at 600)  accentInk->--brand-ink
            danger->--danger (+--danger-soft)  success->--ok (+--ok-soft)
    fonts   display/body/mono -> --typeface-display/-body/-mono (self-hosted @fontsource-variable packages for the
            fonts in FONTSOURCE_VARIABLE; others get a Google Fonts <link> in both index.html, which the CSP must allow)
    radius  none|sm|md|lg|full -> --corner-card, --corner-control
    density compact|comfortable|airy -> --density (0.85 / 1 / 1.2)
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

from . import ROOT

THEME = ROOT / "packages" / "shared" / "src" / "theme.css"
FONTS_TS = ROOT / "packages" / "shared" / "src" / "fonts.generated.ts"
SHARED_PKG = ROOT / "packages" / "shared" / "package.json"
INDEX_HTML = [ROOT / "frontend" / "index.html", ROOT / "admin" / "index.html"]

BRAND_STEPS = (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950)
RADIUS = {"none": ("0", "0"), "sm": ("0.375rem", "0.25rem"), "md": ("0.75rem", "0.5rem"), "lg": ("1rem", "0.75rem"),
          "full": ("1.5rem", "9999px")}
DENSITY = {"compact": "0.85", "comfortable": "1", "airy": "1.2"}
# Google fonts published as @fontsource-variable packages (self-hosted: nothing for the CSP to allow)
FONTSOURCE_VARIABLE = {
    "Inter", "Fraunces", "Roboto Flex", "Open Sans", "Montserrat", "Playfair Display", "DM Sans", "Manrope",
    "Source Serif 4", "Lora", "Work Sans", "Nunito", "Raleway", "Space Grotesk", "JetBrains Mono", "Outfit",
    "Plus Jakarta Sans", "Figtree", "Onest", "Recursive", "Literata", "Newsreader", "Bricolage Grotesque",
    "Instrument Sans", "Geist", "Geist Mono", "IBM Plex Sans", "Public Sans", "Rubik", "Karla", "Sora", "Urbanist",
    "Lexend", "Merriweather", "EB Garamond", "Cormorant", "Crimson Pro", "Bitter", "Roboto Slab", "Roboto Mono",
    "Fira Code", "Source Code Pro", "Archivo", "Red Hat Display", "Albert Sans", "Hanken Grotesk", "Schibsted Grotesk",
}
SERIF = re.compile(r"serif|fraunces|playfair|lora|merriweather|garamond|cormorant|crimson|bitter|slab|literata|"
                   r"newsreader|baskerville|caslon|spectral|libre|dm serif|source serif", re.I)
FALLBACK = {"sans": "ui-sans-serif, system-ui, sans-serif", "serif": "ui-serif, Georgia, serif",
            "mono": "ui-monospace, SFMono-Regular, Menlo, monospace"}


# ---- color math: sRGB hex -> OKLCH (https://bottosson.github.io/posts/oklab/)

def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_oklch(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.strip().lstrip("#")
    if len(h) in (3, 4):
        h = "".join(ch * 2 for ch in h[:3])
    r, g, b = (_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    l_ = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m_ = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    C = math.hypot(A, B)
    H = math.degrees(math.atan2(B, A)) % 360
    return L, C, H


def oklch(L: float, C: float, H: float) -> str:
    return f"oklch({L * 100:.1f}% {C:.3f} {H:.1f})"


def brand_scale(color: str) -> dict[str, str]:
    """--brand-50..950 around `color` (at 600): lightness steps toward white above it and toward ink below it, with less
    chroma at the light end."""
    if not color.startswith("#"):
        # an oklch()/rgb() accent: use it at 600 and mix the rest (browsers do the math)
        mix = {50: ("white", 92), 100: ("white", 84), 200: ("white", 68), 300: ("white", 50), 400: ("white", 32),
               500: ("white", 15), 700: ("black", 14), 800: ("black", 28), 900: ("black", 42), 950: ("black", 58)}
        out = {f"--brand-{s}": f"color-mix(in oklch, {color}, {mix[s][0]} {mix[s][1]}%)" for s in mix}
        out["--brand-600"] = color
        return dict(sorted(out.items(), key=lambda kv: int(kv[0].rsplit("-", 1)[1])))
    L, C, H = hex_to_oklch(color)
    top, bottom = 0.975, max(0.2, min(L - 0.25, 0.3))
    light = {50: 0.0, 100: 0.12, 200: 0.28, 300: 0.48, 400: 0.68, 500: 0.85}  # share of the way from top to L
    dark = {700: 0.22, 800: 0.45, 900: 0.68, 950: 1.0}                       # share of the way from L to bottom
    out = {}
    for s in BRAND_STEPS:
        if s == 600:
            l_, c_ = L, C
        elif s < 600:
            l_ = top + (L - top) * light[s]
            c_ = C * (0.12 + 0.88 * light[s] ** 1.3)
        else:
            l_ = L + (bottom - L) * dark[s]
            c_ = C * (1 - 0.35 * dark[s])
        out[f"--brand-{s}"] = oklch(l_, c_, H)
    return out


def _mix(a: str, b: str, pct: int) -> str:
    return f"color-mix(in oklch, {a} {pct}%, {b})"


def dark_brand_scale(color: str, ground: str) -> dict[str, str]:
    """--brand-50..950 for dark mode. The roles stay the same, so the direction flips: the soft steps (50-200, chip and
    badge backgrounds) sink toward the dark ground, and the text steps (700+, links and selected text) get lighter than
    the accent, never darker."""
    toward_ground = {50: 18, 100: 26, 200: 40, 300: 58, 400: 76, 500: 90}   # % of the accent kept, rest is ground
    toward_white = {700: 82, 800: 70, 900: 58, 950: 46}                     # % of the accent kept, rest is white
    out = {f"--brand-{s}": _mix(color, ground, p) for s, p in toward_ground.items()}
    out["--brand-600"] = color
    out.update({f"--brand-{s}": _mix(color, "white", p) for s, p in toward_white.items()})
    return dict(sorted(out.items(), key=lambda kv: int(kv[0].rsplit("-", 1)[1])))


def color_vars(colors: dict, dark: bool = False) -> dict[str, str]:
    """The spec's semantic colors (one mode) -> theme variables."""
    out: dict[str, str] = {}
    bg, panel = colors.get("bg"), colors.get("surface")
    if bg:
        out["--surface"] = bg
    if panel:
        out["--panel"] = panel
    if colors.get("ink"):
        out["--ink"] = colors["ink"]
        out["--chrome"] = colors["ink"]
        if panel or bg:
            out["--raised"] = _mix(colors["ink"], panel or bg, 5)
    if colors.get("muted"):
        out["--muted"] = colors["muted"]
        out["--faint"] = _mix(colors["muted"], bg or panel or "white", 72)
    if colors.get("line"):
        out["--line"] = colors["line"]
        # control borders need 3:1 against the page (WCAG 1.4.11): the line pulled toward the ink
        if colors.get("ink"):
            out["--line-strong"] = _mix(colors["ink"], colors["line"], 30)
    if colors.get("accent"):
        out.update(dark_brand_scale(colors["accent"], bg or panel or "black") if dark else brand_scale(colors["accent"]))
    if colors.get("accentInk"):
        out["--brand-ink"] = colors["accentInk"]
    if colors.get("danger"):
        out["--danger"] = colors["danger"]
        out["--danger-soft"] = _mix(colors["danger"], panel or bg or "white", 10)
    if colors.get("success"):
        out["--ok"] = colors["success"]
        out["--ok-soft"] = _mix(colors["success"], panel or bg or "white", 10)
    return out


def font_family(name: str, role: str) -> tuple[str, str]:
    """(CSS family list, how it loads: 'fontsource' | 'google')."""
    kind = "mono" if role == "mono" or re.search(r"mono|code", name, re.I) else ("serif" if SERIF.search(name) else "sans")
    if name in FONTSOURCE_VARIABLE:
        return f"'{name} Variable', {FALLBACK[kind]}", "fontsource"
    return f"'{name}', {FALLBACK[kind]}", "google"


def token_vars(tokens: dict) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """(light variables, dark variables, fonts: family -> 'fontsource' | 'google')."""
    light, dark, fonts = {}, {}, {}
    colors = dict(tokens.get("colors") or {})
    dark_colors = colors.pop("dark", None) or {}
    light.update(color_vars(colors))
    dark.update(color_vars(dark_colors, dark=True))
    for role, name in (tokens.get("fonts") or {}).items():
        family, how = font_family(name, role)
        light[f"--typeface-{role}"] = family
        fonts[name] = how
    if tokens.get("radius"):
        card, control = RADIUS[tokens["radius"]]
        light["--corner-card"], light["--corner-control"] = card, control
    if tokens.get("density"):
        light["--density"] = DENSITY[tokens["density"]]
    return light, dark, fonts


class MarkersMissing(Exception):
    pass


def write_block(css: str, block: str, values: dict[str, str]) -> str:
    """Set `values` inside every /* {block}:begin */ ... /* {block}:end */ (others kept, new ones appended).
    theme.css repeats the dark block (OS dark mode, and data-theme="dark"), so all copies are written."""
    matches = list(re.finditer(rf"(/\*\s*{block}:begin\s*\*/)(.*?)([ \t]*/\*\s*{block}:end\s*\*/)", css, re.S))
    if not matches:
        raise MarkersMissing(f"/* {block}:begin */ ... /* {block}:end */ not found")
    for m in reversed(matches):
        css = _write_one(css, m, values)
    return css


def _write_one(css: str, m: re.Match, values: dict[str, str]) -> str:
    body = m.group(2)
    indent = re.search(r"\n([ \t]*)--", body)
    pad = indent.group(1) if indent else "  "
    done = set()

    def repl(dm: re.Match) -> str:
        name = dm.group(2)
        if name in values:
            done.add(name)
            return f"{dm.group(1)}{name}: {values[name]};"
        return dm.group(0)
    body = re.sub(r"(^[ \t]*)(--[\w-]+)\s*:[^;]*;", repl, body, flags=re.M)
    extra = [n for n in values if n not in done]
    if extra:
        body = body.rstrip() + "".join(f"\n{pad}{n}: {values[n]};" for n in extra) + "\n"
    return css[:m.start(2)] + body + css[m.end(2):]


def apply_theme(css: str, tokens: dict) -> str:
    light, dark, _ = token_vars(tokens)
    if light:
        css = write_block(css, "tokens", light)
    if dark:
        css = write_block(css, "dark", dark)
    return css


def fonts_ts(fonts: dict[str, str]) -> str:
    lines = ["// Written by scripts/init.py --apply-design from site.spec.yaml design.tokens.fonts: the self-hosted font packages",
             "// (@fontsource-variable/*, dependencies of packages/shared) both sites load. Don't edit: change the spec and re-run."]
    pkgs = [package_of(n) for n, how in sorted(fonts.items()) if how == "fontsource"]
    lines += [f"import '{p}';" for p in pkgs] or ["export {};"]
    return "\n".join(lines) + "\n"


def package_of(name: str) -> str:
    return "@fontsource-variable/" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def google_link(fonts: dict[str, str]) -> str:
    names = [n for n, how in sorted(fonts.items()) if how == "google"]
    if not names:
        return ""
    fam = "&".join("family=" + n.replace(" ", "+") + ":wght@400;500;600;700" for n in names)
    return (f'    <link rel="preconnect" href="https://fonts.googleapis.com" />\n'
            f'    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
            f'    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?{fam}&display=swap" />\n')


def write_index_fonts(html: str, link: str) -> str:
    m = re.search(r"(<!-- fonts:begin[^>]*-->\n)(.*?)([ \t]*<!-- fonts:end -->)", html, re.S)
    if not m:
        return html
    return html[:m.start(2)] + link + html[m.end(2):]


def package_json_with_fonts(text: str, fonts: dict[str, str], version: str = "^5.0.0") -> str:
    pkg = json.loads(text)
    deps = pkg.setdefault("dependencies", {})
    for k in [k for k in deps if k.startswith("@fontsource-variable/")]:
        del deps[k]
    for n, how in fonts.items():
        if how == "fontsource":
            deps[package_of(n)] = version
    pkg["dependencies"] = dict(sorted(deps.items()))
    return json.dumps(pkg, indent=2) + "\n"


def apply(writer, tokens: dict) -> list[str]:
    """Write the theme, fonts module, package.json and index.html font links. Returns notes for the user."""
    notes = []
    _, _, fonts = token_vars(tokens)
    css = THEME.read_text(encoding="utf-8")
    try:
        writer.plain(THEME, apply_theme(css, tokens))
    except MarkersMissing as e:
        raise SystemExit(f"{THEME}: {e}. theme.css needs the token markers (the design-system version of the file).") from None
    writer.plain(FONTS_TS, fonts_ts(fonts))
    old_pkg = SHARED_PKG.read_text(encoding="utf-8")
    new_pkg = package_json_with_fonts(old_pkg, fonts)
    if json.loads(new_pkg) != json.loads(old_pkg):
        writer.plain(SHARED_PKG, new_pkg)
        notes.append("font packages changed in packages/shared/package.json: run npm install")
    link = google_link(fonts)
    for path in INDEX_HTML:
        if path.exists():
            writer.plain(path, write_index_fonts(path.read_text(encoding="utf-8"), link))
    if link:
        notes.append("Google Fonts <link> added to both index.html: allow https://fonts.googleapis.com (style-src) and "
                     "https://fonts.gstatic.com (font-src) in the stack's CSP (siteCsp), or self-host the font instead")
    return notes
