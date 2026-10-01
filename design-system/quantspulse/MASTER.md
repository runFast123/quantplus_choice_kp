# QuantsPulse — Design System (Master)

Source of truth for every screen. Page-specific overrides go in `pages/<page>.md`.

## Basis

- **Theme:** 21st.dev **Zen Linen** by serafimcloud (`get_theme` id `10e13fcf-0f42-446e-ab40-b1a703b52f84`).
  Tokens are copied verbatim into `web/src/app/globals.css`; light (linen) is the default, `.dark` is the alternate.
- **Structure guidance:** `ui-ux-pro-max --design-system "fintech trading terminal stock market analytics dashboard" --density 8 --variance 6 --motion 3`
  — taken: dense dashboard spacing (8–32px), mono numerals, subtle motion, visible focus, no emoji icons.
  Not taken: its stock slate/green OLED palette (replaced by Zen Linen at the user's request).

## Character

A research desk on paper, not a neon terminal. Linen ground, charcoal ink, one coral accent.
Editorial serif headlines over dense, quiet tables. Numbers are the loudest thing on the page.

## Tokens (Zen Linen)

| Role | Light | Dark |
|---|---|---|
| background | `#E9E4D8` | `#141414` |
| card / popover | `#F4EFE4` | `#1C1C1C` |
| sidebar | `#E3DDCF` | `#101010` |
| foreground | `#1E1E1E` | `#E8E3DA` |
| muted-foreground | `#5E5A52` | `#8E8A83` |
| primary (charcoal) | `#2E2E2E` on `#E6E4D7` | `#D1CFC0` on `#363636` |
| secondary | `#D8D2C4` | `#222222` |
| muted | `#CFC8B8` | `#2A2A2A` |
| border / input | `#D2CBBB` | `#2C2C2C` |
| accent (coral, chart-1) | `#F26A4B` | `#F26A4B` |
| radius | `0.5rem` | — |

### Finance semantics (added; validated with the dataviz palette validator)

| Role | Light (on `#F4EFE4`) | Dark (on `#1C1C1C`) |
|---|---|---|
| gain | `#0F7B5C` | `#2BA383` |
| loss | `#C2410C` | `#E0663F` |

Both pairs pass lightness band, chroma floor, CVD ΔE ≥ 8, normal-vision floor and 3:1 contrast — these are **mark**
colours (candles, chart fills).

**Ink** (text, badges, small fills — what `text-gain` / `text-loss` / `bg-gain` resolve to): light `#0B6A4E` / `#A8380B`,
dark `#4CC39C` / `#F07E5C`; soft backgrounds are 9% of ink. **Coral as text** uses `text-coral-ink` (`#A8402A` light,
`#F26A4B` dark); plain `coral` is decoration only. Verified with axe (WCAG 2.1 AA) in `web/e2e/a11y.spec.ts`.
Gain/loss is **never color-only**: always a sign (`+`/`−`) and a glyph (`▲`/`▼`).
Coral is brand/emphasis only — never used on P&L numbers, so it can't be misread as a loss.

## Type

| Use | Face | Notes |
|---|---|---|
| UI, body | Inter | 14px base in app chrome, 16px on marketing; `font-feature-settings: "cv11","ss01"` |
| Page titles, landing headlines | Playfair Display | Tight tracking (-0.01em), never for numbers |
| Prices, quantities, tickers, timestamps | JetBrains Mono | `tabular-nums`, right-aligned in tables |

Labels above data use small caps-style: 11px, uppercase, `letter-spacing: 0.08em`, muted ink.

## Layout & density

- App shell: 232px sidebar (collapses to bottom bar < 768px), 52px top bar, ticker tape under it.
- Spacing scale 4/8/12/16/24/32. Table rows 36px. Card padding 16px (20px ≥ 1280px).
- Hairline borders over shadows. Shadows only on popovers/menus (theme shadow: 0 4px 10px / 10%).
- Breakpoints verified at 375 / 768 / 1024 / 1440. No horizontal page scroll; wide tables scroll inside their card.

## Motion

150–200ms ease-out on hover/press; 0ms for data updates (numbers swap, they don't tween).
Respect `prefers-reduced-motion` everywhere.

## Charts

- Price: candlesticks (gain/loss colors) + volume histogram at 25% opacity in the same pane's lower band.
- Sparklines: 1.5px stroke in ink, end dot colored by direction.
- Allocation: horizontal bar list, single hue (charcoal), direct labels — no pies.
- Crosshair + tooltip on every plotted chart; a table view exists for every chart's data.

## Never

Purple/blue gradients, glassmorphism, glowing borders, emoji as icons, "✨ AI-powered" copy,
centered hero with a gradient blob, card grids of identical icon+title+blurb, Inter for headlines.
