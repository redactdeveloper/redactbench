# RedactBench Dashboard Design Specification

## Accepted concepts

- Desktop source of truth: `design/concepts/redactbench-dashboard-desktop.png` (1536×1024).
- Mobile source of truth: `design/concepts/redactbench-dashboard-mobile.png` (portrait reference; verify implementation at 390×844).
- Product type: a dense benchmark/research tool, not a marketing page.

## Visual direction

RedactBench looks like a precise research instrument: industrial editorial restraint, Swiss grid discipline and terminal-like numeric typography without retro decoration. The screen is built from open bands, rails, rules and table rows. A single chartreuse accent communicates selection and successful completion. Amber is reserved for a failed/warning state.

## Color lock

The accepted concepts use a true near-black background, not navy, cream or a gradient.

| Token | Value | Use |
|---|---:|---|
| `--color-bg` | `#070b0b` | page and app shell |
| `--color-bg-elevated` | `#0b1010` | selected/hovered row wash |
| `--color-text` | `#f1f0ea` | primary text |
| `--color-muted` | `#9aa3a0` | secondary labels and metadata |
| `--color-faint` | `#66706d` | disabled and tertiary text |
| `--color-rule` | `#34403e` | 1px structural rules |
| `--color-rule-strong` | `#54615e` | focused controls and table edge |
| `--color-accent` | `#c9ef2d` | selected state, score, success |
| `--color-accent-ink` | `#0b0d08` | text on accent button |
| `--color-warning` | `#f4b523` | failed/warning only |
| `--color-danger` | `#f16f5f` | destructive/error only |

No gradients, glow, glass blur or colored image overlays are allowed.

## Typography

- Content/heading family: `"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif` until a local open font is intentionally added.
- Numeric/control family: `"IBM Plex Mono", "Roboto Mono", "SFMono-Regular", Consolas, monospace`.
- Desktop H1: 38–42px / 1.05, 650–700 weight, slightly condensed.
- Mobile H1: 31–36px / 1.08, 650–700.
- Section title: 26–30px desktop, 24–28px mobile.
- Summary value: 38–44px desktop, 28–34px mobile, mono.
- Table body: 15–17px desktop, minimum 14px mobile, mono for values.
- Labels: 11–13px, uppercase, 0.06–0.1em tracking, mono.
- Controls must receive an explicit family, size, weight and line-height; browser defaults are prohibited.

## Spacing and geometry

- Base spacing unit: 4px.
- Scale: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72.
- Desktop left rail: 216px.
- Desktop content gutter: 30–40px; max content follows viewport rather than a centered marketing container.
- Mobile page gutter: 16px; top-bar controls may use 14px.
- Borders: 1px; accent-selected row uses 1px chartreuse outline.
- Radii: 0, 2 or 4px. No pill controls except a semantic circular radio/status marker.
- Shadow: none. Hierarchy comes from rules, spacing and type.
- Touch target: minimum 44×44px.

## Container model

- App shell: fixed/desktop side rail + main content + bottom status bar.
- Main content: open full-width bands separated by horizontal rules.
- Summary: one contiguous five-column strip, not five floating cards.
- Leaderboard: one semantic table with a selected row and a bordered table perimeter.
- Lower desktop area: two adjacent open panels separated by one vertical rule.
- Context Recovery: horizontal timeline with four milestones; no card wrapper.
- Mobile: side rail collapses into the top bar; summary becomes one four-column strip; leaderboard remains a data table/list and may scroll inside its own region only.

## Component inventory

### App shell

- `Sidebar`: brand, five navigation items, utility controls at the bottom.
- `MobileHeader`: menu, centered wordmark, no bottom navigation.
- `RunToolbar`: run selector and `New run` button.
- `StatusBar`: verified/isolation/network state; mobile keeps only the primary statuses.

### Benchmark content

- `RunHeading`: title + exact metadata line.
- `SummaryStrip`: score, TTFT, output speed, total cost, cost/correct; mobile hides cost/correct before inventing a new layout.
- `LeaderboardToolbar`: category and task filters plus compact utilities on desktop.
- `LeaderboardTable`: sortable headers, three model rows, selected radio marker, numeric alignment and row disclosure.
- `RecoveryTimeline`: phase 1, reset, phase 2, hidden checks with success/reset line semantics.
- `AttemptDetails`: tabs and attempt table on desktop; mobile moves this below the recovery section as a disclosure.

## Icon inventory

All icons are code-native inline SVG with `currentColor`, 20–22px default size and consistent 1.5px stroke, square-ish geometry, round caps only where the concept shows them.

- menu: three horizontal rules;
- overview: simple home outline;
- runs: ordered/list lines;
- tasks: code brackets;
- models: cube outline;
- methodology: open book;
- chevron-down/right/up: directional disclosure;
- plus: `New run`;
- sort: paired chevrons or one active arrow;
- check: phase success;
- reset: outlined ring, intentionally not a success check;
- document: notes/log;
- shield: hidden checks/isolation;
- clock: recovery time;
- warning triangle: failed attempt;
- settings: utility only.

No emoji, text glyph arrows or mismatched icon family.

## Interaction and motion

- Selected row: chartreuse outline, chartreuse radio dot and score; no large fill.
- Hover: subtle `--color-bg-elevated` wash; focus-visible adds a 2px accent outline with offset.
- Sort: only the active sort arrow uses primary/accent color.
- Recovery timeline may reveal from left to right in 280–360ms; data itself must be immediately available.
- Row/detail changes use 120–180ms opacity/translate transitions.
- `prefers-reduced-motion` disables nonessential transitions.

## Allowed above-the-fold copy

- `REDACTBENCH`
- `Overview`, `Runs`, `Tasks`, `Models`, `Methodology`
- `Run 2026-07-12 / demo`
- `3 MODELS · 24 TASKS · SCORER v1`
- `New run`
- `OVERALL SCORE`, `AVG TTFT`, `OUTPUT SPEED`, `TOTAL COST`, `COST / CORRECT`
- `Leaderboard`
- `All categories`, `All tasks`
- report-derived model names and metric values
- `Context Recovery`

Do not add an eyebrow, product tagline, welcome message, marketing claim, decorative badge or invented metric.

## Responsive rules

- `>= 1120px`: desktop rail, five summary columns, full category columns, recovery + attempts split.
- `768–1119px`: compact rail or icon rail, horizontal table scroll inside table wrapper, lower panels stack if needed.
- `< 768px`: top bar replaces rail; compact run selector/action row; four summary columns; leaderboard shows model, score, TTFT, tok/s and cost; recovery section stacks below.
- At 390×844 there is no page-level horizontal overflow, clipped primary action or accidental text wrapping in the heading/summary labels.

## Data integrity rules

- Every displayed value comes from `report.json`; missing metrics render an em dash and accessible `Not measured`, never `0`.
- Model output and task titles are rendered as text; raw HTML is never accepted.
- Fixture values in the accepted concept establish density only. The final demo screenshot must use metrics from the actual fixture run.

## Fidelity checklist

- First viewport balance and section order match the desktop concept.
- Background, accent, text and rule colors match the locked palette.
- Table anatomy remains a table on desktop and a compact data list/table on mobile.
- Typography is deliberate in headings, controls, summary labels and every table cell.
- Recovery reset is visually distinct from completed phases.
- Desktop is verified at 1536×1024 and 1440×900; mobile at 390×844.
