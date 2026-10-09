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

On first run the app asks **where to store your data** — pick a folder on your PC
(see [Where your data lives](#where-your-data-lives)). It then creates an **empty**
`app.db` there and you're ready to go. (To start with sample projects/BOM for a
demo, set the `BOM_SEED_SAMPLE=1` environment variable before launching.)

To stop the server, press `Ctrl+C` in the terminal (or use `stop-app.bat`).

## Where your data lives

Everything — projects, BOM items, status options, custom fields — is stored in a
single SQLite file, **`app.db`**, in a folder **you choose**. The app files and
your data are kept separate on purpose, so the app can be hosted/shared while each
person's data stays on their own machine (see
[Deploying on SharePoint](#deploying-on-sharepoint)).

- **Choosing / changing the folder:** the first-run prompt sets it; change it later
  via **Data Location** on the home page. Changing it copies your existing database
  to the new folder and takes effect after you restart the app.
- **Where it's remembered:** your choice is saved per-user at
  `%LOCALAPPDATA%\mBOM\config.ini` (not in the app folder, so it isn't shared or
  cloud-synced). The **Data Location** dialog shows the exact paths.
- **Pick a safe spot:** a local disk / SSD folder is safest for a live SQLite
  database. OneDrive works for automatic backup, but editing the *same* database on
  two PCs at once through cloud sync can cause conflicts.
- You can back it up by copying that one file, inspect/edit it with any SQLite tool
  (e.g. [DB Browser for SQLite](https://sqlitebrowser.org/)) while the app isn't
  writing, or delete it to start fresh (empty) on the next run.

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
- **Shared file:** a JSON snapshot is refreshed when the app **starts** and when
  it **stops** — not on every edit — so restart the app to update it. In Excel
  use **Get Data → From File → From JSON** and point it at the snapshot (see
  below for its location, also shown in the **Data Location** dialog). (For
  always-current data, use the live web connection above instead.)

In Power Query, pick the `bomLines`, `projects`, or `orders` table, choose
**Into Table**, and expand the columns.

### Where the shared JSON file lives

The app writes the snapshot to a **backup location one level above the app
folder**, and records the path in your config automatically:

```
<app parent>\backup data\<app-folder-full-path>\bom-data.json
```

For example, an app synced to `C:\Users\you\OneDrive\mBOM\Dev` writes to
`C:\Users\you\OneDrive\mBOM\backup data\C_Users_you_OneDrive_mBOM_Dev\bom-data.json`.
The per-install sub-folder (named after the app's full path) keeps snapshots from
different machines or synced copies from colliding. The folders are created
automatically, and the resolved `export_json` path is written into your per-user
config (`%LOCALAPPDATA%\mBOM\config.ini`).

To send the snapshot somewhere else (e.g. a shared network drive) for a run, set
the `BOM_EXPORT_PATH` environment variable — it overrides the computed path and
is not written back. `stop-app.bat` shuts the server down cleanly so the final
write runs.

## Deploying on SharePoint

The app is designed so the **program files** can be hosted centrally while each
person's **data** stays on their own PC:

1. Put this folder in a **SharePoint document library** and have each user **sync**
   it to their PC (OneDrive → *Sync*). Tip: right-click the synced folder →
   **Always keep on this device** so `server.py`, Python, and the batch files are
   actually present locally. **Don't include a personal `config.ini` or `data/`
   folder** in what you upload — those are per-user (they're git-ignored); each
   user's config and database are created on their own machine on first run.
2. Each user launches the app the usual way (`start-app.bat` or the mBOM shortcut).
   On **first run** they're asked to pick a **data folder on their own PC** — a
   local/SSD path is recommended; OneDrive is allowed for backup.
3. That choice is saved to **their** `%LOCALAPPDATA%\mBOM\config.ini`, which is
   *not* in the synced library — so every user keeps an independent database even
   though the app folder is shared. The database never lives in the SharePoint
   folder, so there's no cross-user clobbering or sync churn on a live SQLite file.

The app runs on `localhost` only; SharePoint just distributes the files.

## Project structure

```
index.html         Home page — project list, search/filter/sort, data location
project.html       Project detail page — edit project fields, manage BOM
css/               Stylesheets
js/app.js          Home page logic (incl. first-run / data-location setup)
js/project.js      Project detail + BOM logic (all views, import/export, settings)
js/store.js        Data layer — talks to server.py's API instead of localStorage
server.py          Local server: serves the static files and a JSON API, backed by SQLite
config.ini.example Reference for the per-user config (data_dir / export_json)
```

Per-user, outside the app folder (not committed, not synced):

```
%LOCALAPPDATA%\mBOM\config.ini   Your settings (chosen data folder, export path)
<your data folder>\app.db        Your SQLite database (location you choose)
<app parent>\backup data\<app-path>\bom-data.json
                                 Flat JSON snapshot for Excel (computed; override via BOM_EXPORT_PATH)
```

## Notes

- The server binds to `localhost` only — it's meant for local, single-user use, not for exposing on a network.
- `js/store.js` talks to the server with synchronous requests, so saves apply immediately (no separate "sync" step) at the cost of a brief pause on each save. That's fine for a local server on the same machine.
- To change the port, edit the `PORT` constant near the top of `server.py`.
