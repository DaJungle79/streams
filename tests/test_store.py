from datetime import date, datetime

import pytest

from streams import gitutil
from streams.core import EventSource, EventType, GoalStatus, StreamState, TodoStatus
from streams.store import Store, StreamNotFound


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "data")


def test_create_stream_lays_out_files(store):
    s = store.create_stream("Bali Trip", weight=2)
    assert s.id == "bali-trip"
    d = store.repo / "streams" / "bali-trip"
    for name in ("stream.md", "goals.md", "todos.md", "notes.md"):
        assert (d / name).exists()
    assert (d / "events").is_dir()
    # round-trips through markdown
    assert store.read_stream("bali-trip").weight == 2


def test_unique_slug_on_duplicate_title(store):
    a = store.create_stream("Bali Trip")
    b = store.create_stream("Bali Trip")
    assert a.id == "bali-trip"
    assert b.id == "bali-trip-2"


def test_list_streams(store):
    store.create_stream("Alpha")
    store.create_stream("Beta")
    assert [s.id for s in store.list_streams()] == ["alpha", "beta"]


def test_goals_crud(store):
    store.create_stream("X")
    g = store.add_goal("x", "Ship it", target=date(2026, 8, 1))
    assert [gg.id for gg in store.list_goals("x")] == [g.id]
    store.set_goal_status("x", g.id, GoalStatus.achieved)
    assert store.list_goals("x")[0].status is GoalStatus.achieved


def test_todos_crud_and_completion(store):
    store.create_stream("X")
    t = store.add_todo("x", "Book flights", due=date(2026, 6, 1))
    assert store.list_todos("x")[0].status is TodoStatus.open
    done = store.complete_todo("x", t.id)
    assert done.status is TodoStatus.done
    assert store.list_todos("x")[0].completed == date.today()
    store.defer_todo("x", t.id)
    reloaded = store.list_todos("x")[0]
    assert reloaded.status is TodoStatus.deferred
    assert reloaded.completed is None  # cleared when leaving done


def test_events_append_and_month_sharding(store):
    store.create_stream("X")
    store.append_event("x", "older", timestamp=datetime(2026, 4, 10, 9, 0))
    store.append_event("x", "newer", type=EventType.decision,
                       source=EventSource.agent, timestamp=datetime(2026, 5, 10, 9, 0))
    assert (store.repo / "streams/x/events/2026-04.md").exists()
    assert (store.repo / "streams/x/events/2026-05.md").exists()
    events = store.list_events("x")
    assert [e.content for e in events] == ["older", "newer"]  # sorted oldest first
    assert events[1].type is EventType.decision
    assert [e.content for e in store.list_events("x", month="2026-05")] == ["newer"]


def test_notes_roundtrip(store):
    store.create_stream("X")
    store.set_notes("x", "remember the milk")
    assert "remember the milk" in store.read_notes("x")


def test_archive_moves_folder(store):
    store.create_stream("X")
    store.archive_stream("x")
    assert not (store.repo / "streams/x").exists()
    assert (store.repo / "archive/x/stream.md").exists()
    assert store.list_streams() == []


def test_commits_authored_by_agent_name(tmp_path):
    store = Store(tmp_path / "data", author="Mr. Streams")
    store.create_stream("X")
    author = gitutil.run_git(store.repo, "log", "-1", "--format=%an")
    assert author == "Mr. Streams"


def test_missing_stream_raises(store):
    with pytest.raises(StreamNotFound):
        store.read_stream("nope")
    with pytest.raises(StreamNotFound):
        store.add_todo("nope", "x")


def test_every_mutation_commits(store):
    before = gitutil.commit_count(store.repo)
    store.create_stream("X")
    store.add_goal("x", "g")
    store.add_todo("x", "t")
    store.append_event("x", "e")
    store.set_notes("x", "n")
    after = gitutil.commit_count(store.repo)
    assert after - before == 5  # one commit per mutation
    # working tree clean (gitignore covers index/render artifacts)
    assert gitutil.run_git(store.repo, "status", "--porcelain") == ""
