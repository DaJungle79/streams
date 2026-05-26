"""Auto-capture: user-created notes in the streams folder -> new streams."""

import pytest

from streams.apple.notes_bridge import FakeNotesBridge
from streams.store import Store
from streams.notes.sync import capture_folder, sync_stream

FOLDER = "Streams"


@pytest.fixture
def setup(tmp_path):
    return Store(tmp_path / "data"), FakeNotesBridge()


def test_capture_adopts_user_note(setup):
    store, bridge = setup
    nid = bridge.add_external_note("Marketing site", "build the new marketing site", folder=FOLDER)

    created = capture_folder(store, bridge, FOLDER)

    assert created == ["marketing-site"]
    stream = store.read_stream("marketing-site")
    assert stream.note_id == nid                       # adopted the user's note
    assert "build the new marketing site" in store.read_notes("marketing-site")
    # the note is now rendered in our structured format
    assert "🤖 Agent" in bridge.notes[nid]


def test_capture_strips_repeated_title(setup):
    # Apple Notes puts the title in the body; the leading title line shouldn't be
    # duplicated into the stream's notes.
    store, bridge = setup
    bridge.add_external_note("Launch", "Launch\nship the thing", folder=FOLDER)
    capture_folder(store, bridge, FOLDER)
    assert store.read_notes("launch").strip() == "ship the thing"


def test_capture_is_idempotent(setup):
    store, bridge = setup
    bridge.add_external_note("Idea", "a fresh idea", folder=FOLDER)
    assert capture_folder(store, bridge, FOLDER) == ["idea"]
    assert capture_folder(store, bridge, FOLDER) == []   # already tracked -> skipped


def test_managed_notes_not_recaptured(setup):
    store, bridge = setup
    store.create_stream("Existing")
    sync_stream(store, bridge, "existing", folder=FOLDER)  # creates a managed note in the folder
    assert capture_folder(store, bridge, FOLDER) == []     # known note_id -> skipped


def test_notes_outside_folder_ignored(setup):
    store, bridge = setup
    bridge.add_external_note("Random", "just a normal note", folder="Personal")
    assert capture_folder(store, bridge, FOLDER) == []
