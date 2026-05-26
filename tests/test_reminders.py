"""Reminders push + completion-back, via the in-memory FakeReminders."""

from datetime import date, timedelta

import pytest

from streams.core import StreamState, TodoStatus
from streams.apple.reminders import FakeReminders, sync_all_reminders, sync_reminders
from streams.store import Store

DUE = date.today() + timedelta(days=3)


@pytest.fixture
def setup(tmp_path):
    store = Store(tmp_path / "data")
    store.create_stream("Trip")
    return store, FakeReminders()


def test_push_due_todo(setup):
    store, bridge = setup
    t = store.add_todo("trip", "Book flights", due=DUE)
    result = sync_reminders(store, bridge, "trip")
    assert result.pushed == 1
    rid = store.list_todos("trip")[0].reminder_id
    assert rid and bridge.reminders[rid]["title"] == "Book flights"


def test_only_due_open_todos_pushed(setup):
    store, bridge = setup
    store.add_todo("trip", "no due date")            # no due -> skip
    done = store.add_todo("trip", "already done", due=DUE)
    store.complete_todo("trip", done.id)             # not open -> skip
    assert sync_reminders(store, bridge, "trip").pushed == 0


def test_push_is_deduped(setup):
    store, bridge = setup
    store.add_todo("trip", "Book flights", due=DUE)
    assert sync_reminders(store, bridge, "trip").pushed == 1
    assert sync_reminders(store, bridge, "trip").pushed == 0  # already linked


def test_completion_back_marks_todo_done(setup):
    store, bridge = setup
    t = store.add_todo("trip", "Book flights", due=DUE)
    sync_reminders(store, bridge, "trip")
    rid = store.list_todos("trip")[0].reminder_id

    bridge.user_complete(rid)                         # checked off on the phone
    result = sync_reminders(store, bridge, "trip")
    assert result.completed == 1
    assert store.list_todos("trip")[0].status is TodoStatus.done


def test_done_todo_completes_its_reminder(setup):
    store, bridge = setup
    t = store.add_todo("trip", "Book flights", due=DUE)
    sync_reminders(store, bridge, "trip")
    rid = store.list_todos("trip")[0].reminder_id

    store.complete_todo("trip", t.id)                 # completed in the app instead
    sync_reminders(store, bridge, "trip")
    assert bridge.reminders[rid]["completed"] is True  # reminder kept consistent


def test_missing_reminder_left_alone(setup):
    store, bridge = setup
    t = store.add_todo("trip", "Book flights", due=DUE)
    store.set_todo_reminder("trip", t.id, "rem-gone")  # points at a deleted reminder
    result = sync_reminders(store, bridge, "trip")
    assert result.completed == 0
    assert store.list_todos("trip")[0].status is TodoStatus.open


def test_sync_all_skips_meta_and_dormant(setup):
    store, bridge = setup
    store.add_todo("trip", "Book flights", due=DUE)
    store.create_stream("Sleepy", state=StreamState.dormant)
    store.add_todo("sleepy", "later", due=DUE)
    store.create_stream("meta", state=StreamState.dormant)  # the ledger
    results = sync_all_reminders(store, bridge)
    assert {r.slug for r in results} == {"trip"}
