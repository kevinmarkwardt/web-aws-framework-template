# Design guidelines (read before building directions)

These are the rules for design work in the playbook (steps 4 and 6). They come from published accessibility standards, from designers' write-ups of how AI-built interfaces go wrong, and from Kevin's review of the template's own theme (2026-10-11). Each source is linked at the end.

## AI tells: never ship these
- **Indigo or violet as the accent.** It traces back to Tailwind UI's `indigo-500` default. Purple-to-blue gradients, aurora glows and neon palettes with no dominant color belong here too.
- **The fallback clichés:** cream ground with terracotta or clay accent and a serif display face; near-black with an acid-green highlight. Banning the first defaults pushes agents straight to these.
- **Overused faces as the whole system:** Inter, Roboto or Arial for everything; Fraunces; Space Grotesk.
- **Emoji as icons**, a different colored accent bar on every card, and containers with a colored left border.
- **Cards nested in cards**; shadows and large radius on everything (keep radius at 0 to 10 px; pills only for chips).
- **Glassmorphism** where nothing real sits behind the blur.
- **The default page:** a centered hero, then three identical icon cards, then a gradient CTA. Vary section layouts, and align left on content pages.
- **Vague slogan copy** ("Build faster. Ship smarter."), and fake metrics, logos or testimonials. Missing facts become visible placeholders like `[YOUR PRICE]`.
- **Status dots everywhere** where a text label would say more; the same fade-up animation on every section.

## Standards (check every page)
- **Text contrast:** at least 4.5:1, or 3:1 at about 24 px (or 18.5 px bold). The usual failure is muted gray text: `muted` and `faint` must still pass on `surface`, `panel` and `raised`.
- **Non-text contrast:** 3:1 for input borders, focus rings and icons that carry meaning. Use `line-strong` for controls and `line` for dividers only.
- **Focus:** a visible 2 px focus ring with 3:1 contrast on every interactive element. Never remove the outline without a replacement.
- **Targets:** at least 24 × 24 px (WCAG 2.2 AA). Primary actions and touch layouts are 40 to 44 px tall.
- **Reading width:** body copy at 60 to 72 characters per line (`max-w-[68ch]`, or the `prose-body` utility).
- **Scales:** spacing from one scale (4, 8, 12, 16, 24, 32, 48, 64) and type from one scale. Round to the scale, never in between.
- **Numbers:** tabular numerals in tables and money (`tabular-nums`); right-align numeric columns.
- **States:** every list, form and page has its loading, empty, error and long-content states designed (the archetypes ship them; keep them styled).
- **Semantics:** real `<button>`, `<a href>` and `<label>`; `aria-label` on icon-only buttons; colors that must be told apart also differ in lightness.

## Color system
- **One accent**, chosen from the subject. Derive its 50 to 950 ramp in OKLCH by changing only lightness (`init.py` does this from `design.tokens.colors.accent`).
- **Neutrals** carry a slight tint toward the accent or the mood: OKLCH chroma 0.003 to 0.015. Never pure `#000` or `#fff` grounds.
- **Semantic colors** (ok, warn, danger) use the same lightness steps as the accent, with soft backgrounds for badges and notices.
- **Step rule:** two steps of one scale about five apart pass for small text; about four apart pass for icons and large text.

## Dark mode
- **Its own palette, never an inversion:** a ground around L 15 to 18% (not black), each raised surface a few percent lighter (elevation by lightness, since shadows barely show), and off-white text around L 94%.
- **Accents get lighter and less saturated** so they don't glow. Text on an accent button usually flips to dark.
- **Write both** `colors` and `colors.dark` in the spec, and check contrast in both themes.

## Type
- 1 to 3 families: a distinct display face, a body face that reads well small, optionally a mono for numbers and code.
- **Pairings in the template's directions:**
  - Geist with Geist Mono: precise, technical.
  - Newsreader with Instrument Sans: editorial, trustworthy.
  - IBM Plex Sans with Plex Mono: engineered.
- Prefer OFL fonts (Google Fonts, Fontsource). Satoshi and Switzer use the Fontshare license: check the terms first.

## Landing pages and motion
- **Template reference:** `frontend/src/pages/LandingPage.tsx`. The hero is split: the offer on the left, the product working on the right (`LiveMonitor`). Below it, sections keep a sticky text column next to small working demos instead of screenshots or icon grids (`pages/landing/demos.tsx`). Then come a details index, pricing from the API, FAQ and one closing call to action.
- **Demos show the product doing its job** with the site's own example data. Never use stats, logos or testimonials the site doesn't have.
- **Motion:**
  - `Reveal` eases content in once, as it scrolls into view.
  - Demos run only while on screen (`useLoop`).
  - Everything respects `prefers-reduced-motion`, so those visitors see the finished state.
  - Use one orchestrated entrance per section, not fade-up on every element.
- **The signed-in Home page** (`pages/dashboard/HomePage.tsx`) is where sign-up lands. It shows a getting-started checklist that hides itself when everything is done, the account at a glance, and alerts. Add the site's own first steps to its `steps` list.

## How directions differ
Three directions differ in **structure**, not only in palette: navigation model, home composition, density, cards vs lists vs ruled indexes, image weight. The template's examples (`/__directions`):
- **Instrument:** a tool. Search first, side filters, borders not shadows, dense, 6 px radius.
- **Broadsheet:** editorial. Ruled lines, a numbered index instead of cards, serif headlines, a reading column.
- **Grid:** Swiss and engineered. A visible grid with shared borders, mono labels, 2 px radius, color only for signals.

## Sources
- WCAG 2.2: [contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- [APCA introduction](https://github.com/Myndex/apca-introduction) (secondary check, especially for dark mode)
- [Line length](https://practicaltypography.com/line-length.html) (Practical Typography)
- [Accessible color systems](https://stripe.com/blog/accessible-color-systems) (Stripe)
- [OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) (Evil Martians)
- [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Dark mode principles](https://uxcel.com/blog/12-principles-of-dark-mode-design-627) (Uxcel)
- [7 tells that a UI is AI-generated](https://pages.thefountaininstitute.com/posts/7-tells-that-a-ui-is-ai-generated) (The Fountain Institute)
- [AI slop design tells](https://www.925studios.co/blog/ai-slop-design-tells) (925 Studios)
- [Why your AI keeps building the same purple gradient website](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
