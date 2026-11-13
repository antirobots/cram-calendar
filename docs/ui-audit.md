# UI audit - Full Calendar (PJ)

Reference: Notion Calendar (week view). Scope: CSS in `src/ui/overrides.css` (bundled to `styles.css` by esbuild) plus small DOM tweaks in `src/ui/calendar.ts` / `view.ts`.
Confirmed = read from code. Visual = needs the owner to check in Obsidian (light + dark).

Skills: `frontend-design` / `web-design-guidelines` are NOT installed; nothing was installed. Audit done by hand.

## Gap vs Notion Calendar (visual polish)

| # | file:line | Issue | Severity |
|---|-----------|-------|----------|
| 1 | overrides.css:16-18 | Events are solid, saturated fills with white text. Notion uses a soft tinted fill, a 3px solid left accent bar and coloured/dark text. Heavy, noisy with many events. | High |
| 2 | calendar.ts:189-195 | Toolbar: three separate button groups with filled backgrounds; title is centred. Notion: title left-aligned with a muted "Week 46", compact ghost buttons. | Medium |
| 3 | overrides.css:48-52 | Buttons are filled `--interactive-normal` chips; active view is accent-filled. Prefer transparent ghost buttons with hover fill, subtle active state. | Medium |
| 4 | (FullCalendar default) | Day headers use the accent colour (green in this theme) via `.fc-col-header-cell a`. Notion: muted text, today = filled red/accent circle on the date number. | High |
| 5 | (FullCalendar default) | Now-line has no time pill on the hour axis. Notion shows a red "12:17PM" badge. | Low |
| 6 | (FullCalendar default) | All-day row: heavy double border below it and large "all-day" label. Notion: small muted label, single hairline. | Medium |
| 7 | overrides.css:242-251 | Grid colours are hardcoded `rgba(128,128,128,x)` (works on any theme but isn't an Obsidian variable). Vertical column dividers still full-strength `--background-modifier-border`. | Low |
| 8 | (FullCalendar default) | Event corners are ~3px, events touch each other (no gutter). Notion: ~6px radius, 1px gap, slight inset on the right so overlaps stay visible. | Medium |
| 9 | overrides.css:131-138 | Event title 700 weight at same size as time; Notion title 600 / time muted. Use `--font-ui-small` and muted time. | Low |
| 10 | (FullCalendar default) | Today's column background is `--background-modifier-cover` (dark slab). Notion: almost no tint. | Low |
| 11 | (FullCalendar default) | Scrollbar and `.fc-scrollgrid` outer border draw a frame around the whole grid. | Low |

## Accessibility / usability

| # | file:line | Issue | Severity |
|---|-----------|-------|----------|
| 12 | calendar.ts:157-166 | Custom buttons use text glyphs `+`, `-`, `Calendars ▾`; the zoom buttons have `hint` (title) but no `aria-label`. | Medium |
| 13 | view.ts:222-240 | Calendars popover: no `role`/`aria-expanded`, Escape does not close it, not keyboard reachable as a menu. Rows are `<label>` + checkbox (good). | Medium |
| 14 | overrides.css (none) | No visible `:focus-visible` style on events/buttons beyond browser default; events are `<a>` and are focusable. | Medium |
| 15 | overrides.css:141-152 | Hour labels `0.75em` of already small text; contrast `--text-muted` on `--background-primary` is theme dependent. | Low |
| 16 | overrides.css:85-87 | Slot height is in `em`; on mobile (`.is-phone`) touch targets for dragging/creating are small. Mobile toolbar is unchanged. | Low (visual) |
| 17 | EditEvent.tsx:79-86 | Colour palette is hex data stored in notes (allowed). Swatch size / focus ring not verified. | Low (visual) |

## Hardcoded colours (constraint check)
- `EditEvent.tsx:79-86` palette hex values: these are saved *data* values, not UI chrome. Keep.
- `overrides.css:243-250` rgba greys: replace with `var(--background-modifier-border)` blended via opacity on a pseudo-element, or keep (works on all themes). Decision needed.
- `ofc-checkbox-white/black` use `white`/`black` for contrast on coloured events (pre-existing upstream).

## Proposed fix groups (priority order, one commit each)
1. **Event cards**: tinted fill from the event colour (CSS `color-mix` unsupported on older Obsidian, so set the tint in JS from the resolved colour as an `rgba`), 3px left accent bar, 6px radius, 1px gap, muted time. Fixes #1, #8, #9.
2. **Headers**: muted day names, today as accent circle, soft today column, small all-day label/hairline, now-line time pill. Fixes #4, #5, #6, #10, #11.
3. **Toolbar**: left-aligned title, ghost buttons, compact spacing. Fixes #2, #3.
4. **Accessibility**: `aria-label` on zoom/calendars buttons, Escape + `aria-expanded` on popover, `:focus-visible` rings. Fixes #12-14.
5. **Mobile pass** (optional, needs visual confirmation): bigger touch targets. Fixes #16.

Not touched: settings schema, saved data format, file creation logic, command IDs.
