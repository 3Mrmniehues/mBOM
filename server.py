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
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
from pathlib import Path

import db  # database backend abstraction (SQLite locally, Postgres on Render)

# When packaged as a one-file .exe (PyInstaller) the bundled static site is
# unpacked to a temporary folder (sys._MEIPASS) that is read-only and wiped
# between runs, so the database, config, logs and export file must live next to
# the .exe instead. BASE_DIR = where the static assets are; DATA_DIR = where
# persistent files go. Running as a plain script, the two are the same folder,
# so behaviour is unchanged.
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)                      # bundled static site (temp, read-only)
    DATA_DIR = Path(sys.executable).resolve().parent   # persistent, next to the .exe
else:
    BASE_DIR = Path(__file__).resolve().parent
    DATA_DIR = BASE_DIR
DB_PATH = Path(os.environ.get("BOM_DB_PATH", str(DATA_DIR / "data" / "app.db")))
CONFIG_PATH = DATA_DIR / "config.ini"

# Hosting: on Render the platform sets PORT (and RENDER=true) and injects
# DATABASE_URL for the managed Postgres. Locally none of these are set, so we
# keep the historical localhost:8791 behaviour and the SQLite file.
HOSTED = bool(os.environ.get("RENDER") or os.environ.get("DATABASE_URL"))
PORT = int(os.environ.get("PORT", "8791"))
HOST = "0.0.0.0" if HOSTED else "localhost"

# ---- Authentication / accounts ----
# Preset accounts only: the first admin is bootstrapped from these env vars.
# Locally they default to admin/admin (localhost-only) with a warning to change.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SESSION_COOKIE = "mbom_session"
SESSION_TTL_DAYS = 30
PBKDF2_ITERATIONS = 200000
# Send the Secure cookie flag when served over HTTPS (Render terminates TLS).
SESSION_SECURE = bool(os.environ.get("SESSION_SECURE")) or HOSTED

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
    user_id TEXT,
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
    user_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, position)
);

CREATE TABLE IF NOT EXISTS custom_fields (
    user_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    options_json TEXT,
    PRIMARY KEY (user_id, position)
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

CREATE TABLE IF NOT EXISTS parts_list (
    guid TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    assy INTEGER NOT NULL DEFAULT 0,
    part_number TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 0,
    spare REAL NOT NULL DEFAULT 0,
    manufacturer TEXT NOT NULL DEFAULT '',
    commercial_part_no TEXT NOT NULL DEFAULT '',
    supplied_3m INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    children_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_parts_project ON parts_list (project_id);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
"""


def get_connection():
    return db.connect(DB_PATH)


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


# New (per-user) shapes for the two tables that used to be global, used to
# rebuild them when upgrading a pre-multi-user database (see reshape below).
STATUS_OPTIONS_DDL = (
    "CREATE TABLE status_options (user_id TEXT NOT NULL, position INTEGER NOT NULL, "
    "value TEXT NOT NULL, PRIMARY KEY (user_id, position));"
)
CUSTOM_FIELDS_DDL = (
    "CREATE TABLE custom_fields (user_id TEXT NOT NULL, position INTEGER NOT NULL, "
    "key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL, options_json TEXT, "
    "PRIMARY KEY (user_id, position));"
)


# ---------------------------------------------------------------------------
# Accounts, passwords, sessions
# ---------------------------------------------------------------------------

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def hash_password(password, salt=None, iterations=PBKDF2_ITERATIONS):
    """PBKDF2-HMAC-SHA256 (stdlib). Returns (hash_hex, salt_hex, iterations)."""
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations)
    return dk.hex(), salt, iterations


def verify_password(password, password_hash, salt, iterations):
    calc, _, _ = hash_password(password, salt, iterations)
    return hmac.compare_digest(calc, password_hash)


def create_user(conn, username, password, is_admin=False):
    """Insert a user row (no data seeded here). Raises ValueError on bad input."""
    username = (username or "").strip()
    if not username or not password:
        raise ValueError("Username and password are required.")
    uid = "u-" + secrets.token_hex(8)
    ph, salt, iters = hash_password(password)
    conn.execute(
        "INSERT INTO users (id, username, password_hash, salt, iterations, is_admin, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (uid, username, ph, salt, iters, 1 if is_admin else 0, now_iso()),
    )
    return uid


def seed_status_options_for_user(conn, user_id):
    """Give a user the default status list, but only if they have none yet."""
    if not user_id:
        return
    row = conn.execute("SELECT COUNT(*) AS n FROM status_options WHERE user_id=?", (user_id,)).fetchone()
    if row["n"]:
        return
    for i, v in enumerate(SEED_STATUS_OPTIONS):
        conn.execute("INSERT INTO status_options (user_id, position, value) VALUES (?,?,?)", (user_id, i, v))


def create_session(conn, user_id):
    token = secrets.token_urlsafe(32)
    now = datetime.datetime.now(datetime.timezone.utc)
    expires = now + datetime.timedelta(days=SESSION_TTL_DAYS)
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (token, user_id, now.isoformat(), expires.isoformat()),
    )
    return token


def user_for_session(conn, token):
    if not token:
        return None
    row = conn.execute(
        "SELECT s.expires_at AS expires_at, u.id AS id, u.username AS username, u.is_admin AS is_admin "
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=?",
        (token,),
    ).fetchone()
    if not row:
        return None
    try:
        if datetime.datetime.fromisoformat(row["expires_at"]) < datetime.datetime.now(datetime.timezone.utc):
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
            conn.commit()
            return None
    except (ValueError, TypeError):
        pass
    return {"id": row["id"], "username": row["username"], "is_admin": row["is_admin"]}


def delete_session(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))
        conn.commit()


# ---------------------------------------------------------------------------
# Schema migration + first-run bootstrap
# ---------------------------------------------------------------------------

def migrate_db(conn):
    """Idempotent column additions for a database created before these existed."""
    bom_cols = db.table_columns(conn, "bom_items")
    if "included_in_parent" not in bom_cols:
        conn.execute("ALTER TABLE bom_items ADD COLUMN included_in_parent INTEGER NOT NULL DEFAULT 0")
    if "spare" not in bom_cols:
        conn.execute("ALTER TABLE bom_items ADD COLUMN spare REAL NOT NULL DEFAULT 0")

    order_cols = db.table_columns(conn, "orders")
    for col in ("description", "supplier_name", "delivery_date", "status"):
        if col not in order_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN %s TEXT NOT NULL DEFAULT ''" % col)

    if "user_id" not in db.table_columns(conn, "projects"):
        conn.execute("ALTER TABLE projects ADD COLUMN user_id TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id)")
    conn.commit()


def _all_tables(conn):
    if db.USE_POSTGRES:
        rows = conn.execute(
            "SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public'"
        ).fetchall()
    else:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r["name"] for r in rows}


def reshape_per_user_tables(conn):
    """status_options/custom_fields gained a user_id + composite PK. If an old,
    global-shaped table is present, rename it aside and create the new (empty)
    shape; rows are re-homed to the admin in finalize_user_migration()."""
    for table, create_sql in (("status_options", STATUS_OPTIONS_DDL), ("custom_fields", CUSTOM_FIELDS_DDL)):
        if "user_id" in db.table_columns(conn, table):
            continue
        conn.execute("ALTER TABLE %s RENAME TO %s__old" % (table, table))
        conn.executescript(create_sql)
    conn.commit()


def finalize_user_migration(conn, admin_id):
    """Move rows stashed by reshape_per_user_tables() onto the admin account."""
    if not admin_id:
        return
    tables = _all_tables(conn)
    if "status_options__old" in tables:
        for r in conn.execute("SELECT position, value FROM status_options__old ORDER BY position").fetchall():
            conn.execute("INSERT INTO status_options (user_id, position, value) VALUES (?,?,?)",
                         (admin_id, r["position"], r["value"]))
        conn.execute("DROP TABLE status_options__old")
    if "custom_fields__old" in tables:
        for r in conn.execute("SELECT position, key, label, type, options_json FROM custom_fields__old ORDER BY position").fetchall():
            conn.execute(
                "INSERT INTO custom_fields (user_id, position, key, label, type, options_json) VALUES (?,?,?,?,?,?)",
                (admin_id, r["position"], r["key"], r["label"], r["type"], r["options_json"]))
        conn.execute("DROP TABLE custom_fields__old")
    conn.commit()


def ensure_admin(conn):
    """Return the id of an admin user, creating the first one from
    ADMIN_USERNAME/ADMIN_PASSWORD when the users table is empty."""
    row = conn.execute("SELECT id FROM users WHERE is_admin=1 ORDER BY created_at LIMIT 1").fetchone()
    if row:
        return row["id"]
    any_user = conn.execute("SELECT id FROM users LIMIT 1").fetchone()
    if any_user:
        return any_user["id"]
    username, password = ADMIN_USERNAME, ADMIN_PASSWORD
    if not username or not password:
        if HOSTED:
            raise RuntimeError(
                "ADMIN_USERNAME and ADMIN_PASSWORD must be set to create the first account.")
        username = username or "admin"
        password = password or "admin"
        log_problem("No ADMIN_USERNAME/ADMIN_PASSWORD set; created local admin '%s' with a "
                    "default password. Set those env vars (or change it) for real use." % username)
    return create_user(conn, username, password, is_admin=True)


def claim_orphans(conn, admin_id):
    """Assign pre-multi-user rows (projects with no owner) to the admin."""
    if admin_id:
        conn.execute("UPDATE projects SET user_id=? WHERE user_id IS NULL", (admin_id,))


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    migrate_db(conn)                # add columns (incl. projects.user_id)
    reshape_per_user_tables(conn)   # rebuild status/custom tables if old-shaped
    admin_id = ensure_admin(conn)   # bootstrap the first admin account
    finalize_user_migration(conn, admin_id)  # re-home migrated status/custom rows
    claim_orphans(conn, admin_id)   # assign existing projects to the admin
    seed_status_options_for_user(conn, admin_id)
    conn.commit()
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


ERROR_LOG = DATA_DIR / "server-error.log"
DEFAULT_EXPORT_PATH = DATA_DIR / "data" / "export.json"


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
        path = (DATA_DIR / path).resolve()
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


def build_export_payload(conn, project_filter=None, user_id=None):
    if user_id is None:
        rows = conn.execute("SELECT * FROM projects")
        custom_rows = conn.execute("SELECT key FROM custom_fields ORDER BY position")
    else:
        rows = conn.execute("SELECT * FROM projects WHERE user_id=?", (user_id,))
        custom_rows = conn.execute(
            "SELECT key FROM custom_fields WHERE user_id=? ORDER BY position", (user_id,))
    projects = [project_row_to_json(r) for r in rows]
    if project_filter:
        projects = [p for p in projects if p["id"] == project_filter]

    custom_keys = [r["key"] for r in custom_rows]

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
# Export snapshot lifecycle.
#
# The flat JSON snapshot (for a file-based Excel connection) is written only
# when the app starts and when it stops — deliberately NOT on every edit — so
# ongoing work never touches the (possibly shared/network) file. main() writes
# it once at start and once on the way down; the POST /api/shutdown route lets
# stop-app.bat trigger a graceful stop so that final write actually runs (a
# forced kill can't run it). To refresh it mid-session, restart the app.
# ---------------------------------------------------------------------------

# Set in main() once the server exists, so the /api/shutdown route can stop it.
_httpd = None


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

    # Serve .webmanifest with the correct type (Python's mimetypes doesn't know
    # it). A copy so we don't mutate the shared base-class map.
    extensions_map = dict(
        http.server.SimpleHTTPRequestHandler.extensions_map,
        **{".webmanifest": "application/manifest+json"},
    )

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

    def _send_json(self, status, payload, headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw) if raw else None

    # ---- Sessions / auth ----
    def _session_token(self):
        raw = self.headers.get("Cookie", "") or ""
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == SESSION_COOKIE:
                return value
        return None

    def _current_user(self, conn):
        return user_for_session(conn, self._session_token())

    def _cookie_header(self, token, max_age):
        parts = [SESSION_COOKIE + "=" + token, "HttpOnly", "Path=/",
                 "SameSite=Lax", "Max-Age=" + str(max_age)]
        if SESSION_SECURE:
            parts.append("Secure")
        return "; ".join(parts)

    def _handle_login(self, conn, body):
        username = ((body or {}).get("username") or "").strip()
        password = (body or {}).get("password") or ""
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not row or not verify_password(password, row["password_hash"], row["salt"], row["iterations"]):
            return self._send_json(401, {"error": "Invalid username or password."})
        token = create_session(conn, row["id"])
        conn.commit()
        return self._send_json(
            200, {"ok": True, "username": row["username"], "isAdmin": bool(row["is_admin"])},
            headers=[("Set-Cookie", self._cookie_header(token, SESSION_TTL_DAYS * 86400))])

    def _handle_logout(self, conn):
        delete_session(conn, self._session_token())
        return self._send_json(200, {"ok": True},
                               headers=[("Set-Cookie", self._cookie_header("", 0))])

    def _is_authenticated(self):
        conn = get_connection()
        try:
            return self._current_user(conn) is not None
        finally:
            conn.close()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._handle_api("GET")
        # App pages require a login; static assets (css/js/icons/login) stay open.
        page = urllib.parse.urlsplit(self.path).path
        if page in ("/", "/index.html", "/project.html") and not self._is_authenticated():
            self.send_response(302)
            self.send_header("Location", "/login.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        if self.path == "/favicon.ico" and not (BASE_DIR / "favicon.ico").exists():
            # No icon shipped: answer politely instead of logging a 404 on
            # every page load and burying real errors. (When favicon.ico is
            # present it falls through and is served like any other file.)
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

        if path == "/api/shutdown" and method == "POST":
            # Local-only: a hosted visitor must not be able to stop the shared
            # server. Graceful stop so the export snapshot is written on the way
            # down (main's finally); shutdown() runs off this request thread or
            # it deadlocks waiting for this very request to finish.
            if HOSTED:
                return self._send_json(403, {"error": "Shutdown is disabled on the hosted app."})
            if _httpd is not None:
                threading.Thread(target=_httpd.shutdown, daemon=True).start()
            return self._send_json(200, {"ok": True, "stopping": True})

        try:
            conn = get_connection()
            try:
                # ---- Authentication (login needs no session) ----
                if path == "/api/login" and method == "POST":
                    return self._handle_login(conn, body)
                if path == "/api/logout" and method == "POST":
                    return self._handle_logout(conn)

                user = self._current_user(conn)
                if user is None:
                    return self._send_json(401, {"error": "Not authenticated"})
                uid = user["id"]

                if path == "/api/me" and method == "GET":
                    return self._send_json(200, {"username": user["username"], "isAdmin": bool(user["is_admin"])})

                # ---- Admin: preset-account management ----
                if path == "/api/users":
                    if not user["is_admin"]:
                        return self._send_json(403, {"error": "Admin only"})
                    if method == "GET":
                        rows = conn.execute(
                            "SELECT id, username, is_admin, created_at FROM users ORDER BY created_at").fetchall()
                        return self._send_json(200, [
                            {"id": r["id"], "username": r["username"],
                             "isAdmin": bool(r["is_admin"]), "createdAt": r["created_at"]}
                            for r in rows])
                    if method == "POST":
                        data = body or {}
                        uname = (data.get("username") or "").strip()
                        if conn.execute("SELECT id FROM users WHERE username=?", (uname,)).fetchone():
                            return self._send_json(409, {"error": "That username already exists."})
                        try:
                            new_id = create_user(conn, uname, data.get("password"), bool(data.get("isAdmin")))
                        except ValueError as ve:
                            return self._send_json(400, {"error": str(ve)})
                        seed_status_options_for_user(conn, new_id)
                        conn.commit()
                        return self._send_json(200, {"ok": True, "id": new_id})

                m_pw = re.match(r"^/api/users/([^/]+)/password$", path)
                if m_pw and method == "POST":
                    if not user["is_admin"]:
                        return self._send_json(403, {"error": "Admin only"})
                    target_id = urllib.parse.unquote(m_pw.group(1))
                    new_pw = (body or {}).get("password") or ""
                    if not new_pw:
                        return self._send_json(400, {"error": "Password required."})
                    ph, salt, iters = hash_password(new_pw)
                    conn.execute("UPDATE users SET password_hash=?, salt=?, iterations=? WHERE id=?",
                                 (ph, salt, iters, target_id))
                    conn.execute("DELETE FROM sessions WHERE user_id=?", (target_id,))  # force re-login
                    conn.commit()
                    return self._send_json(200, {"ok": True})

                m_user = re.match(r"^/api/users/([^/]+)$", path)
                if m_user and method == "DELETE":
                    if not user["is_admin"]:
                        return self._send_json(403, {"error": "Admin only"})
                    target_id = urllib.parse.unquote(m_user.group(1))
                    if target_id == uid:
                        return self._send_json(400, {"error": "You can't delete your own account."})
                    for pid in [r["id"] for r in conn.execute(
                            "SELECT id FROM projects WHERE user_id=?", (target_id,)).fetchall()]:
                        conn.execute("DELETE FROM bom_items WHERE project_id=?", (pid,))
                        conn.execute("DELETE FROM orders WHERE project_id=?", (pid,))
                        conn.execute("DELETE FROM parts_list WHERE project_id=?", (pid,))
                    conn.execute("DELETE FROM projects WHERE user_id=?", (target_id,))
                    conn.execute("DELETE FROM status_options WHERE user_id=?", (target_id,))
                    conn.execute("DELETE FROM custom_fields WHERE user_id=?", (target_id,))
                    conn.execute("DELETE FROM sessions WHERE user_id=?", (target_id,))
                    conn.execute("DELETE FROM users WHERE id=?", (target_id,))
                    conn.commit()
                    return self._send_json(200, {"ok": True})

                # ---- Ownership guard for any project-scoped route ----
                pm = re.match(r"^/api/(?:bom|orders|parts|projects)/([^/]+)$", path)
                if pm:
                    guarded_pid = urllib.parse.unquote(pm.group(1))
                    owner = conn.execute("SELECT user_id FROM projects WHERE id=?", (guarded_pid,)).fetchone()
                    if owner is None or owner["user_id"] != uid:
                        return self._send_json(404, {"error": "Not found"})

                if path == "/api/data.json" and method == "GET":
                    # Flat, Excel-friendly snapshot of this user's projects (or one
                    # with ?project=<id>). Point Power Query here.
                    qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    project_filter = qs.get("project", [None])[0]
                    return self._send_json(200, build_export_payload(conn, project_filter, uid))

                if path == "/api/data-info" and method == "GET":
                    # Lets the UI show the on-disk path of the kept-in-sync file.
                    return self._send_json(200, {"filePath": str(EXPORT_JSON_PATH)})

                if path == "/api/projects" and method == "GET":
                    rows = conn.execute("SELECT * FROM projects WHERE user_id=?", (uid,)).fetchall()
                    return self._send_json(200, [project_row_to_json(r) for r in rows])

                if path == "/api/projects" and method == "PUT":
                    projects = body or []
                    conn.execute("DELETE FROM projects WHERE user_id=?", (uid,))
                    for p in projects:
                        conn.execute(
                            "INSERT INTO projects (id, user_id, wbs, ewr, name, status, date_created) "
                            "VALUES (?,?,?,?,?,?,?)",
                            (p["id"], uid, p["wbs"], p["ewr"], p["name"], p["status"], p["dateCreated"]),
                        )
                    conn.commit()
                    return self._send_json(200, {"ok": True})

                m = re.match(r"^/api/projects/([^/]+)$", path)
                if m and method == "DELETE":
                    project_id = urllib.parse.unquote(m.group(1))
                    # Cascade: a project owns its BOM lines, orders, and parts list.
                    conn.execute("DELETE FROM bom_items WHERE project_id=?", (project_id,))
                    conn.execute("DELETE FROM orders WHERE project_id=?", (project_id,))
                    conn.execute("DELETE FROM parts_list WHERE project_id=?", (project_id,))
                    conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
                    conn.commit()
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
                    return self._send_json(200, {"ok": True})

                m = re.match(r"^/api/parts/([^/]+)$", path)
                if m and method == "GET":
                    project_id = urllib.parse.unquote(m.group(1))
                    rows = conn.execute(
                        """SELECT guid, assy, part_number, qty, spare, manufacturer,
                                  commercial_part_no, supplied_3m, description, children_json
                           FROM parts_list WHERE project_id=? ORDER BY position""",
                        (project_id,),
                    ).fetchall()
                    return self._send_json(200, [
                        {
                            "guid": r["guid"], "assy": bool(r["assy"]),
                            "partNumber": r["part_number"], "qty": r["qty"], "spare": r["spare"],
                            "manufacturer": r["manufacturer"], "commercialPartNo": r["commercial_part_no"],
                            "supplied3M": bool(r["supplied_3m"]), "description": r["description"],
                            "children": json.loads(r["children_json"] or "[]"),
                        }
                        for r in rows
                    ])

                if m and method == "PUT":
                    project_id = urllib.parse.unquote(m.group(1))
                    parts = body or []
                    conn.execute("DELETE FROM parts_list WHERE project_id=?", (project_id,))
                    for i, p in enumerate(parts):
                        conn.execute(
                            """INSERT INTO parts_list
                               (guid, project_id, position, assy, part_number, qty, spare,
                                manufacturer, commercial_part_no, supplied_3m, description, children_json)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (
                                p["guid"], project_id, i,
                                1 if p.get("assy") else 0,
                                p.get("partNumber", ""), p.get("qty", 0) or 0, p.get("spare", 0) or 0,
                                p.get("manufacturer", ""), p.get("commercialPartNo", ""),
                                1 if p.get("supplied3M") else 0,
                                p.get("description", ""),
                                json.dumps(p.get("children") or []),
                            ),
                        )
                    conn.commit()
                    return self._send_json(200, {"ok": True})

                if path == "/api/status-options" and method == "GET":
                    rows = conn.execute(
                        "SELECT value FROM status_options WHERE user_id=? ORDER BY position", (uid,)).fetchall()
                    return self._send_json(200, [r["value"] for r in rows])

                if path == "/api/status-options" and method == "PUT":
                    values = body or []
                    conn.execute("DELETE FROM status_options WHERE user_id=?", (uid,))
                    for i, v in enumerate(values):
                        conn.execute("INSERT INTO status_options (user_id, position, value) VALUES (?,?,?)", (uid, i, v))
                    conn.commit()
                    return self._send_json(200, {"ok": True})

                if path == "/api/custom-fields" and method == "GET":
                    rows = conn.execute(
                        "SELECT * FROM custom_fields WHERE user_id=? ORDER BY position", (uid,)).fetchall()
                    result = []
                    for r in rows:
                        field = {"key": r["key"], "label": r["label"], "type": r["type"]}
                        if r["options_json"]:
                            field["options"] = json.loads(r["options_json"])
                        result.append(field)
                    return self._send_json(200, result)

                if path == "/api/custom-fields" and method == "PUT":
                    fields = body or []
                    conn.execute("DELETE FROM custom_fields WHERE user_id=?", (uid,))
                    for i, f in enumerate(fields):
                        conn.execute(
                            "INSERT INTO custom_fields (user_id, position, key, label, type, options_json) VALUES (?,?,?,?,?,?)",
                            (uid, i, f["key"], f["label"], f["type"], json.dumps(f["options"]) if f.get("options") else None),
                        )
                    conn.commit()
                    return self._send_json(200, {"ok": True})

                self._send_json(404, {"error": "Not found: " + method + " " + path})
            finally:
                conn.close()
        except Exception as e:
            log_problem("API %s %s failed:\n%s" % (method, path, traceback.format_exc()))
            self._send_json(500, {"error": str(e)})


class Server(http.server.ThreadingHTTPServer):
    # Locally (Windows) SO_REUSEADDR would let a second copy start on 8791 and
    # steal requests, so refuse a double-bind. Hosted, the container owns the
    # port and quick restarts want reuse, so allow it there.
    allow_reuse_address = HOSTED
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Default implementation prints the traceback to sys.stderr, which is
        # None when running windowless.
        log_problem("Error handling request from %s:\n%s" % (client_address, traceback.format_exc()))


def main():
    global _httpd
    init_db()
    if not HOSTED:
        write_export_file()  # local-only Excel/query JSON snapshot at start
    try:
        server = Server((HOST, PORT), Handler)
    except OSError:
        # Plain ASCII: the Windows console this runs in isn't UTF-8.
        print("Port " + str(PORT) + " is already in use - the app is probably already running.")
        print("Open http://localhost:" + str(PORT) + " , or close the other server window and retry.")
        return 1

    _httpd = server  # let the /api/shutdown route stop us gracefully (local)

    print("Serving " + str(BASE_DIR) + " on " + HOST + ":" + str(PORT) +
          ("  [hosted]" if HOSTED else ""))
    print("Database: " + ("Postgres (DATABASE_URL)" if db.USE_POSTGRES else str(DB_PATH)))
    if not HOSTED:
        default_note = "" if EXPORT_JSON_PATH == DEFAULT_EXPORT_PATH else "  (relocated via config)"
        print("Excel data URL: http://localhost:" + str(PORT) + "/api/data.json")
        print("Excel data file: " + str(EXPORT_JSON_PATH) + default_note)
        print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()
    finally:
        if not HOSTED:
            write_export_file()  # snapshot on the way out (start/stop only, local)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
