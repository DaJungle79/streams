#!/usr/bin/env python3
"""S3 — Apple Reminders spike (EventKit via pyobjc).

Validates that we can, from Python:
  1. request Reminders access (TCC prompt on first run),
  2. create a reminder in the default list and save it, and
  3. fetch reminders back and read their completion status.

This underpins the Phase 4 "push + completion-back" loop: the agent pushes select
todos as reminders, and checking one off must be readable so we can mark the todo
done.

Requires the ``apple`` dependency group:

    uv sync --group apple
    uv run python docs/spikes/s3_reminders.py --create
    uv run python docs/spikes/s3_reminders.py --list

On first run macOS shows the Reminders access prompt. macOS 14+ uses
``requestFullAccessToRemindersWithCompletion:``; this falls back to the older
``requestAccessToEntityType:completion:`` if needed.

Throwaway spike — findings go in RESULTS.md.
"""

from __future__ import annotations

import argparse
import sys
import threading

try:
    from EventKit import EKEventStore, EKReminder  # type: ignore
    from EventKit import EKEntityTypeReminder  # type: ignore
except ImportError:
    print("pyobjc EventKit not installed. Run: uv sync --group apple", file=sys.stderr)
    sys.exit(2)

TITLE = "Streams spike reminder (safe to delete)"


def _request_access(store: "EKEventStore") -> bool:
    """Block until the user answers the access prompt; return granted/denied."""
    done = threading.Event()
    result = {"granted": False, "error": None}

    def handler(granted, error):  # noqa: ANN001 — ObjC callback signature
        result["granted"] = bool(granted)
        result["error"] = error
        done.set()

    if hasattr(store, "requestFullAccessToRemindersWithCompletion_"):
        store.requestFullAccessToRemindersWithCompletion_(handler)
    else:  # pre-macOS 14
        store.requestAccessToEntityType_completion_(EKEntityTypeReminder, handler)

    if not done.wait(timeout=120):
        print("Timed out waiting for the access prompt.")
        return False
    if result["error"] is not None:
        print(f"Access error: {result['error']}")
    return result["granted"]


def create_reminder(store: "EKEventStore") -> bool:
    cal = store.defaultCalendarForNewReminders()
    if cal is None:
        print("No default reminders list available.")
        return False
    reminder = EKReminder.reminderWithEventStore_(store)
    reminder.setTitle_(TITLE)
    reminder.setCalendar_(cal)
    ok, error = store.saveReminder_commit_error_(reminder, True, None)
    if not ok:
        print(f"Save failed: {error}")
        return False
    print(f"Created reminder {TITLE!r} in list {cal.title()!r}")
    return True


def list_reminders(store: "EKEventStore") -> None:
    predicate = store.predicateForRemindersInCalendars_(None)
    done = threading.Event()
    fetched: list = []

    def handler(reminders):  # noqa: ANN001
        if reminders:
            fetched.extend(reminders)
        done.set()

    store.fetchRemindersMatchingPredicate_completion_(predicate, handler)
    if not done.wait(timeout=30):
        print("Timed out fetching reminders.")
        return

    print(f"Fetched {len(fetched)} reminders:")
    for r in fetched:
        mark = "x" if r.isCompleted() else " "
        print(f"  [{mark}] {r.title()}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Apple Reminders (EventKit) spike")
    ap.add_argument("--create", action="store_true", help="create a test reminder")
    ap.add_argument("--list", action="store_true", help="list reminders + completion")
    args = ap.parse_args()
    if not args.create and not args.list:
        ap.error("pass --create and/or --list")

    store = EKEventStore.alloc().init()
    if not _request_access(store):
        print("Reminders access not granted.")
        return 1

    if args.create:
        if not create_reminder(store):
            return 1
    if args.list:
        list_reminders(store)

    print(
        "\nGO if: access granted, reminder created, and completion status is "
        "readable (check one off in the Reminders app, re-run --list). "
        "Record in RESULTS.md."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
