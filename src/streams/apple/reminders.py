"""Apple Reminders integration: push + completion-back.

The agent pushes select todos (open, due-dated, not yet pushed) into Reminders as
nudges. Checking one off in Reminders marks the todo done on the next sync; and a
todo completed elsewhere has its reminder marked done too, so Reminders never
nudges for something already handled. This is NOT general capture — new reminders
the user creates by hand are not ingested.

The todo↔reminder mapping is the existing ``Todo.reminder_id`` field.
``EventKitReminders`` (pyobjc, needs the ``apple`` dep group + a Mac) is validated
on-device; ``FakeReminders`` backs the tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

from ..core import StreamState, TodoStatus
from ..store import Store

META_SLUG = "meta"


class RemindersBridge(Protocol):
    def create_reminder(self, title: str, due: date | None, list_name: str | None) -> str: ...
    def is_completed(self, reminder_id: str) -> bool | None: ...  # None if not found
    def complete_reminder(self, reminder_id: str) -> None: ...


@dataclass
class ReminderSyncResult:
    slug: str
    pushed: int = 0
    completed: int = 0


# --- the sync logic (bridge-agnostic, fully tested) ------------------------


def _pull_completions(store: Store, bridge: RemindersBridge, slug: str) -> int:
    """Reconcile completion state between linked todos and their reminders."""
    completed = 0
    for todo in store.list_todos(slug):
        if not todo.reminder_id:
            continue
        done_in_reminders = bridge.is_completed(todo.reminder_id)
        if done_in_reminders is None:
            continue  # reminder gone; leave the link, don't guess
        if todo.status is TodoStatus.open and done_in_reminders:
            store.complete_todo(slug, todo.id)  # completion-back
            completed += 1
        elif todo.status in (TodoStatus.done, TodoStatus.archived) and not done_in_reminders:
            bridge.complete_reminder(todo.reminder_id)  # keep the reminder consistent
    return completed


def _push_due_todos(store: Store, bridge: RemindersBridge, slug: str, list_name: str | None) -> int:
    pushed = 0
    for todo in store.list_todos(slug):
        if todo.status is TodoStatus.open and todo.due is not None and not todo.reminder_id:
            reminder_id = bridge.create_reminder(todo.text, todo.due, list_name)
            store.set_todo_reminder(slug, todo.id, reminder_id)
            pushed += 1
    return pushed


def sync_reminders(
    store: Store, bridge: RemindersBridge, slug: str, list_name: str | None = None
) -> ReminderSyncResult:
    completed = _pull_completions(store, bridge, slug)
    pushed = _push_due_todos(store, bridge, slug, list_name)
    return ReminderSyncResult(slug, pushed=pushed, completed=completed)


def sync_all_reminders(
    store: Store, bridge: RemindersBridge, list_name: str | None = None
) -> list[ReminderSyncResult]:
    return [
        sync_reminders(store, bridge, s.id, list_name)
        for s in store.list_streams()
        if s.id != META_SLUG and s.state is not StreamState.dormant
    ]


# --- in-memory bridge for tests --------------------------------------------


class FakeReminders:
    def __init__(self) -> None:
        self.reminders: dict[str, dict] = {}
        self._seq = 0

    def create_reminder(self, title: str, due: date | None, list_name: str | None = None) -> str:
        self._seq += 1
        rid = f"rem-{self._seq}"
        self.reminders[rid] = {"title": title, "due": due, "list": list_name, "completed": False}
        return rid

    def is_completed(self, reminder_id: str) -> bool | None:
        r = self.reminders.get(reminder_id)
        return None if r is None else r["completed"]

    def complete_reminder(self, reminder_id: str) -> None:
        if reminder_id in self.reminders:
            self.reminders[reminder_id]["completed"] = True

    # test helper: simulate the user checking a reminder off on their phone
    def user_complete(self, reminder_id: str) -> None:
        self.complete_reminder(reminder_id)


# --- real EventKit bridge (pyobjc; validated by spike s3) ------------------


class EventKitReminders:
    """Apple Reminders via EventKit. Needs the `apple` dep group and a Mac."""

    def __init__(self, list_name: str | None = None) -> None:
        from EventKit import EKEventStore

        self._store = EKEventStore.alloc().init()
        self._list_name = list_name
        self._request_access()

    def _request_access(self) -> None:
        import threading

        done = threading.Event()
        result: dict = {}

        def handler(granted, error):  # noqa: ANN001 — ObjC callback
            result["granted"] = bool(granted)
            done.set()

        if hasattr(self._store, "requestFullAccessToRemindersWithCompletion_"):
            self._store.requestFullAccessToRemindersWithCompletion_(handler)
        else:  # pre-macOS 14
            from EventKit import EKEntityTypeReminder

            self._store.requestAccessToEntityType_completion_(EKEntityTypeReminder, handler)
        if not done.wait(120) or not result.get("granted"):
            raise RuntimeError("Reminders access not granted")

    def _calendar(self, list_name: str | None):
        name = list_name or self._list_name
        if name:
            from EventKit import EKEntityTypeReminder

            for cal in self._store.calendarsForEntityType_(EKEntityTypeReminder):
                if cal.title() == name:
                    return cal
        return self._store.defaultCalendarForNewReminders()

    def create_reminder(self, title: str, due: date | None, list_name: str | None = None) -> str:
        from EventKit import EKReminder

        reminder = EKReminder.reminderWithEventStore_(self._store)
        reminder.setTitle_(title)
        reminder.setCalendar_(self._calendar(list_name))
        if due is not None:
            from Foundation import NSDateComponents

            comp = NSDateComponents.alloc().init()
            comp.setYear_(due.year)
            comp.setMonth_(due.month)
            comp.setDay_(due.day)
            reminder.setDueDateComponents_(comp)
        ok, err = self._store.saveReminder_commit_error_(reminder, True, None)
        if not ok:
            raise RuntimeError(f"save reminder failed: {err}")
        return reminder.calendarItemIdentifier()

    def is_completed(self, reminder_id: str) -> bool | None:
        item = self._store.calendarItemWithIdentifier_(reminder_id)
        return None if item is None else bool(item.isCompleted())

    def complete_reminder(self, reminder_id: str) -> None:
        item = self._store.calendarItemWithIdentifier_(reminder_id)
        if item is None:
            return
        item.setCompleted_(True)
        ok, err = self._store.saveReminder_commit_error_(item, True, None)
        if not ok:
            raise RuntimeError(f"complete reminder failed: {err}")
