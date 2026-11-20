# Aura Farmer — Design System Master

> **Source of Truth:** Derived from `ui-ux-pro-max`, `design-system`, `brand`, and `ui-styling`.
> When building or updating any page, follow these rules and verify against `design-system/aura-farmer/pages/[page].md` if present.

---

## 1. Brand Identity & Direction

- **Product:** Aura Farmer — Automated Job Application & Resume-Matched Curation Platform
- **Tone of Voice:** Sharp, calm, minimal, adaptable. No filler buzzwords or visual clutter.
- **Visual Direction:** Dark Obsidian + Luminous Aura Accents (Editorial Glassmorphism) with full Light Mode parity.
- **Iconography:** Lucide React (`lucide-react`), consistent `1.75px` stroke weight, `aria-hidden="true"` on decorative icons beside labels. Never use emojis as UI icons.
- **Brand Mark:** Geometric Aura Prism SVG (`<BrandMark />` / `<BrandLogo />`), monochrome-safe and accent-ready.

---

## 2. Three-Layer Token Architecture

Defined in `src/styles/globals.css`:

1. **Primitive Layer (`--primitive-*`)**: Raw obsidian neutrals, alabaster light neutrals, aura violet, aurora teal, status hues, 4px spacing scale, radius scale, and motion timings.
2. **Semantic Layer (`:root` / `.dark`)**: Theme-mapped `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--aura-primary`, `--aura-secondary`.
3. **Component Layer**: `--glass-bg`, `--glass-border`, `--glass-highlight`, `--glass-shadow`, `--aura-button-shadow`, `--nav-height`.

### Verified Contrast Palette (WCAG AA >= 4.5:1)

| Role | Dark Obsidian (`.dark`, default) | Light Alabaster (`:root`) |
|------|----------------------------------|---------------------------|
| Background | `#07070B` | `#F8F9FC` |
| Foreground | `#F4F5FA` | `#0B0D17` |
| Card / Surface | `#12131F` (frosted glass) | `#FFFFFF` (frosted glass) |
| Muted | `#1A1C2C` | `#EEF0F7` |
| Muted Foreground | `#9CA2BF` (~7.6:1) | `#475069` (~7.8:1) |
| Primary | `#7C3AED` (White text: 5.7:1) | `#6D28D9` (White text: 7.4:1) |
| Accent / Aura | `#2DD4BF` (Aurora Teal) | `#0F766E` (Deep Teal) |
| Destructive | `#F87171` (text) / `#DC2626` (fill) | `#DC2626` (4.8:1 on white) |
| Border | `rgba(255, 255, 255, 0.10)` | `#DCE0EE` |

---

## 3. Typography

- **Display / Headings:** `Space Grotesk` (`--font-heading`) — crisp geometric proportions, tight tracking (`-0.025em`) on large headings.
- **Body / UI:** `Plus Jakarta Sans` (`--font-sans`) — clean legibility for SaaS interfaces and forms.
- **Monospace / Metadata:** `JetBrains Mono` (`--font-mono`) — status tags, keyboard hints, error codes, session IDs.
- Loaded exclusively via `next/font/google` in `src/app/layout.tsx` (zero layout shift).

---

## 4. Layout, Glassmorphism & Motion Rules

- **Glass Surfaces:** `backdrop-filter: blur(16px)`, 1px translucent hairline border, subtle top inner specular highlight.
- **Accessible Auth (WCAG 2.2 AA):** Never block password paste, always set semantic `autoComplete` attributes, provide password visibility toggles, announce errors via `role="alert"` + `aria-live="polite"`, and show clear loading feedback.
- **Interactive Discipline:** All clickable elements use `cursor-pointer`, 150–250ms transitions, visible 2px focus rings (`focus-visible:ring-2`), and never shift layout bounds on hover.
- **Reduced Motion:** All entrance animations and ambient pulse/spin effects honor `@media (prefers-reduced-motion: reduce)`.
