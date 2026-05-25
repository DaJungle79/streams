"""Disposable SQLite index over the markdown store.

The index is rebuilt from markdown (never authoritative) and powers fast
cross-stream queries. Dates are stored as ISO strings, which sort
chronologically, so range queries on ``due``/``ts`` work with plain comparisons.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

from .markdown import to_iso
from .store import Store

_SCHEMA = """
CREATE TABLE streams (
    slug TEXT PRIMARY KEY, title TEXT, state TEXT, weight INTEGER,
    note_id TEXT, created TEXT
);
CREATE TABLE goals (
    id TEXT PRIMARY KEY, stream TEXT, text TEXT, status TEXT, src TEXT,
    created TEXT, target TEXT
);
CREATE TABLE todos (
    id TEXT PRIMARY KEY, stream TEXT, text TEXT, status TEXT, src TEXT,
    created TEXT, due TEXT, completed TEXT, reminder_id TEXT
);
CREATE TABLE events (
    id TEXT PRIMARY KEY, stream TEXT, ts TEXT, type TEXT, source TEXT, content TEXT
);
"""


class Index:
    def __init__(self, db_path: str | Path = ":memory:"):
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row

    def close(self) -> None:
        self.conn.close()

    def _reset_schema(self) -> None:
        for table in ("streams", "goals", "todos", "events"):
            self.conn.execute(f"DROP TABLE IF EXISTS {table}")
        self.conn.executescript(_SCHEMA)

    def rebuild(self, store: Store) -> None:
        self._reset_schema()
        c = self.conn
        for stream in store.list_streams():
            c.execute(
                "INSERT INTO streams VALUES (?,?,?,?,?,?)",
                (
                    stream.id,
                    stream.title,
                    stream.state.value,
                    stream.weight,
                    stream.note_id,
                    to_iso(stream.created),
                ),
            )
            for g in store.list_goals(stream.id):
                c.execute(
                    "INSERT INTO goals VALUES (?,?,?,?,?,?,?)",
                    (g.id, stream.id, g.text, g.status.value, g.src.value,
                     to_iso(g.created), to_iso(g.target)),
                )
            for t in store.list_todos(stream.id):
                c.execute(
                    "INSERT INTO todos VALUES (?,?,?,?,?,?,?,?,?)",
                    (t.id, stream.id, t.text, t.status.value, t.src.value,
                     to_iso(t.created), to_iso(t.due), to_iso(t.completed), t.reminder_id),
                )
            for e in store.list_events(stream.id):
                c.execute(
                    "INSERT INTO events VALUES (?,?,?,?,?,?)",
                    (e.id, stream.id, e.timestamp.isoformat(), e.type.value,
                     e.source.value, e.content),
                )
        c.commit()

    # --- cross-stream queries ----------------------------------------------

    def open_todos(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM todos WHERE status = 'open' "
            "ORDER BY (due IS NULL), due, stream"
        ).fetchall()

    def todos_due_between(self, start: date, end: date) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM todos WHERE due IS NOT NULL AND due BETWEEN ? AND ? "
            "AND status IN ('open','deferred') ORDER BY due",
            (start.isoformat(), end.isoformat()),
        ).fetchall()

    def recent_events(self, limit: int = 20) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM events ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()

    def search_events(self, term: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM events WHERE content LIKE ? ORDER BY ts DESC",
            (f"%{term}%",),
        ).fetchall()

    def stream_counts_by_state(self) -> dict[str, int]:
        rows = self.conn.execute(
            "SELECT state, COUNT(*) AS n FROM streams GROUP BY state"
        ).fetchall()
        return {r["state"]: r["n"] for r in rows}


def build_index(store: Store, db_path: str | Path = ":memory:") -> Index:
    index = Index(db_path)
    index.rebuild(store)
    return index
