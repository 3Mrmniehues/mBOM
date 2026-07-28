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

- **Views:** Tree (hierarchical, editable), Flat (aggregated by part number),
  and RFx (grouped). A PO view existed briefly and was then removed in favor
  of a PO filter on the RFx view.
- **Editing in every view:** inline cells in Tree view; and editing in
  Flat/RFx views, where a change fans out to every underlying line — with a
  confirm popup and a difference summary whenever more than one line is
  affected. RFx is editable from the RFx group headers (reassigns the whole
  group).
- **Columns:** resizable, sortable, per-column filters; a show/hide columns
  menu; and "+ Add Column" to pull tree fields into the Flat/RFx views.
- **Fields:** Item No (auto-computed from tree position), Assy, Included in
  Parent, 3M Part Number, Qty, Spare (rolled into quantity totals),
  Manufacturer, Commercial Part No, 3M Supplied, Description, RFx, PO
  (read-only, derived from the RFx's order), Status, Notes, plus user-defined
  custom fields.
- **Included in Parent** makes RFx/PO/Status read-only and inherited from the
  parent assembly.
- **Row actions** consolidated into a 3-dots menu: Move Up/Down, Insert
  Above/Below, Add Sub-Item, Indent, Outdent, Delete. Larger expand/collapse
  handles.
- **Focus on one assembly:** rows that are assemblies (have children) show a
  3-dots menu next to their part number with **Filter to this assembly**, which
  collapses the Tree view down to just that assembly and its sub-parts — hiding
  every sibling and parent. Item numbers keep their true path (e.g. 1.7.1.1). A
  banner names the focused assembly; clear it with its **Clear filter** button
  or the **Esc** key.
- **Data-quality flag:** lines sharing a 3M Part Number but with inconsistent
  Manufacturer, Commercial Part No, 3M Supplied, Description, RFx, or Status
  are highlighted, with an on-hover explanation of exactly what differs.

## Orders

- Full Orders tab: RFx, PO, Description, Supplier Name, Delivery Date, Status.
- **Sort and filter** the Orders table: click a column header to sort
  (ascending/descending), and use the per-column dropdown filters. Sorting and
  filtering affect the display only — the saved order sequence is unchanged.
- **Update Status** action pushes an order's status onto every BOM part on
  that RFx.
- RFx-view group headers show the order's description, supplier, delivery
  date, and status.

## Excel import / export

- **Export** to a real `.xlsx` with sheets: Project Details (including a Date
  Exported row), BOM Tree (with Excel outline grouping), BOM Flat, BOM By RFx
  (grouped), and an Import sheet. Key columns are centered; column widths
  auto-fit. The BOM By RFx group headers spread each piece — RFx, PO,
  description, supplier, delivery date, status, and the part/qty roll-up —
  across separate cells (not one merged cell).
- **Import** reads real `.xlsx` files (handles Excel's compression) from the
  Import sheet; the template matches the export format; any new RFx values are
  added to the Orders table automatically.

## Data storage & Excel connection

- Data moved from browser storage to a **SQLite database** (`data/app.db`) via
  `server.py`, so clearing the browser no longer affects data.
- **Excel data connection:** a live endpoint (`/api/data.json`, for Power
  Query "From Web") and an auto-maintained JSON file that rewrites on every
  change. Both expose flat, spreadsheet-friendly `projects` / `orders` /
  `bomLines` tables. Discoverable via the Excel Data dialog.
- **Shareable data file:** the JSON file can be relocated out of the app folder
  onto a shared/network drive so others can query it, by setting `export_json`
  in `config.ini` (or the `BOM_EXPORT_PATH` environment variable); it defaults
  to `data/export.json`. The server stays `localhost`-only — only the file is
  shared. Writes are hardened (auto-created target folder, unique temp file +
  atomic rename, retry when the file is briefly locked) and moved to a
  background thread, so a slow or unavailable share never delays or blocks saves
  in the app.

## Running the app / infrastructure

- `start-app.bat` launches the server windowless (no leftover console window)
  and opens the browser; `stop-app.bat` stops it.
- Fixed a bug where pages loaded blank or intermittently — the server now
  speaks HTTP/1.1 and refuses to double-bind its port.
- `README.md` documents setup and the Excel connection.
