# Project Selector & BOM Manager

A local web app for tracking projects and their Bills of Materials (BOM). Browse and filter projects on the home page, then open one to edit its details and manage its BOM in Tree, Flat, PO, or RFx views — with resizable/sortable/filterable columns, custom fields, and Excel import/export.

Data is stored in a local SQLite database, not the browser, so it survives clearing your browser's history/cache.

## Requirements

- **Python 3.8+** — that's it. No `pip install`, no Node, no build step. The server uses only Python's standard library (`http.server`, `sqlite3`).

## Setup

1. Open a terminal in this folder.
2. Run:

   ```
   python server.py
   ```

   (On some systems you may need `python3` instead of `python`.)

3. Open **http://localhost:8791** in your browser.

That's it. On first run, the server creates `data/app.db` and fills it with a handful of sample projects and one sample BOM so there's something to look at. After that, the database is the source of truth — the sample data is never re-applied.

To stop the server, press `Ctrl+C` in the terminal.

## Where your data lives

Everything — projects, BOM items, status options, custom fields — is stored in `data/app.db`, a standard SQLite file. You can:

- Back it up by copying that one file.
- Inspect or edit it directly with any SQLite tool (e.g. [DB Browser for SQLite](https://sqlitebrowser.org/), or Python's built-in `sqlite3` module) while the server isn't writing to it.
- Delete it to reset the app back to the seeded sample data (the server will recreate it on the next run).

## Connecting Excel (data connection)

All data is available as flat, spreadsheet-friendly JSON — one row per BOM
line, with computed Item No, derived PO, and inherited RFx/Status, plus
`projects` and `orders` tables. Click **Excel Data** on the home page for the
details, or use either of these directly:

- **Live web connection (recommended):** in Excel, **Data → Get Data → From
  Other Sources → From Web**, and use `http://localhost:8791/api/data.json`.
  **Refresh** in Excel any time to pull current data. Add `?project=<id>` to
  the URL to limit it to one project. (This only works on this machine, since
  the server is `localhost`-only.)
- **Shared file:** a JSON file is rewritten automatically on every change, so
  it's always current. In Excel use **Get Data → From File → From JSON**. By
  default it's `data/export.json` inside the app folder — see below to move it
  somewhere others can reach.

In Power Query, pick the `bomLines`, `projects`, or `orders` table, choose
**Into Table**, and expand the columns.

### Sharing the data file with others

To let teammates query the data without running the app, move the JSON file to
a shared/network drive. The app stays `localhost`-only — only the file is
shared.

1. Copy `config.ini.example` to `config.ini` in the app folder (if you don't
   already have a `config.ini`). Your `config.ini` is git-ignored, so your
   personal path is never committed.
2. In `config.ini`, under `[paths]`, uncomment `export_json` and set it to the
   destination, e.g.

   ```ini
   [paths]
   export_json = Z:\Shared\mBOM\bom-data.json
   # or a UNC path:
   # export_json = \\fileserver\engineering\mBOM\bom-data.json
   ```

3. Restart the app. The target folder is created if needed, and the file is
   rewritten there on every change. The **Excel Data** dialog and the startup
   log show the active path.

Notes:

- Absolute paths (including mapped drives and `\\server\share` UNC paths) are
  used as-is; a relative path is taken relative to the app folder. Windows
  backslashes work directly — don't double them.
- For a one-off override without editing the file, set the `BOM_EXPORT_PATH`
  environment variable; it takes precedence over `config.ini`.
- Writing happens on a background thread, so a slow or briefly-unavailable
  share never delays saves in the app; the file just catches up a moment later.

## Project structure

```
index.html        Home page — project list, search/filter/sort, create project
project.html       Project detail page — edit project fields, manage BOM
css/               Stylesheets
js/app.js          Home page logic
js/project.js      Project detail + BOM logic (all four views, import/export, settings)
js/store.js        Data layer — talks to server.py's API instead of localStorage
server.py          Local server: serves the static files and a JSON API, backed by SQLite
config.ini         Optional settings — e.g. relocate the Excel JSON file to a shared drive
data/app.db         SQLite database (created on first run)
data/export.json    Default location of the flat JSON snapshot for Excel (relocatable via config.ini)
```

## Notes

- The server binds to `localhost` only — it's meant for local, single-user use, not for exposing on a network.
- `js/store.js` talks to the server with synchronous requests, so saves apply immediately (no separate "sync" step) at the cost of a brief pause on each save. That's fine for a local server on the same machine.
- To change the port, edit the `PORT` constant near the top of `server.py`.
