"""Database access: SQLite locally, PostgreSQL when DATABASE_URL is set.

The rest of the app keeps its sqlite3-style calls -- conn.execute("... ?", params)
returning rows you index by column name (row["col"]), plus .executescript(),
.commit(), .close(). connect() returns either a real sqlite3.Connection or a thin
psycopg2 wrapper that mimics that surface, so server.py needs almost no changes.

Choosing the backend: if the DATABASE_URL environment variable is present (Render
injects it for a managed Postgres database) we use Postgres; otherwise a local
SQLite file. This keeps `python server.py` a zero-setup local run.
"""
import os
import sqlite3

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_POSTGRES = bool(DATABASE_URL)

if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras


def _translate(sql, params):
    """SQLite uses ? placeholders; psycopg2 uses %s. Only rewrite when the query
    actually has params -- a parameterless statement is sent verbatim, so a bare
    % in it (none of ours have one) must stay untouched. When params ARE present,
    escape literal % to %% first, then turn ? into %s."""
    if not USE_POSTGRES or not params:
        return sql
    return sql.replace("%", "%%").replace("?", "%s")


class _PgCursor:
    def __init__(self, cur):
        self._cur = cur

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def rowcount(self):
        return self._cur.rowcount


class _PgConnection:
    """psycopg2 connection dressed up to look like sqlite3.Connection."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(_translate(sql, params), params)
        return _PgCursor(cur)

    def executescript(self, script):
        # libpq/psycopg2 accept several ;-separated statements in one execute.
        cur = self._conn.cursor()
        cur.execute(script)
        cur.close()

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def connect(sqlite_path):
    """Open a fresh connection to whichever backend is configured. `sqlite_path`
    is ignored when running on Postgres."""
    if USE_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 30000")  # ms; avoid hung locks
        cur.close()
        conn.commit()
        return _PgConnection(conn)

    conn = sqlite3.connect(sqlite_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # better concurrent read/write
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def table_columns(conn, table):
    """Set of column names on `table`, using each backend's introspection."""
    if USE_POSTGRES:
        rows = conn.execute(
            "SELECT column_name AS name FROM information_schema.columns WHERE table_name=?",
            (table,),
        ).fetchall()
        return {r["name"] for r in rows}
    rows = conn.execute("PRAGMA table_info(%s)" % table).fetchall()
    return {r["name"] for r in rows}
