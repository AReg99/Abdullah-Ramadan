# 10 — Design system & brand

The app's interface is built so that **Aura's brand lives in one file**. Every
colour, type and shape decision in five applications, the printed documents and
the customer tracking page resolves through that file. Applying the real Aura
identity is a token swap, not a redesign.

Until the brand assets arrive, the system runs on clearly-marked placeholders.
Section 9 lists exactly what is needed and where each piece lands.

---

## 1. Three tiers of tokens

The rule: **components never reference a brand token directly.** They reference a
semantic role, which resolves to a brand value. This is what makes the swap safe.

```
TIER 1 — BRAND            TIER 2 — SEMANTIC             TIER 3 — COMPONENT
the identity              the role in the interface     the specific use
────────────────          ─────────────────────         ──────────────────
--brand-primary      →    --accent                 →    --btn-primary-bg
--brand-primary-ink  →    --accent-on              →    --btn-primary-fg
--brand-neutral-0    →    --ground                 →    --page-bg
--brand-neutral-1    →    --surface                →    --card-bg
--brand-neutral-9    →    --ink                    →    --body-fg
--brand-font-display →    --font-heading           →    --h1-family
```

Only **tier 1** changes when Aura's brand is applied. Tiers 2 and 3 are the
system and stay fixed.

A component that hard-codes `#A67C3D` instead of `var(--accent)` is a bug, and a
CI lint rule fails the build on any raw hex outside `brand.json`.

## 2. The one file

`packages/design-tokens/brand.json` — the entire identity surface:

```jsonc
{
  "color": {
    "primary":        "#______",   // the main brand colour
    "primaryInk":     "#______",   // text/icons ON primary — must pass 4.5:1
    "primaryMuted":   "#______",   // 10–15% tint, for selected rows and chips
    "secondary":      "#______",   // optional supporting colour
    "neutral": {
      "0": "#______",  // page ground, light theme
      "1": "#______",  // card surface
      "2": "#______",  // secondary surface, table header
      "3": "#______",  // hairline rules
      "6": "#______",  // muted text
      "9": "#______"   // body text / near-black
    },
    "neutralDark": { "0":"#______", "1":"#______", "2":"#______",
                     "3":"#______", "6":"#______", "9":"#______" }
  },
  "font": {
    "displayLatin": "____",  "bodyLatin":  "____",
    "displayArabic":"____",  "bodyArabic": "____",
    "mono":         "____"
  },
  "shape": { "radius": "2px", "radiusLarge": "6px", "borderWidth": "1px" },
  "logo":  { "wordmark":"…", "monogram":"…", "reversed":"…", "mono":"…" }
}
```

**Status colours are deliberately not brand colours.** Green-pass, amber-risk and
red-late must read as status regardless of what Aura's accent turns out to be. If
the brand primary happens to be red, the "late" red shifts hue until the two are
unmistakably different — status legibility wins over brand consistency, because a
supervisor misreading a late order is a real cost.

## 3. Colour roles

| Semantic token | Job | Contrast requirement |
| --- | --- | --- |
| `--ground` / `--surface` | Page and card backgrounds | — |
| `--ink` / `--ink-muted` | Body and secondary text | 7:1 / 4.5:1 on surface |
| `--rule` | Hairlines, table borders, dividers | 3:1 against surface |
| `--accent` | Primary actions, active nav, focus, selected state | 4.5:1 against ground |
| `--accent-on` | Text and icons sitting on the accent | 4.5:1 against accent |
| `--accent-muted` | Selected rows, active chips, quiet fills | — |
| `--ok` `--warn` `--danger` | Passed / at-risk / late & failed | 4.5:1, and visibly distinct from `--accent` |
| `--ok-soft` `--warn-soft` `--danger-soft` | Status pill backgrounds | — |

**Both themes are designed, not inverted.** Dark mode redefines only tier 1's
neutral ramp and lifts the accent's lightness so it still holds 4.5:1 on a dark
ground. Every colour is defined at `:root` first; nothing gets its only
definition inside a media query.

**Status is never colour alone.** Every state carries a shape or a word as well —
a pill with a label, an icon, a left border. Colour-blind users and workers
glancing at a screen across a dusty workshop both need the redundancy.

## 4. Typography

Two script families, paired deliberately. See doc 09 for the Arabic rules.

| Role | Latin | Arabic | Notes |
| --- | --- | --- | --- |
| Display / headings | brand display face | brand Arabic display, weight 600 | Arabic never letter-spaced |
| Body / UI | brand body face | brand Arabic body, weight 400 | Arabic line-height 1.85 vs Latin 1.65 |
| Data, codes, serials | mono | mono for digits, Arabic face for words | always `tabular-nums` |

**Scale** — one scale, no improvised sizes:

```
display  32 / 1.1     h1  26 / 1.2     h2  21 / 1.25    h3  17 / 1.35
body     15 / 1.65    small 13 / 1.55  micro 11 / 1.45  (uppercase labels, Latin only)
floor    19 / 1.5     — the worker, QC and driver apps step the whole scale up
```

If a brand font has no Arabic cut, the Arabic face is chosen to match its
*weight and width*, not its style. A geometric Latin display paired with a
humanist Arabic reads as two brands on one page.

## 5. Space, shape, elevation

- **4 px base unit.** Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64. Nothing else.
- **Layout by grid and `gap`**, never per-element margins — this is what keeps RTL
  from drifting.
- **Logical properties only** — `padding-inline-start`, never `padding-left`.
- **Radius** comes from the brand: sharp (2 px) reads precise and technical, soft
  (8 px+) reads residential and warm. This single value changes the app's
  character more than any other shape decision.
- **Elevation is restrained**: a hairline for most surfaces, one soft shadow for
  things that genuinely float (modals, the scan sheet, dropdowns). Factory
  screens are viewed at an angle in bad light — heavy shadows muddy them.

## 6. Two density modes

The same components, two presets, selected per application:

| | **Floor** — worker, QC, store, driver | **Office** — owner, factory, showroom, accounts |
| --- | --- | --- |
| Base type | 19 px | 15 px |
| Minimum touch target | **56 px** | 40 px |
| Row height | 72 px | 44 px |
| Fields per screen | 1–3 | as many as fit |
| Primary action | full-width, fixed to the bottom | inline, right-aligned |

The floor preset assumes dusty hands, gloves, bad light and a phone held at
arm's length. It is not "the same UI, bigger" — it is fewer things per screen.

## 7. Component inventory

Every component ships with all states: `default · hover · focus-visible · active ·
selected · disabled · loading · empty · error`, in both themes and both scripts.

**Primitives** — button (primary, secondary, quiet, destructive), icon button,
input, number stepper, select, combobox, date and slot picker, checkbox, radio,
switch, textarea, file/photo upload, signature pad.

**Data** — table (sortable, sticky header, horizontal scroll), data row, stat
tile, status pill, progress stepper, timeline entry, empty state, skeleton.

**Domain-specific** — these carry the product:

| Component | Where it appears |
| --- | --- |
| **Job card** | The worker's screen: drawing, spec, materials, timer, three actions |
| **Scan sheet** | Full-screen camera with a result state |
| **Stage rail** | Horizontal production progress, mirrored in Arabic |
| **Option picker** | Swatch grid with live price and lead-time footer |
| **Capacity bar** | Booked vs available minutes, green/amber/red |
| **Order timeline** | Event, actor, time, photos |
| **Alert row** | Status pill + the dominant cause, never a bare flag |
| **Approval card** | The ask, the number, approve/reject with reason |
| **Blocked-reason sheet** | The fixed nine-item list, large targets |
| **Signature pad** | Draw, clear, confirm — with the document above it |

## 8. Icons, motion, accessibility

**Icons** — one set, 1.5 px stroke, 24 px grid, drawn to match the brand's
weight. Mirror in RTL: back, forward, next, previous, indent, reply, trending,
list-order, chevrons in navigation. Never mirror: clock, search, media controls,
checkmark, warning triangle, camera, QR, brand marks.

**Motion** — 150 ms for state changes, 250 ms for surfaces entering, one easing
curve. No decorative animation anywhere in the operational apps: a worker seeing
a spinner for a scan that already succeeded taps twice. Everything respects
`prefers-reduced-motion`.

**Accessibility** — 4.5:1 minimum on all text; a visible focus ring on every
interactive element (2 px accent, 3 px offset); 56 px targets on floor apps;
semantic HTML with ARIA only where semantics run out; every icon-only button
labelled in both languages; full keyboard operation of the office apps, since
that is how a fast accountant works.

---

## 9. The logo system

Aura's mark needs to work in nine places, at sizes from 16 px to a printed A4
header. That requires more than one file.

### What is needed

| Asset | Format | Used for |
| --- | --- | --- |
| **Primary wordmark** | SVG, horizontal | App headers, quotation and invoice headers, the tracking page |
| **Monogram / symbol** | SVG, square | App icon, favicon, avatar, unit-label header, tight spaces |
| **Reversed** | SVG, white/light | Dark theme, dark showroom collateral |
| **Mono** | SVG, single colour | Thermal label printing, faxed and photocopied documents, embossing |
| App icon | 1024 × 1024 PNG | iOS and Android stores, derived from the monogram |
| Favicon | SVG + 32 px PNG | Browser tabs |

### Placement rules

- **App header** — wordmark at 20 px height, aligned to the inline start (left in
  English, **right in Arabic**), with the screen title beside it. It never
  competes with the screen's own heading.
- **Clear space** — the height of the mark's own cap height on all four sides.
  Nothing enters that box.
- **Minimum sizes** — wordmark 90 px wide on screen, 20 mm in print; below that,
  the monogram.
- **Splash screen** — monogram centred on the brand ground, resolving into the
  first screen. One second maximum; workers open the app forty times a day.
- **Printed documents** — wordmark top inline-start, the document type
  (`عرض سعر / Quotation`) top inline-end, both above a hairline. The bilingual
  layout of doc 09 §9 sits below it.
- **Unit labels** — the monogram only, printed mono at 8 mm, beside the QR code.
  It survives thermal printing, sanding dust and finish overspray; a wordmark at
  that size does not.
- **Customer tracking page** — wordmark in the header and once in the footer.
  This is the only surface a customer sees, so it is the only place the brand is
  given room to breathe.

### What the logo must never do here

No gradient fills on operational screens · no drop shadow · no rotation · no
stretching · never placed on a photograph without a solid plate behind it · never
recoloured outside the four supplied variants · never used as a loading spinner.

---

## 10. Applying the Aura brand — the swap checklist

Send these and the whole system takes them:

- [ ] **Logo files** — wordmark, monogram, reversed and mono, as SVG if possible
- [ ] **Brand colours** — primary, any secondary, and the neutral ramp if one
      exists, as hex values
- [ ] **Brand fonts** — the Latin family, and the Arabic family if there is one;
      the licence terms matter for web and app embedding
- [ ] **Radius preference** — sharp, or soft and rounded
- [ ] Any existing brand guideline PDF

Then, in order:

1. Fill in `brand.json`. Nothing else is edited.
2. Run the contrast validator — it checks every semantic pair in both themes and
   fails on anything under 4.5:1. Where the brand primary cannot carry text at
   that ratio, `--accent-on` flips to the neutral extreme and `--accent` keeps a
   darkened variant for text-on-ground use. The brand is preserved; the
   readability is not negotiated.
3. Check the status trio against the new accent; shift hues if any two collide.
4. Drop the logo files into `packages/brand-assets/`; the header, splash, favicon
   and document templates all read from there.
5. Regenerate the printed-document templates and print one of each — Arabic
   letter joining in PDF output breaks silently and often, so it is verified on
   paper, not on screen.
6. Review both themes on a real factory phone, in the workshop, in daylight. A
   palette that looks refined on a designer's monitor can be unreadable on a
   600-nit screen behind a dusty screen protector.

**Time to apply, once the assets are in hand: about a day**, most of it in steps
5 and 6.
