"""Auto-capture: user-created tagged notes -> new streams."""

import pytest

from streams.notes_bridge import FakeNotesBridge, note_has_tag, strip_tag
from streams.store import Store
from streams.sync import capture_tagged, sync_stream

TAG = "#stream"


@pytest.fixture
def setup(tmp_path):
    return Store(tmp_path / "data"), FakeNotesBridge()


def test_note_has_tag_word_boundary():
    assert note_has_tag("plan the #stream launch", "#stream")
    assert not note_has_tag("about #streams plural", "#stream")  # not a partial match
    assert strip_tag("#stream build the site", "#stream") == "build the site"


def test_capture_adopts_user_note(setup):
    store, bridge = setup
    nid = bridge.add_external_note("Marketing site", "#stream build the new marketing site")

    created = capture_tagged(store, bridge, TAG)

    assert created == ["marketing-site"]
    stream = store.read_stream("marketing-site")
    assert stream.note_id == nid                       # adopted the user's note
    assert "build the new marketing site" in store.read_notes("marketing-site")
    # the note is now rendered in our structured format, with the tag preserved
    assert "🤖 Agent" in bridge.notes[nid] and "#stream" in bridge.notes[nid]


def test_capture_is_idempotent(setup):
    store, bridge = setup
    bridge.add_external_note("Idea", "#stream a fresh idea")
    assert capture_tagged(store, bridge, TAG) == ["idea"]
    assert capture_tagged(store, bridge, TAG) == []     # already tracked -> skipped


def test_managed_notes_not_recaptured(setup):
    store, bridge = setup
    store.create_stream("Existing")
    sync_stream(store, bridge, "existing", tag=TAG)     # creates a tagged managed note
    assert capture_tagged(store, bridge, TAG) == []      # known note_id -> skipped


def test_untagged_notes_ignored(setup):
    store, bridge = setup
    bridge.add_external_note("Random", "just a normal note, no tag")
    assert capture_tagged(store, bridge, TAG) == []
