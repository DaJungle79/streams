import pytest

from streams.core import Provenance
from streams.render import render
from streams.store import Store


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "data")
    s.create_stream("Bali Trip")
    return s


def test_render_zone_order_and_headings(store):
    doc = render(store, "bali-trip")
    assert doc.title == "Bali Trip"
    assert [z.kind for z in doc.zones] == ["agent", "goals", "todos", "notes", "events"]


def test_done_todo_renders_checked_and_archived_hidden(store):
    open_t = store.add_todo("bali-trip", "Book flights")
    done_t = store.add_todo("bali-trip", "Renew passport")
    store.complete_todo("bali-trip", done_t.id)
    gone = store.add_todo("bali-trip", "Old thing")
    store.archive_todo("bali-trip", gone.id)

    todos = render(store, "bali-trip").zone("todos").lines
    by_text = {l.text: l for l in todos}
    assert "Old thing" not in by_text  # archived hidden
    assert by_text["Book flights"].checked is False
    assert by_text["Renew passport"].checked is True


def test_agent_items_marked(store):
    store.add_todo("bali-trip", "user task", src=Provenance.user)
    store.add_todo("bali-trip", "agent task", src=Provenance.agent)
    todos = {l.text: l.agent for l in render(store, "bali-trip").zone("todos").lines}
    assert todos == {"user task": False, "agent task": True}


def test_notes_and_goals_rendered(store):
    store.add_goal("bali-trip", "Relax")
    store.set_notes("bali-trip", "line one\nline two")
    doc = render(store, "bali-trip")
    assert [l.text for l in doc.zone("goals").lines] == ["Relax"]
    assert [l.text for l in doc.zone("notes").lines] == ["line one", "line two"]
