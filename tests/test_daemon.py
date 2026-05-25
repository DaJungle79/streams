"""Daemon orchestration (poll tick, scheduled pass, health) via fakes."""

from datetime import date, timedelta

import pytest

from streams.agent.llm import FakeLLM
from streams.core import TodoStatus
from streams.daemon import Deps, health_check, launchd_plist, run_poll_tick, run_scheduled_pass
from streams.messages import FakeMessages
from streams.notes_bridge import FakeNotesBridge
from streams.reminders import FakeReminders
from streams.store import Store

DUE = date.today() + timedelta(days=2)


@pytest.fixture
def deps():
    return Deps(
        llm=FakeLLM(),
        notes=FakeNotesBridge(),
        reminders=FakeReminders(),
        messages=FakeMessages(),
        agent_name="Mr. Streams",
    )


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "data")
    s.create_stream("Trip")
    s.add_todo("trip", "Book flights", due=DUE)
    return s


def test_poll_tick_creates_notes_and_pushes_reminders(store, deps):
    summary = run_poll_tick(store, deps)
    assert summary["notes_synced"] >= 1                 # note created for the stream
    assert store.read_stream("trip").note_id            # adopted
    assert store.list_todos("trip")[0].reminder_id      # pushed to reminders


def test_poll_tick_captures_tagged_note(store, deps):
    deps.notes.add_external_note("Captured Idea", "#stream a new idea")
    summary = run_poll_tick(store, deps)
    assert "captured-idea" in summary["captured"]
    assert store.read_stream("captured-idea")


def test_poll_tick_completion_back(store, deps):
    run_poll_tick(store, deps)  # pushes the reminder
    rid = store.list_todos("trip")[0].reminder_id
    deps.reminders.user_complete(rid)
    run_poll_tick(store, deps)
    assert store.list_todos("trip")[0].status is TodoStatus.done


def test_scheduled_pass_synthesizes_and_pushes_digest(store, deps):
    result = run_scheduled_pass(store, deps)
    assert result["streams"] >= 1
    assert store.read_agent("trip").strip()             # per-stream synthesis written
    assert store.read_overseer_status().strip()         # overseer ran
    assert deps.messages.sent                            # digest nudged via iMessage
    assert "Mr. Streams" in deps.messages.sent[-1]       # signed


def test_scheduled_pass_skips_unchanged_digest(store, deps):
    run_scheduled_pass(store, deps)
    assert len(deps.messages.sent) == 1                  # first pass nudges
    run_scheduled_pass(store, deps)
    assert len(deps.messages.sent) == 1                  # same summary -> not re-sent


def test_health_check_all_ok(store, deps):
    assert health_check(store, deps) == {"notes": None, "reminders": None, "imessage": None}


def test_health_check_reports_failure(store, deps):
    class BrokenReminders:
        def is_completed(self, rid):
            raise RuntimeError("no Reminders access")

    deps.reminders = BrokenReminders()
    status = health_check(store, deps)
    assert status["reminders"] and "no Reminders access" in status["reminders"]


def test_launchd_plist_contains_label_and_args():
    plist = launchd_plist("com.streams.daemon", ["/x/streams", "daemon", "run"], "/repo", "/log")
    assert "com.streams.daemon" in plist
    assert "<string>daemon</string>" in plist
    assert "KeepAlive" in plist
