from datetime import date, datetime, timedelta

import pytest

from streams.core import EventType, StreamState
from streams.index import build_index
from streams.store import Store


@pytest.fixture
def populated(tmp_path):
    store = Store(tmp_path / "data")
    store.create_stream("Alpha", state=StreamState.active)
    store.create_stream("Beta", state=StreamState.dormant)
    store.add_todo("alpha", "open soon", due=date.today() + timedelta(days=2))
    store.add_todo("alpha", "open later", due=date.today() + timedelta(days=60))
    done = store.add_todo("beta", "already done")
    store.complete_todo("beta", done.id)
    store.append_event("alpha", "kickoff", type=EventType.decision,
                       timestamp=datetime(2026, 5, 1, 9, 0))
    store.append_event("beta", "noted", timestamp=datetime(2026, 5, 2, 9, 0))
    return store


def test_open_todos_excludes_done(populated):
    idx = build_index(populated)
    texts = {r["text"] for r in idx.open_todos()}
    assert texts == {"open soon", "open later"}


def test_due_between(populated):
    idx = build_index(populated)
    soon = idx.todos_due_between(date.today(), date.today() + timedelta(days=7))
    assert [r["text"] for r in soon] == ["open soon"]


def test_recent_events_desc(populated):
    idx = build_index(populated)
    rows = idx.recent_events(limit=10)
    assert rows[0]["content"] == "noted"  # most recent first
    assert len(rows) == 2


def test_search_events(populated):
    idx = build_index(populated)
    assert [r["content"] for r in idx.search_events("kick")] == ["kickoff"]


def test_counts_by_state(populated):
    idx = build_index(populated)
    assert idx.stream_counts_by_state() == {"active": 1, "dormant": 1}


def test_rebuild_is_idempotent(populated):
    idx = build_index(populated)
    first = len(idx.open_todos())
    idx.rebuild(populated)
    assert len(idx.open_todos()) == first  # no duplication on rebuild
