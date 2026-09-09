# Changelog

A local project + Bill-of-Materials (BOM) manager: a project selector home
page and a per-project detail page with a full editable BOM, Orders, Excel
import/export, and an Excel data connection — served by a small Python +
SQLite server and launched by a double-click.

This log groups the work by area rather than by date.

## Home page — project selection

- Searchable, sortable, filterable project table (WBS, EWR, Name, Status,
  Date Created).
- **New Project** dialog with validation and duplicate-WBS checks.
- Clicking a row opens the project directly (the separate "Select Project"
  button was removed).
- Opens **filtered to Active** by default; the Status field was simplified to
  **Active / Archived**.
- **Delete a project** from its row, via a confirmation dialog that warns the
  deletion is permanent (BOM and Orders included) and offers to **export the
  project to Excel first**. Deletion cascades server-side, leaving no orphaned
  data.
- **Excel Data** button (see *Data storage & Excel connection*).

## Bill of Materials

- **Views:** Tree (hierarchical, editable) and Flat (aggregated by part
  number). Grouping *by RFx* now lives on the **Orders** tab — expand an order
  to view and edit its parts — so the earlier standalone PO and RFx BOM views
  were both retired. The Tree view opens **fully collapsed** by default; use
  **Expand All** (or a row's toggle) to drill in.
- **Editing in the aggregated views:** in Flat view (and the Orders parts
  expansion) a change to a part fans out to every underlying BOM line — with a
  confirm popup and a difference summary whenever more than one line is
  affected.
- **Columns:** resizable, sortable, **multi-select** per-column filters (pick
  several values with OR matching, with a search box when the list is long and
  a Clear for the whole column); a show/hide columns menu; and "+ Add Column"
  to pull tree fields into the Flat view.
- **Copy Table** (toolbar) copies the *visible* rows and columns — respecting
  collapse, search, filters, and hidden columns — to the clipboard as
  tab-separated text that pastes straight into Excel, with a confirmation
  toast. Available in Tree and Flat views (and on the Orders tab).
- **Custom columns start hidden** in every BOM view so they don't clutter the
  default layout — show them in Tree view via the Columns menu, or in Flat/RFx
  via "+ Add Column".
- **Fields:** Item No (auto-computed from tree position), Assy, Included in
  Parent, 3M Part Number, Qty, Spare (rolled into quantity totals),
  Manufacturer, Commercial Part No, 3M Supplied, Description, RFx, PO
  (read-only, derived from the RFx's order), Status, Notes, plus user-defined
  custom fields.
- **Included in Parent** makes RFx/PO/Status read-only and inherited from the
  parent assembly. A **Show Included-in-Parent** toggle (Flat view toolbar, and
  on the Orders tab) reveals those normally-hidden lines — in Flat view they
  join the aggregation; in an expanded order they appear under their effective
  (inherited) RFx. Toggling it off restores the hidden state.
- **Row actions** consolidated into a 3-dots menu: Move Up/Down, **Move
  before…/after…**, Insert Above/Below, **Insert Rows…** (a dialog asks how
  many blank rows to drop in below the line), Add Sub-Item, Indent, Outdent,
  Delete. Larger expand/collapse handles.
- **Select lines + bulk actions:** a checkbox column (with a select-all header)
  lets you pick any number of Tree-view lines; a bar then offers **Set Status**,
  **Set RFx**, **Clear Notes**, and **Delete** on just the selected lines, plus
  Clear selection. The selection is kept as you search, filter, and collapse.
- **Move before/after a chosen part:** instead of nudging a line one row at a
  time, pick **Move before…** or **Move after…** and choose the target part
  from a type-to-search list (item no · 3M part number · description). The line
  (with its sub-items) relocates next to that part — anywhere in the tree, so it
  can change nesting too. A part can't be moved into its own sub-tree.
- **Focus on one assembly:** rows that are assemblies (have children) show a
  small **filter icon** next to their part number (hover text: "Filter the tree
  to show only this assembly and its parts") that collapses the Tree view down
  to just that assembly and its sub-parts — hiding every sibling and parent.
  Item numbers keep their true path (e.g. 1.7.1.1). A banner names the focused
  assembly; move up one level with **↑ Up to Parent** (re-focuses the parent
  assembly; disabled at the top level), or clear it with the **Clear filter**
  button or the **Esc** key.
- **Data-quality flag:** lines sharing a 3M Part Number but with inconsistent
  Manufacturer, Commercial Part No, 3M Supplied, Description, RFx, or Status
  are highlighted, with an on-hover explanation of exactly what differs.
- **RFx details, without the clutter:** in Tree view, hovering an RFx cell
  shows a tooltip with its order details (PO, description, supplier, delivery,
  status), and focusing/clicking one fills a dedicated info panel above the
  table with the same details — so the rows stay clean. Works on inherited
  (Included-in-Parent) RFx cells too.
- **Focus on one assembly:** assembly rows carry a small **filter icon** (next
  to the part number) — the Tree view collapses to just that assembly and its
  sub-parts, hiding siblings and parents. Item numbers keep their true path;
  clear with the banner button or **Esc**.
- **Level color-coding:** Tree view rows are shaded by their depth in the
  hierarchy with a **monochrome gradient** — darkest at the top level,
  lightening as you go deeper (the same palette as the Excel export), so the
  structure reads at a glance. The tint adapts to light/dark theme, and the
  data-quality warning still takes precedence on flagged rows.
- **Excel-like copy/paste:** in Tree view, drag or shift-click to select a
  rectangle of cells, **Ctrl+C** to copy as tab-separated values, and **Ctrl+V**
  to paste a block from the top-left of the selection. Interoperates with real
  Excel. Read-only columns (Item No, derived PO, inherited RFx/Status) are
  skipped on paste.

## Parts catalog (backend only)

The standalone **Parts List tab was removed** (it wasn't useful in practice).
The parts catalog itself is retained as a backend feature — the `parts` table,
the `/api/parts` routes, and the BOM→catalog sync all stay — because it powers
BOM part-number autocomplete.

- **Stays in sync with the BOM automatically:** every BOM save adds or updates
  the parts it uses (keyed by 3M Part Number); assemblies also remember a
  snapshot of their child components. Parts added manually — or no longer in
  the BOM — are kept, never deleted.
- **Autocomplete on the BOM:** typing a 3M Part Number on a BOM line suggests
  matching catalog parts; picking one fills in the line's identity fields. If
  the part is an assembly, you're offered its remembered children as
  ready-made sub-items.

## Orders

- Full Orders tab: RFx, PO, Description, Supplier Name, Delivery Date, Status.
- **Add Order** opens a form to enter all the order's details up front (RFx is
  required), rather than dropping a blank row into the table.
- **Expand an order to see and edit its parts:** a toggle on each order row
  reveals the BOM parts on that RFx (aggregated by 3M part number, with a
  "N parts · Qty X" summary) inline, no page reload. **RFx**, **Status** and
  **Notes** are editable there — a change fans out to every underlying BOM line
  (with a confirm when more than one is affected) — and a **Clear Notes** button
  wipes the Notes on every part on that RFx. Changing a part's **RFx moves it to
  another order** (and re-derives its PO). This replaces the old RFx BOM view.
  Toolbar **Expand All / Collapse All** buttons open or close every order's
  parts at once.
- **"(none)" catch-all row:** BOM items with no RFx assigned used to be invisible
  on the Orders page. A synthetic **(none)** row now appears at the bottom of the
  table whenever any item lacks an RFx; expand it to see those items and assign
  each an RFx (which moves it to the matching order). It's display-only — not a
  stored order — and it's included in **Copy Table** and the read-only export.
- **Sort and filter** the Orders table: click a column header to sort
  (ascending/descending), and use the per-column **multi-select** filters
  (choose several values per column, OR-matched). Sorting and filtering affect
  the display only — the saved order sequence is unchanged.
- **Copy Table** copies the visible orders to the clipboard as tab-separated
  text for Excel — and now includes **each order's parts** (the same list the
  expander shows), indented one column beneath their order, whether or not the
  order is expanded.
- **Update Status** action pushes an order's status onto every BOM part on
  that RFx.
- **Renaming an RFx** on an order offers to carry every BOM line still on the
  old RFx over to the new one (re-deriving their PO), so lines are never
  silently orphaned.

## Excel import / export

- **Export** to a real `.xlsx` with sheets: Project Details (including a Date
  Exported row), BOM Tree (with Excel outline grouping), BOM Flat, BOM By RFx
  (grouped), and an Import sheet.
- **Level color-coding:** the BOM Tree sheet shades each row by its depth in
  the hierarchy (a monochrome gradient, dark→light; deeper levels reuse the last color), so the
  structure reads at a glance. A matching color key is added to the Project
  Details sheet. The Import sheet is left uncolored so it still round-trips. Key columns are centered; column widths
  auto-fit. The BOM By RFx group headers spread each piece — RFx, PO,
  description, supplier, delivery date, status, and the part/qty roll-up —
  across separate cells (not one merged cell). The **BOM (Flat)** and **BOM
  (By RFx)** sheets ship with Excel column-filter dropdowns on their header
  row.
- **Import** reads real `.xlsx` files (handles Excel's compression) from the
  Import sheet; the template matches the export format; any new RFx values are
  added to the Orders table automatically.
- **Export HTML** saves a single self-contained `.html` file that *is* the app,
  running **read-only** against the project's data embedded in the page — no
  server, database, or external requests, so it opens in any browser (even
  straight off disk). It looks and behaves like the live app — Tree/Flat views,
  search, column sort and multi-select filters, expand/collapse (BOM and
  Orders), the RFx info panel, per-order parts expansion, and Copy Table all
  work — but every cell is static text and the editing controls are gone. Only
  the **Bill of Materials** and **Orders** tabs are included.

## Data storage & Excel connection

- Data moved from browser storage to a **SQLite database** (`data/app.db`) via
  `server.py`, so clearing the browser no longer affects data.
- **Excel data connection:** a live endpoint (`/api/data.json`, for Power
  Query "From Web", always current) and a JSON file written when the app
  **starts** and **stops** — not on every edit, so ongoing work never touches
  the (possibly shared) file. Both expose flat, spreadsheet-friendly `projects`
  / `orders` / `bomLines` tables. Discoverable via the Excel Data dialog; to
  refresh the file mid-session, restart the app.
- **Shareable data file:** the JSON file can be relocated out of the app folder
  onto a shared/network drive so others can query it, by setting `export_json`
  in `config.ini` (or the `BOM_EXPORT_PATH` environment variable); it defaults
  to `data/export.json`. The server stays `localhost`-only — only the file is
  shared. Writes are hardened (auto-created target folder, unique temp file +
  atomic rename, retry when the file is briefly locked). To make the on-stop
  write reliable for the windowless server, `stop-app.bat` triggers a graceful
  shutdown (`POST /api/shutdown`) and only force-kills as a fallback.

## Running the app / infrastructure

- `start-app.bat` launches the server windowless (no leftover console window)
  and opens the app; `stop-app.bat` stops it.
- **Close App button** on every screen (project selector and project detail)
  stops the local server — via the same `POST /api/shutdown` graceful shutdown
  that `stop-app.bat` triggers (a web page can't launch a `.bat` directly), so
  the final data snapshot is still written — then closes the window (works in
  the Chrome app-mode / installed-PWA window; a normal tab shows a "you can
  close this window" message instead). If **Google Chrome** is installed
  it opens in Chrome **app mode** (`--app=`) — a clean, standalone window with
  no tabs or address bar that carries the app's own icon — otherwise it falls
  back to the default browser.
- **App icon, install, and taskbar shortcut:** the app ships an icon
  (`favicon.ico` + `icons/`) and a web manifest (`manifest.webmanifest`), so
  Chrome/Edge offer **Install** — giving it a standalone window with its own
  taskbar and Start-menu icon. `Create-mBOM-Shortcut.ps1` also makes Desktop
  and Start-menu shortcuts (with the icon); pin either to the taskbar. The
  server now serves `favicon.ico` and `.webmanifest`
  (as `application/manifest+json`).
- **Standalone `.exe` (`mBOM.exe`):** a one-file PyInstaller build that bundles
  Python, the server, and the whole web app. Double-clicking it (or the
  shortcut) **starts the server itself and opens the browser** — no separate
  Python install or PATH needed. `server.py` is freeze-aware: static assets run
  from the bundle, while the database, `config.ini`, logs and export file live
  next to the `.exe` (so data persists between runs). Built via
  `mbom_launcher.py` (the entry point). `Create-mBOM-Shortcut.ps1` targets the
  `.exe` when present, else falls back to `start-app.bat`.
- **Code signing (`sign.ps1`):** signs `mBOM.exe` with Authenticode + an
  RFC-3161 timestamp. Defaults to a self-signed test cert (proves the pipeline;
  **not** trusted by Windows/antivirus); pass `-Pfx`/`-Password` or
  `-Thumbprint` to sign with a real CA code-signing certificate — required to
  actually avoid SmartScreen/AV "unknown publisher" warnings.
- Fixed a bug where pages loaded blank or intermittently — the server now
  speaks HTTP/1.1 and refuses to double-bind its port.
- `README.md` documents setup and the Excel connection.

## Web hosting (Render) + accounts

- **Runs hosted or local, same code.** With `DATABASE_URL` set (Render's managed
  Postgres) the app uses Postgres; with it unset it uses the local SQLite file —
  so `python server.py` / `start-app.bat` still work with zero setup. A thin
  `db.py` wrapper keeps the existing sqlite-style queries working on both. On
  Render the server binds `0.0.0.0:$PORT`; locally it stays `localhost:8791`.
- **Login required.** Every app page and API needs a session; unauthenticated
  page loads redirect to a themed `login.html`, and API calls return 401. Sign
  in with a username + password (PBKDF2-hashed, HttpOnly session cookie).
- **Preset accounts.** The first **admin** is created from the `ADMIN_USERNAME`
  / `ADMIN_PASSWORD` env vars on first run (locally these default to
  `admin`/`admin` with a warning). Admins get a **Manage Users** dialog on the
  home page to add users, reset passwords, and delete accounts.
- **Data is per-account.** Projects, BOMs, orders, and each user's status
  options and custom fields are isolated per login; one account can't see or
  touch another's data (enforced on every request). Upgrading an existing
  database assigns its projects to the admin automatically.
- **Deploy:** `render.yaml` (Blueprint) + `requirements.txt` provision a web
  service and Postgres; the local-only **Close App** button and `/api/shutdown`
  are hidden/disabled when hosted. See the README's *Deploying to Render*.
