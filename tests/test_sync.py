"""End-to-end round-trip via the in-memory fake bridge (no Apple needed)."""

import pytest

from streams.core import TodoStatus
from streams.notes_bridge import FakeNotesBridge
from streams.store import Store
from streams.sync import load_snapshot, sync_stream


@pytest.fixture
def setup(tmp_path):
    store = Store(tmp_path / "data")
    store.create_stream("Trip")
    store.add_todo("trip", "Book flights")
    return store, FakeNotesBridge()


def test_first_sync_creates_note(setup):
    store, bridge = setup
    result = sync_stream(store, bridge, "trip")
    assert result.created
    note_id = store.read_stream("trip").note_id
    assert note_id and note_id in bridge.notes
    assert load_snapshot(store, "trip") is not None
    assert "- [ ] Book flights" in bridge.notes[note_id]


def test_second_sync_no_edits_is_idempotent(setup):
    store, bridge = setup
    sync_stream(store, bridge, "trip")
    result = sync_stream(store, bridge, "trip")
    assert not result.created
    assert result.changes == []


def test_user_check_in_note_completes_todo(setup):
    store, bridge = setup
    sync_stream(store, bridge, "trip")
    note_id = store.read_stream("trip").note_id

    bridge.user_edit(note_id, lambda s: s.replace(
        "- [ ] Book flights", "- [x] Book flights"))
    result = sync_stream(store, bridge, "trip")

    assert any("done" in c for c in result.changes)
    assert store.list_todos("trip")[0].status is TodoStatus.done
    # re-rendered note reflects the new state
    assert "- [x] Book flights" in bridge.notes[note_id]


def test_user_adds_todo_and_thought_together(setup):
    store, bridge = setup
    sync_stream(store, bridge, "trip")
    note_id = store.read_stream("trip").note_id

    bridge.user_edit(note_id, lambda s: s
                     .replace("- [ ] Book flights", "- [ ] Book flights\n- [ ] Pack bags")
                     .replace("Notes\n", "Notes\nremember sunscreen\n"))
    sync_stream(store, bridge, "trip")

    texts = {t.text for t in store.list_todos("trip")}
    assert {"Book flights", "Pack bags"} <= texts
    assert "sunscreen" in store.read_notes("trip")


def test_sync_projects_agent_synthesis(setup):
    """Fresh agent synthesis reaches the note even without a user edit."""
    from streams.agent.llm import FakeLLM
    from streams.agent.runner import synthesize_stream

    store, bridge = setup
    sync_stream(store, bridge, "trip")
    note_id = store.read_stream("trip").note_id
    assert "Holding steady" not in bridge.notes[note_id]

    synthesize_stream(store, FakeLLM(), "trip")
    result = sync_stream(store, bridge, "trip")
    assert result.changes == []                          # no user edits...
    assert "Holding steady" in bridge.notes[note_id]     # ...but synthesis is projected


def test_sync_recovers_when_snapshot_lost(setup):
    store, bridge = setup
    sync_stream(store, bridge, "trip")
    note_id = store.read_stream("trip").note_id

    # simulate losing the disposable snapshot, then a user edit
    (store.repo / ".render" / "trip.json").unlink()
    bridge.user_edit(note_id, lambda s: s.replace(
        "- [ ] Book flights", "- [x] Book flights"))
    sync_stream(store, bridge, "trip")

    assert store.list_todos("trip")[0].status is TodoStatus.done
    assert load_snapshot(store, "trip") is not None  # rebuilt
