# Cram Calendar

A personal fork of [Full Calendar](https://github.com/obsidian-community/obsidian-full-calendar) for Obsidian, tuned for time tracking in a Notion Calendar style. Events are still notes in your vault (one note per event, with frontmatter), so you can write notes, add links and add context to anything on your calendar.

> Forked from Full Calendar by [Davis Haupt](https://davi.sh), released under the MIT license. All credit for the original plugin goes to Davis and its contributors. This fork is not affiliated with the original project.

## What's different from Full Calendar

- **15-minute slots.** Events snap to 15 minutes instead of 30.
- **Drag to create.** A plain click on empty space does nothing; dragging creates an event.
- **Duration on every event.** The time range is shown under the title, with the total underneath (for example `10:30 - 1:00` then `2h 30m`).
- **Note preview.** The start of the event's note appears inside the event.
- **Colour per event.** Set `color` in an event's frontmatter, or use the colour picker in the edit window. It overrides the calendar's colour.
- **Duplicate event.** Right-click an event to duplicate it, including the note body. Copies are named `Name (1)`, `Name (2)` and so on.
- **Zoom.** `+` and `-` buttons (and Ctrl + scroll) change the row height. The setting is remembered.
- **Show or hide calendars.** A "Calendars" dropdown in the toolbar toggles each calendar. The choice is remembered.
- **Notion-style look.** Tinted event cards with a left accent bar, bold titles, hour labels on the hour line, lighter quarter-hour lines, a time badge on the now-line, and a circled date for today.

See [docs/ui-audit.md](docs/ui-audit.md) for the UI review behind the visual changes.

## Installation

This fork is not in the Obsidian Community Plugins list. Build it and copy the files in by hand.

1. Install [Node.js](https://nodejs.org), then in this folder run:
   ```
   npm install --legacy-peer-deps
   npm run build
   ```
2. Create the folder `.obsidian/plugins/full-calendar-pj/` inside your vault.
3. Copy `main.js` and `manifest.json` into it, and copy `main.css` there as `styles.css`.
4. In Obsidian, open Settings → Community plugins, refresh the list and enable **Cram Calendar**.

The plugin id is `full-calendar-pj`, so it can run next to the original Full Calendar plugin. If you use both, point them at different calendar folders.

## About the original plugin

Full Calendar can pull events from frontmatter on notes, or from event lists in daily notes. It also supports read-only ICS and CalDAV remote calendars. The original documentation is [here](https://obsidian-community.github.io/obsidian-full-calendar/).

The FullCalendar library is released under the [MIT license](https://github.com/fullcalendar/fullcalendar/blob/master/LICENSE.txt) by [Adam Shaw](https://github.com/arshaw). It's an awesome piece of work, and it would not have been possible to make something like this plugin so easily without it.

## License

MIT. See [LICENSE](LICENSE). The original copyright notice (Davis Haupt, 2022) is kept as the license requires.
