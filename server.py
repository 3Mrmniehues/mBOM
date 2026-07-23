"""Local static file + JSON API server, backed by SQLite.

Run with:
    python server.py

Serves the existing static site (index.html, project.html, css/, js/) and a
small REST API under /api/* that js/store.js talks to instead of
localStorage. Everything lives in one process on one port, so there's no
CORS to worry about. The SQLite file is created (and seeded, on first run)
at data/app.db next to this script.
"""

import configparser
import datetime
import http.server
import json
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "app.db"
CONFIG_PATH = BASE_DIR / "config.ini"
PORT = 8791

# ---------------------------------------------------------------------------
# Seed data (ported from the old js/data.js, used only to populate a brand
# new, empty database on first run — after that, the DB is authoritative).
# ---------------------------------------------------------------------------

SEED_PROJECTS = [
    {"id": "p1", "wbs": "1.1.01", "ewr": "EWR-2024-014", "name": "Substation Upgrade Phase 2", "status": "Active", "dateCreated": "2024-01-15"},
    {"id": "p2", "wbs": "1.2.03", "ewr": "EWR-2024-027", "name": "Downtown Fiber Rollout", "status": "Archived", "dateCreated": "2024-02-08"},
    {"id": "p3", "wbs": "2.0.01", "ewr": "EWR-2023-098", "name": "Riverside Bridge Retrofit", "status": "Archived", "dateCreated": "2023-11-02"},
    {"id": "p4", "wbs": "2.1.05", "ewr": "EWR-2024-002", "name": "Water Treatment Expansion", "status": "Active", "dateCreated": "2024-01-03"},
    {"id": "p5", "wbs": "3.0.02", "ewr": "EWR-2023-071", "name": "Airport Terminal C Wiring", "status": "Archived", "dateCreated": "2023-08-19"},
    {"id": "p6", "wbs": "3.1.01", "ewr": "EWR-2024-041", "name": "Highway 12 Signal Upgrade", "status": "Active", "dateCreated": "2024-03-22"},
    {"id": "p7", "wbs": "1.3.02", "ewr": "EWR-2023-054", "name": "Regional Data Center Cooling", "status": "Archived", "dateCreated": "2023-06-30"},
    {"id": "p8", "wbs": "4.0.01", "ewr": "EWR-2024-009", "name": "Solar Array Interconnect", "status": "Archived", "dateCreated": "2024-01-27"},
    {"id": "p9", "wbs": "2.2.04", "ewr": "EWR-2023-112", "name": "Metro Rail Signaling", "status": "Archived", "dateCreated": "2023-12-11"},
    {"id": "p10", "wbs": "1.1.09", "ewr": "EWR-2024-033", "name": "Substation Upgrade Phase 3", "status": "Active", "dateCreated": "2024-04-05"},
    {"id": "p11", "wbs": "3.2.01", "ewr": "EWR-2023-086", "name": "Port Crane Electrical Refit", "status": "Archived", "dateCreated": "2023-09-14"},
    {"id": "p12", "wbs": "4.1.02", "ewr": "EWR-2024-018", "name": "Campus Microgrid Study", "status": "Archived", "dateCreated": "2024-02-29"},
]

SEED_STATUS_OPTIONS = ["Design", "Queue", "WIP", "RFQ", "Ordered", "Delivered", "Complete"]

SEED_ORDERS = {
    "p1": [
        {"guid": "o-1", "rfx": "RFX-118", "po": ""},
        {"guid": "o-2", "rfx": "", "po": "PO-4471"},
    ]
}

SEED_BOMS = {
    "p1": [
        {
            "guid": "g-1", "assy": True, "partNumber": "MAIN-ASSY-100", "manufacturer": "3M",
            "commercialPartNo": "", "supplied3M": True, "description": "Control Panel Assembly", "qty": 1,
            "rfx": "", "po": "", "status": "Approved", "notes": "", "custom": {},
            "children": [
                {
                    "guid": "g-2", "assy": False, "partNumber": "PN-1001", "manufacturer": "Siemens",
                    "commercialPartNo": "CP-1001", "supplied3M": False, "description": "Circuit Breaker 100A", "qty": 2,
                    "rfx": "RFX-118", "po": "", "status": "Ordered", "notes": "", "custom": {}, "children": [],
                },
                {
                    "guid": "g-3", "assy": False, "partNumber": "PN-1002", "manufacturer": "Square D",
                    "commercialPartNo": "CP-1002", "supplied3M": True, "description": "Terminal Block", "qty": 10,
                    "rfx": "", "po": "PO-4471", "status": "Received", "notes": "", "custom": {}, "children": [],
                },
                {
                    "guid": "g-4", "assy": True, "partNumber": "SUB-ASSY-200", "manufacturer": "3M",
                    "commercialPartNo": "", "supplied3M": True, "description": "Wiring Harness", "qty": 1,
                    "rfx": "", "po": "", "status": "Open", "notes": "", "custom": {},
                    "children": [
                        {
                            "guid": "g-5", "assy": False, "partNumber": "PN-2001", "manufacturer": "Belden",
                            "commercialPartNo": "CP-2001", "supplied3M": False, "description": "Wire 12AWG Red", "qty": 25,
                            "rfx": "", "po": "", "status": "Open", "notes": "", "custom": {}, "children": [],
                        },
                        {
                            "guid": "g-6", "assy": False, "partNumber": "PN-2002", "manufacturer": "Belden",
                            "commercialPartNo": "CP-2002", "supplied3M": False, "description": "Wire 12AWG Black", "qty": 25,
                            "rfx": "", "po": "", "status": "Open", "notes": "", "custom": {}, "children": [],
                        },
                        {
                            "guid": "g-7", "assy": False, "partNumber": "PN-1001", "manufacturer": "Siemens",
                            "commercialPartNo": "CP-1001", "supplied3M": False, "description": "Circuit Breaker 100A", "qty": 1,
                            "rfx": "", "po": "", "status": "Open", "notes": "Spare for harness test rig", "custom": {}, "children": [],
                        },
                    ],
                },
            ],
        },
        {
            "guid": "g-8", "assy": True, "partNumber": "MAIN-ASSY-101", "manufacturer": "3M",
            "commercialPartNo": "", "supplied3M": True, "description": "Enclosure Assembly", "qty": 1,
            "rfx": "", "po": "", "status": "Open", "notes": "", "custom": {},
            "children": [
                {
                    "guid": "g-9", "assy": False, "partNumber": "PN-3001", "manufacturer": "Hoffman",
                    "commercialPartNo": "CP-3001", "supplied3M": False, "description": "Enclosure Box NEMA4", "qty": 1,
                    "rfx": "", "po": "", "status": "Open", "notes": "", "custom": {}, "children": [],
                },
                {
                    "guid": "g-10", "assy": False, "partNumber": "PN-1002", "manufacturer": "Square D",
                    "commercialPartNo": "CP-1002", "supplied3M": True, "description": "Terminal Block", "qty": 5,
                    "rfx": "", "po": "", "status": "Open", "notes": "", "custom": {}, "children": [],
                },
            ],
        },
    ]
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    wbs TEXT NOT NULL,
    ewr TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    date_created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bom_items (
    guid TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_guid TEXT,
    position INTEGER NOT NULL,
    assy INTEGER NOT NULL DEFAULT 0,
    included_in_parent INTEGER NOT NULL DEFAULT 0,
    part_number TEXT NOT NULL DEFAULT '',
    manufacturer TEXT NOT NULL DEFAULT '',
    commercial_part_no TEXT NOT NULL DEFAULT '',
    supplied_3m INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 0,
    spare REAL NOT NULL DEFAULT 0,
    rfx TEXT NOT NULL DEFAULT '',
    po TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    custom_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_bom_items_project ON bom_items (project_id);

CREATE TABLE IF NOT EXISTS status_options (
    position INTEGER PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_fields (
    position INTEGER PRIMARY KEY,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    options_json TEXT
);

CREATE TABLE IF NOT EXISTS orders (
    guid TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    rfx TEXT NOT NULL DEFAULT '',
    po TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    supplier_name TEXT NOT NULL DEFAULT '',
    delivery_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_project ON orders (project_id);
"""


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def insert_tree(conn, project_id, nodes, parent_guid):
    for i, n in enumerate(nodes):
        conn.execute(
            """INSERT INTO bom_items
               (guid, project_id, parent_guid, position, assy, included_in_parent, part_number,
                manufacturer, commercial_part_no, supplied_3m, description, qty, spare, rfx, po,
                status, notes, custom_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                n["guid"], project_id, parent_guid, i,
                1 if n.get("assy") else 0,
                1 if n.get("includedInParent") else 0,
                n.get("partNumber", ""), n.get("manufacturer", ""), n.get("commercialPartNo", ""),
                1 if n.get("supplied3M") else 0,
                n.get("description", ""), n.get("qty", 0) or 0, n.get("spare", 0) or 0,
                n.get("rfx", ""), n.get("po", ""), n.get("status", ""), n.get("notes", ""),
                json.dumps(n.get("custom") or {}),
            ),
        )
        children = n.get("children") or []
        if children:
            insert_tree(conn, project_id, children, n["guid"])


def seed_database(conn):
    for p in SEED_PROJECTS:
        conn.execute(
            "INSERT INTO projects (id, wbs, ewr, name, status, date_created) VALUES (?,?,?,?,?,?)",
            (p["id"], p["wbs"], p["ewr"], p["name"], p["status"], p["dateCreated"]),
        )
    for i, v in enumerate(SEED_STATUS_OPTIONS):
        conn.execute("INSERT INTO status_options (position, value) VALUES (?,?)", (i, v))
    for project_id, tree in SEED_BOMS.items():
        insert_tree(conn, project_id, tree, None)
    for project_id, order_list in SEED_ORDERS.items():
        for i, o in enumerate(order_list):
            conn.execute(
                "INSERT INTO orders (guid, project_id, position, rfx, po) VALUES (?,?,?,?,?)",
                (o["guid"], project_id, i, o.get("rfx", ""), o.get("po", "")),
            )
    conn.commit()


def migrate_db(conn):
    """Add columns/tables introduced after a database already exists.
    CREATE TABLE IF NOT EXISTS won't add columns to an existing table, so
    new columns need an explicit, idempotent ALTER TABLE here."""
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(bom_items)")}
    if "included_in_parent" not in existing:
        conn.execute("ALTER TABLE bom_items ADD COLUMN included_in_parent INTEGER NOT NULL DEFAULT 0")
    if "spare" not in existing:
        conn.execute("ALTER TABLE bom_items ADD COLUMN spare REAL NOT NULL DEFAULT 0")

    order_cols = {row["name"] for row in conn.execute("PRAGMA table_info(orders)")}
    for col in ("description", "supplier_name", "delivery_date", "status"):
        if col not in order_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN %s TEXT NOT NULL DEFAULT ''" % col)
    conn.commit()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    migrate_db(conn)
    row = conn.execute("SELECT COUNT(*) AS n FROM projects").fetchone()
    if row["n"] == 0:
        seed_database(conn)
    conn.close()


def project_row_to_json(row):
    return {
        "id": row["id"],
        "wbs": row["wbs"],
        "ewr": row["ewr"],
        "name": row["name"],
        "status": row["status"],
        "dateCreated": row["date_created"],
    }


def bom_row_to_node(row):
    return {
        "guid": row["guid"],
        "assy": bool(row["assy"]),
        "includedInParent": bool(row["included_in_parent"]),
        "partNumber": row["part_number"],
        "manufacturer": row["manufacturer"],
        "commercialPartNo": row["commercial_part_no"],
        "supplied3M": bool(row["supplied_3m"]),
        "description": row["description"],
        "qty": row["qty"],
        "spare": row["spare"],
        "rfx": row["rfx"],
        "po": row["po"],
        "status": row["status"],
        "notes": row["notes"],
        "custom": json.loads(row["custom_json"] or "{}"),
        "children": [],
    }


def build_tree(rows):
    by_guid = {}
    roots = []
    for row in rows:
        by_guid[row["guid"]] = {"node": bom_row_to_node(row), "parent_guid": row["parent_guid"]}
    for entry in by_guid.values():
        parent_guid = entry["parent_guid"]
        if parent_guid and parent_guid in by_guid:
            by_guid[parent_guid]["node"]["children"].append(entry["node"])
        else:
            roots.append(entry["node"])
    return roots


ERROR_LOG = BASE_DIR / "server-error.log"
DEFAULT_EXPORT_PATH = BASE_DIR / "data" / "export.json"


def log_problem(message):
    """Report a server-side problem to the console, or to a log file when
    running windowless (where sys.stderr is None)."""
    line = message.rstrip("\n")
    if sys.stderr is not None:
        sys.stderr.write(line + "\n")
        return
    try:
        with open(ERROR_LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass  # nothing else we can usefully do


def resolve_export_path():
    """Where the flat JSON snapshot is written. Kept configurable so the file
    can live on a shared/network drive that other people query, rather than
    inside the app folder. Precedence, first non-empty wins:

      1. BOM_EXPORT_PATH environment variable (power-user override).
      2. config.ini  ->  [paths] export_json = <path>
      3. Default: data/export.json next to this script (backward compatible).

    Relative paths resolve against the app folder; absolute paths — including
    mapped drives (Z:\\...) and UNC shares (\\\\server\\share\\...) — are used
    as-is. Any trouble reading config falls back to the default rather than
    preventing the server from starting."""
    raw = os.environ.get("BOM_EXPORT_PATH", "").strip()
    if not raw and CONFIG_PATH.exists():
        try:
            parser = configparser.ConfigParser()
            parser.read(CONFIG_PATH, encoding="utf-8")
            raw = parser.get("paths", "export_json", fallback="").strip()
        except (configparser.Error, OSError):
            log_problem("Could not read config.ini; using the default export "
                        "path:\n" + traceback.format_exc())
            raw = ""
    if not raw:
        return DEFAULT_EXPORT_PATH
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (BASE_DIR / path).resolve()
    return path


EXPORT_JSON_PATH = resolve_export_path()


# ---------------------------------------------------------------------------
# Flattened export for Excel / data connections.
#
# Excel's Power Query works best with flat tables, not the nested BOM tree,
# so this produces one row per BOM line with the same derived fields the app
# shows: computed Item No, level (depth), PO looked up from the matching
# order, and RFx/Status inherited from a parent when "Included in Parent".
# ---------------------------------------------------------------------------

def _fetch_ordered_tree(conn, project_id):
    """Returns roots as [{row, children:[...]}], children in position order."""
    rows = conn.execute(
        "SELECT * FROM bom_items WHERE project_id=? ORDER BY position", (project_id,)
    ).fetchall()
    entries = {r["guid"]: {"row": r, "children": []} for r in rows}
    roots = []
    for r in rows:
        parent = r["parent_guid"]
        if parent and parent in entries:
            entries[parent]["children"].append(entries[r["guid"]])
        else:
            roots.append(entries[r["guid"]])
    for e in entries.values():
        e["children"].sort(key=lambda c: c["row"]["position"])
    roots.sort(key=lambda c: c["row"]["position"])
    return roots, entries


def _orders_for_project(conn, project_id):
    return conn.execute(
        """SELECT guid, rfx, po, description, supplier_name, delivery_date, status
           FROM orders WHERE project_id=? ORDER BY position""",
        (project_id,),
    ).fetchall()


def _flatten_project(project, roots, entries, orders, custom_keys):
    def lookup_po(rfx):
        rfx = (rfx or "").strip()
        if not rfx:
            return ""
        for o in orders:
            if (o["rfx"] or "").strip() == rfx:
                return (o["po"] or "").strip()
        return ""

    def resolve(entry):
        # Walk up while "Included in Parent" to find the line that owns the order.
        node = entry
        guard = set()
        while node["row"]["included_in_parent"] and node["row"]["guid"] not in guard:
            guard.add(node["row"]["guid"])
            parent = entries.get(node["row"]["parent_guid"])
            if not parent:
                break
            node = parent
        return (node["row"]["rfx"] or "").strip(), node["row"]["status"] or ""

    lines = []

    def walk(items, prefix):
        for i, e in enumerate(items):
            r = e["row"]
            item_no = (prefix + "." + str(i + 1)) if prefix else str(i + 1)
            eff_rfx, eff_status = resolve(e)
            line = {
                "projectId": project["id"],
                "projectWbs": project["wbs"],
                "projectName": project["name"],
                "itemNo": item_no,
                "level": item_no.count("."),
                "guid": r["guid"],
                "assy": bool(r["assy"]),
                "includedInParent": bool(r["included_in_parent"]),
                "partNumber": r["part_number"],
                "qty": r["qty"],
                "spare": r["spare"],
                "manufacturer": r["manufacturer"],
                "commercialPartNo": r["commercial_part_no"],
                "supplied3M": bool(r["supplied_3m"]),
                "description": r["description"],
                "rfx": eff_rfx,
                "po": lookup_po(eff_rfx),
                "status": eff_status,
                "notes": r["notes"],
            }
            custom = json.loads(r["custom_json"] or "{}")
            for k in custom_keys:  # uniform columns across every line
                line["custom_" + k] = custom.get(k, "")
            lines.append(line)
            walk(e["children"], item_no)

    walk(roots, "")
    return lines


def build_export_payload(conn, project_filter=None):
    projects = [project_row_to_json(r) for r in conn.execute("SELECT * FROM projects")]
    if project_filter:
        projects = [p for p in projects if p["id"] == project_filter]

    custom_keys = [r["key"] for r in conn.execute("SELECT key FROM custom_fields ORDER BY position")]

    all_orders = []
    all_lines = []
    for p in projects:
        orders = _orders_for_project(conn, p["id"])
        for o in orders:
            all_orders.append({
                "projectId": p["id"], "projectWbs": p["wbs"], "projectName": p["name"],
                "guid": o["guid"], "rfx": o["rfx"], "po": o["po"],
                "description": o["description"], "supplierName": o["supplier_name"],
                "deliveryDate": o["delivery_date"], "status": o["status"],
            })
        roots, entries = _fetch_ordered_tree(conn, p["id"])
        all_lines.extend(_flatten_project(p, roots, entries, orders, custom_keys))

    return {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "projects": projects,
        "orders": all_orders,
        "bomLines": all_lines,
    }


def _replace_with_retry(src, dst, attempts=5, delay=0.2):
    """os.replace(src, dst), retried a few times. On Windows a reader that is
    briefly holding the target open (e.g. Excel refreshing a query on a shared
    drive) makes the replace fail with PermissionError; a short retry lets the
    write land instead of being dropped."""
    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay)


def _atomic_write_json(path, payload):
    """Write JSON to `path` via a unique temp file in the same directory, then
    atomically rename it into place. Unique temp names (rather than a fixed
    ".tmp") keep concurrent writers from colliding; same-directory rename keeps
    the swap atomic even across a network share. Creates the parent directory
    if missing, and never raises — a temporarily-unavailable share is logged,
    not fatal."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(path.parent),
                                        prefix=path.name + ".", suffix=".tmp")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
            _replace_with_retry(tmp, path)
        finally:
            # If the rename succeeded, tmp is gone; otherwise clean it up.
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass
    except Exception:
        log_problem("Failed to write export JSON to %s:\n%s"
                    % (path, traceback.format_exc()))


def write_export_file(conn=None):
    """(Re)writes the flat JSON snapshot at EXPORT_JSON_PATH so a file-based
    Excel connection always sees current data. Reads the DB, then writes
    atomically. Safe to call from any thread (opens its own connection when one
    isn't supplied)."""
    own_conn = conn is None
    if own_conn:
        conn = get_connection()
    try:
        payload = build_export_payload(conn)
    except Exception:
        log_problem("Failed to build export payload:\n" + traceback.format_exc())
        return
    finally:
        if own_conn:
            conn.close()
    _atomic_write_json(EXPORT_JSON_PATH, payload)


# ---------------------------------------------------------------------------
# Background, debounced export writer.
#
# Mutations mark the export "dirty" instead of writing the file inline, so a
# slow or momentarily-unavailable shared drive never adds latency to — or
# blocks — an API response. A single daemon thread coalesces a burst of edits
# into one write, and is the only thread that writes the file, so writes are
# naturally serialized.
# ---------------------------------------------------------------------------

_export_dirty = threading.Event()
_export_stop = threading.Event()
_EXPORT_DEBOUNCE_SECONDS = 0.75


def mark_export_dirty():
    """Request a (re)write of the export file soon. Cheap and non-blocking."""
    _export_dirty.set()


def _export_writer_loop():
    while not _export_stop.is_set():
        _export_dirty.wait()  # sleep until an edit (or shutdown) wakes us
        if _export_stop.is_set():
            break
        # Let a burst of rapid edits settle, then write once. Clearing the
        # flag *before* reading the DB means any edit that arrives during the
        # write re-sets it and triggers a follow-up write with the newer data,
        # so no change is ever lost (at worst one redundant write).
        time.sleep(_EXPORT_DEBOUNCE_SECONDS)
        _export_dirty.clear()
        write_export_file()


def start_export_writer():
    thread = threading.Thread(target=_export_writer_loop, name="export-writer",
                              daemon=True)
    thread.start()
    return thread


def stop_export_writer():
    """Stop the writer and flush one final time so the last edit isn't lost."""
    _export_stop.set()
    _export_dirty.set()  # wake the loop so it can notice the stop
    write_export_file()


# ---------------------------------------------------------------------------
# HTTP handler: static files + /api/* JSON routes, same origin/port.
# ---------------------------------------------------------------------------

class Handler(http.server.SimpleHTTPRequestHandler):
    # Speak HTTP/1.1 so connections are kept alive and closed cleanly.
    # Under the default HTTP/1.0 the server closes the socket after every
    # response; on Windows, closing while the browser has already pipelined
    # its next keep-alive request sends a TCP RST, and the browser reports
    # the in-flight response as ERR_CONNECTION_RESET. That showed up as the
    # page loading with js/project.js (or an /api call) randomly missing.
    # Every response here sets Content-Length, which HTTP/1.1 requires.
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    # When launched windowless (pythonw, via start-app.bat) there is no
    # console and sys.stderr is None. http.server logs every request straight
    # to sys.stderr, which would raise AttributeError inside each request and
    # kill the connection before a response is sent. Route logging
    # accordingly: normal request lines are dropped, errors go to a file so
    # problems are still diagnosable.
    def log_message(self, fmt, *args):
        if sys.stderr is not None:
            super().log_message(fmt, *args)

    def log_error(self, fmt, *args):
        log_problem("%s - %s" % (self.address_string(), fmt % args))

    def end_headers(self):
        # This is a local dev server editing files in place; browser caching
        # of the HTML/CSS/JS just serves stale code after an edit.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def send_head(self):
        # SimpleHTTPRequestHandler answers 304 Not Modified from
        # If-Modified-Since regardless of Cache-Control, so suppress that
        # header to force a full re-send.
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        return super().send_head()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw) if raw else None

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._handle_api("GET")
        if self.path == "/favicon.ico":
            # The app ships no icon; answer politely instead of logging a 404
            # on every page load and burying real errors.
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        return super().do_GET()

    def do_PUT(self):
        if self.path.startswith("/api/"):
            return self._handle_api("PUT")
        self._read_json_body()  # drain, so keep-alive stays in sync
        self._send_json(405, {"error": "Method not allowed"})

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._handle_api("POST")
        self._read_json_body()
        self._send_json(405, {"error": "Method not allowed"})

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            return self._handle_api("DELETE")
        self._send_json(405, {"error": "Method not allowed"})

    def _handle_api(self, method):
        path = urllib.parse.urlsplit(self.path).path
        # Read the body up front. Under HTTP/1.1 keep-alive an unread request
        # body would be parsed as the start of the next request, so this must
        # happen even on routes that end up 404ing.
        body = self._read_json_body() if method in ("PUT", "POST") else None
        try:
            conn = get_connection()
            try:
                if path == "/api/data.json" and method == "GET":
                    # Flat, Excel-friendly snapshot of everything (or one
                    # project with ?project=<id>). Point Power Query here.
                    qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    project_filter = qs.get("project", [None])[0]
                    return self._send_json(200, build_export_payload(conn, project_filter))

                if path == "/api/data-info" and method == "GET":
                    # Lets the UI show the on-disk path of the kept-in-sync file.
                    return self._send_json(200, {"filePath": str(EXPORT_JSON_PATH)})

                if path == "/api/projects" and method == "GET":
                    rows = conn.execute("SELECT * FROM projects").fetchall()
                    return self._send_json(200, [project_row_to_json(r) for r in rows])

                if path == "/api/projects" and method == "PUT":
                    projects = body or []
                    conn.execute("DELETE FROM projects")
                    for p in projects:
                        conn.execute(
                            "INSERT INTO projects (id, wbs, ewr, name, status, date_created) VALUES (?,?,?,?,?,?)",
                            (p["id"], p["wbs"], p["ewr"], p["name"], p["status"], p["dateCreated"]),
                        )
                    conn.commit()
                    mark_export_dirty()
                    return self._send_json(200, {"ok": True})

                m = re.match(r"^/api/projects/([^/]+)$", path)
                if m and method == "DELETE":
                    project_id = urllib.parse.unquote(m.group(1))
                    # Cascade: a project owns its BOM lines and orders.
                    conn.execute("DELETE FROM bom_items WHERE project_id=?", (project_id,))
                    conn.execute("DELETE FROM orders WHERE project_id=?", (project_id,))
                    conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
                    conn.commit()
                    mark_export_dirty()
                    return self._send_json(200, {"ok": True})

                m = re.match(r"^/api/bom/([^/]+)$", path)
                if m and method == "GET":
                    project_id = urllib.parse.unquote(m.group(1))
                    rows = conn.execute(
                        "SELECT * FROM bom_items WHERE project_id=? ORDER BY parent_guid, position",
                        (project_id,),
                    ).fetchall()
                    return self._send_json(200, build_tree(rows))

                if m and method == "PUT":
                    project_id = urllib.parse.unquote(m.group(1))
                    tree = body or []
                    conn.execute("DELETE FROM bom_items WHERE project_id=?", (project_id,))
                    insert_tree(conn, project_id, tree, None)
                    conn.commit()
                    mark_export_dirty()
                    return self._send_json(200, {"ok": True})

                m = re.match(r"^/api/orders/([^/]+)$", path)
                if m and method == "GET":
                    project_id = urllib.parse.unquote(m.group(1))
                    rows = conn.execute(
                        """SELECT guid, rfx, po, description, supplier_name, delivery_date, status
                           FROM orders WHERE project_id=? ORDER BY position""",
                        (project_id,),
                    ).fetchall()
                    return self._send_json(200, [
                        {
                            "guid": r["guid"], "rfx": r["rfx"], "po": r["po"],
                            "description": r["description"], "supplierName": r["supplier_name"],
                            "deliveryDate": r["delivery_date"], "status": r["status"],
                        }
                        for r in rows
                    ])

                if m and method == "PUT":
                    project_id = urllib.parse.unquote(m.group(1))
                    orders = body or []
                    conn.execute("DELETE FROM orders WHERE project_id=?", (project_id,))
                    for i, o in enumerate(orders):
                        conn.execute(
                            """INSERT INTO orders
                               (guid, project_id, position, rfx, po, description, supplier_name,
                                delivery_date, status)
                               VALUES (?,?,?,?,?,?,?,?,?)""",
                            (
                                o["guid"], project_id, i, o.get("rfx", ""), o.get("po", ""),
                                o.get("description", ""), o.get("supplierName", ""),
                                o.get("deliveryDate", ""), o.get("status", ""),
                            ),
                        )
                    conn.commit()
                    mark_export_dirty()
                    return self._send_json(200, {"ok": True})

                if path == "/api/status-options" and method == "GET":
                    rows = conn.execute("SELECT value FROM status_options ORDER BY position").fetchall()
                    return self._send_json(200, [r["value"] for r in rows])

                if path == "/api/status-options" and method == "PUT":
                    values = body or []
                    conn.execute("DELETE FROM status_options")
                    for i, v in enumerate(values):
                        conn.execute("INSERT INTO status_options (position, value) VALUES (?,?)", (i, v))
                    conn.commit()
                    mark_export_dirty()
                    return self._send_json(200, {"ok": True})

                if path == "/api/custom-fields" and method == "GET":
                    rows = conn.execute("SELECT * FROM custom_fields ORDER BY position").fetchall()
                    result = []
                    for r in rows:
                        field = {"key": r["key"], "label": r["label"], "type": r["type"]}
                        if r["options_json"]:
                            field["options"] = json.loads(r["options_json"])
                        result.append(field)
                    return self._send_json(200, result)

                if path == "/api/custom-fields" and method == "PUT":
                    fields = body or []
                    conn.execute("DELETE FROM custom_fields")
                    for i, f in enumerate(fields):
                        conn.execute(
                            "INSERT INTO custom_fields (position, key, label, type, options_json) VALUES (?,?,?,?,?)",
                            (i, f["key"], f["label"], f["type"], json.dumps(f["options"]) if f.get("options") else None),
                        )
                    conn.commit()
                    mark_export_dirty()
                    return self._send_json(200, {"ok": True})

                self._send_json(404, {"error": "Not found: " + method + " " + path})
            finally:
                conn.close()
        except Exception as e:
            log_problem("API %s %s failed:\n%s" % (method, path, traceback.format_exc()))
            self._send_json(500, {"error": str(e)})


class Server(http.server.ThreadingHTTPServer):
    # Windows lets several sockets share a port when SO_REUSEADDR is set
    # (unlike Linux), so the default would silently allow a second copy of
    # this server to start on 8791. Requests then land on whichever process
    # answers first — including stale ones running old code. Refuse instead,
    # so starting twice reports the clash rather than causing odd behaviour.
    allow_reuse_address = False
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Default implementation prints the traceback to sys.stderr, which is
        # None when running windowless.
        log_problem("Error handling request from %s:\n%s" % (client_address, traceback.format_exc()))


def main():
    init_db()
    write_export_file()  # ensure data/export.json exists and is current at start
    try:
        server = Server(("localhost", PORT), Handler)
    except OSError:
        # Plain ASCII: the Windows console this runs in isn't UTF-8.
        print("Port " + str(PORT) + " is already in use - the app is probably already running.")
        print("Open http://localhost:" + str(PORT) + " , or close the other server window and retry.")
        return 1

    start_export_writer()

    default_note = "" if EXPORT_JSON_PATH == DEFAULT_EXPORT_PATH else "  (relocated via config)"
    print("Serving " + str(BASE_DIR) + " at http://localhost:" + str(PORT))
    print("Database: " + str(DB_PATH))
    print("Excel data URL: http://localhost:" + str(PORT) + "/api/data.json")
    print("Excel data file: " + str(EXPORT_JSON_PATH) + default_note)
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()
    finally:
        stop_export_writer()  # final flush so the last edit isn't lost
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
