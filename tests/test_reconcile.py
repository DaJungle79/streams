"""Tests for the reconcile core: user note edits -> markdown store.

``edit()`` mimics the real flow exactly — serialize the rendered note to text,
apply a string transform (the "user edit"), parse it back (losing ids, as Apple
does) — so these tests exercise the same path production uses.
"""

import pytest

from streams.core import GoalStatus, Provenance, TodoStatus
from streams.notes.notedoc import parse_text, serialize_text
from streams.notes.reconcile import reconcile
from streams.notes.render import render
from streams.store import Store


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "data")
    s.create_stream("Trip")
    return s


def edit(base, transform):
    return parse_text(transform(serialize_text(base)))


def test_check_todo_completes_it(store):
    t = store.add_todo("trip", "Book flights")
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace("- [ ] Book flights", "- [x] Book flights"))
    changes = reconcile(store, "trip", base, edited)
    assert store.list_todos("trip")[0].status is TodoStatus.done
    assert any("done" in c for c in changes)


def test_uncheck_todo_reopens_it(store):
    t = store.add_todo("trip", "Book flights")
    store.complete_todo("trip", t.id)
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace("- [x] Book flights", "- [ ] Book flights"))
    reconcile(store, "trip", base, edited)
    assert store.list_todos("trip")[0].status is TodoStatus.open


def test_add_todo_line_creates_user_todo(store):
    store.add_todo("trip", "Book flights")
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace(
        "- [ ] Book flights", "- [ ] Book flights\n- [ ] Pack bags"))
    reconcile(store, "trip", base, edited)
    texts = {t.text: t for t in store.list_todos("trip")}
    assert "Pack bags" in texts
    assert texts["Pack bags"].src is Provenance.user


def test_remove_todo_line_archives_it(store):
    t = store.add_todo("trip", "Book flights")
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace("- [ ] Book flights\n", ""))
    reconcile(store, "trip", base, edited)
    assert store.list_todos("trip")[0].status is TodoStatus.archived


def test_edit_todo_text(store):
    store.add_todo("trip", "Book flights")
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace("Book flights", "Book flights and hotel"))
    reconcile(store, "trip", base, edited)
    assert store.list_todos("trip")[0].text == "Book flights and hotel"


def test_goal_add_remove_edit(store):
    g = store.add_goal("trip", "Relax")
    base = render(store, "trip")
    # edit existing + add a new goal
    edited = edit(base, lambda s: s.replace("- Relax", "- Relax fully\n- See temples"))
    reconcile(store, "trip", base, edited)
    goals = {g.text: g for g in store.list_goals("trip") if g.status is GoalStatus.active}
    assert "Relax fully" in goals and "See temples" in goals

    # now drop one by removing its line
    base2 = render(store, "trip")
    edited2 = edit(base2, lambda s: s.replace("- See temples\n", ""))
    reconcile(store, "trip", base2, edited2)
    dropped = [g for g in store.list_goals("trip") if g.text == "See temples"]
    assert dropped[0].status is GoalStatus.dropped


def test_notes_edit_writes_notes_md(store):
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace("Notes\n", "Notes\nvilla near Ubud\n"))
    reconcile(store, "trip", base, edited)
    assert "villa near Ubud" in store.read_notes("trip")


def test_agent_zone_edits_ignored(store):
    store.add_todo("trip", "Book flights")
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace(
        "synthesis appears here", "I scribbled in the agent zone"))
    changes = reconcile(store, "trip", base, edited)
    assert changes == []  # agent zone is not user-owned
    assert store.list_todos("trip")[0].status is TodoStatus.open


def test_missing_todo_zone_does_not_delete(store):
    """If the To-dos heading vanishes (parse glitch or stray edit), don't wipe."""
    store.add_todo("trip", "Book flights")
    base = render(store, "trip")
    edited = edit(base, lambda s: s.replace("To-dos\n- [ ] Book flights\n", ""))
    assert edited.zone("todos") is None
    reconcile(store, "trip", base, edited)
    assert store.list_todos("trip")[0].status is TodoStatus.open  # untouched


def test_simultaneous_check_and_note_nothing_clobbered(store):
    t = store.add_todo("trip", "Book flights")
    base = render(store, "trip")
    edited = edit(base, lambda s: s
                  .replace("- [ ] Book flights", "- [x] Book flights")
                  .replace("Notes\n", "Notes\nbooked via Skyscanner\n"))
    reconcile(store, "trip", base, edited)
    assert store.list_todos("trip")[0].status is TodoStatus.done
    assert "Skyscanner" in store.read_notes("trip")
