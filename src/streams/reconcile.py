"""Reconcile a user-edited note back into the markdown store.

Given the last-rendered snapshot (``base`` — has item ids) and the freshly parsed
note (``edited`` — no ids), align each editable zone and apply the differences to
the store. Lines are aligned by text via difflib; a matched pair is the same
store item (so a checkbox flip or text tweak is detected), an unmatched base line
was removed, an unmatched edited line was added.

Safety rules (protect against data loss and parse glitches):
- **Only user-owned zones** are reconciled; agent and read-only zones are ignored
  (the agent overwrites its own zones on the next pass, never the user's).
- **A missing zone in the edited note is skipped**, never treated as "delete
  everything" — if the user (or a parse hiccup) drops a heading, we don't wipe
  that collection.
- **Removals are soft**: removing a todo archives it, removing a goal marks it
  dropped. Nothing is hard-deleted, preserving the git audit trail.
"""

from __future__ import annotations

import difflib

from .core import Provenance
from .notedoc import NoteDocument, NoteLine
from .store import Store


def reconcile(store: Store, slug: str, base: NoteDocument, edited: NoteDocument) -> list[str]:
    """Apply the user's note edits to the store. Returns human-readable changes."""
    changes: list[str] = []
    changes += _reconcile_todos(store, slug, base, edited)
    changes += _reconcile_goals(store, slug, base, edited)
    changes += _reconcile_notes(store, slug, edited)
    return changes


def _aligned_ops(base_lines: list[NoteLine], edited_lines: list[NoteLine]):
    """Yield ('equal'|'edit'|'add'|'remove', base_line, edited_line) tuples."""
    a = [line.text for line in base_lines]
    b = [line.text for line in edited_lines]
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                yield "equal", base_lines[i1 + k], edited_lines[j1 + k]
        elif tag == "delete":
            for k in range(i1, i2):
                yield "remove", base_lines[k], None
        elif tag == "insert":
            for k in range(j1, j2):
                yield "add", None, edited_lines[k]
        else:  # replace: pair positionally, surplus on either side is add/remove
            bsub, esub = base_lines[i1:i2], edited_lines[j1:j2]
            n = min(len(bsub), len(esub))
            for k in range(n):
                yield "edit", bsub[k], esub[k]
            for bl in bsub[n:]:
                yield "remove", bl, None
            for el in esub[n:]:
                yield "add", None, el


def _reconcile_todos(store, slug, base, edited) -> list[str]:
    bz, ez = base.zone("todos"), edited.zone("todos")
    if bz is None or ez is None:  # missing zone -> skip, never bulk-delete
        return []
    changes: list[str] = []
    for op, bl, el in _aligned_ops(bz.lines, ez.lines):
        if op == "equal":
            if bl.checked != el.checked:
                if el.checked:
                    store.complete_todo(slug, bl.item_id)
                    changes.append(f"todo done: {bl.text}")
                else:
                    store.reopen_todo(slug, bl.item_id)
                    changes.append(f"todo reopened: {bl.text}")
        elif op == "edit":
            if bl.text != el.text:
                store.set_todo_text(slug, bl.item_id, el.text)
                changes.append(f"todo edited: {el.text}")
            if bl.checked != el.checked:
                if el.checked:
                    store.complete_todo(slug, bl.item_id)
                else:
                    store.reopen_todo(slug, bl.item_id)
                changes.append(f"todo toggled: {el.text}")
        elif op == "remove":
            store.archive_todo(slug, bl.item_id)
            changes.append(f"todo archived: {bl.text}")
        elif op == "add":
            todo = store.add_todo(slug, el.text, src=Provenance.user)
            if el.checked:
                store.complete_todo(slug, todo.id)
            changes.append(f"todo added: {el.text}")
    return changes


def _reconcile_goals(store, slug, base, edited) -> list[str]:
    bz, ez = base.zone("goals"), edited.zone("goals")
    if bz is None or ez is None:
        return []
    changes: list[str] = []
    for op, bl, el in _aligned_ops(bz.lines, ez.lines):
        if op == "edit" and bl.text != el.text:
            store.set_goal_text(slug, bl.item_id, el.text)
            changes.append(f"goal edited: {el.text}")
        elif op == "remove":
            from .core import GoalStatus

            store.set_goal_status(slug, bl.item_id, GoalStatus.dropped)
            changes.append(f"goal dropped: {bl.text}")
        elif op == "add":
            store.add_goal(slug, el.text, src=Provenance.user)
            changes.append(f"goal added: {el.text}")
    return changes


def _reconcile_notes(store, slug, edited) -> list[str]:
    from .notedoc import notes_text

    ez = edited.zone("notes")
    if ez is None:  # heading gone -> don't touch notes.md
        return []
    new_text = notes_text(edited)
    if new_text != store.read_notes(slug).strip():
        store.set_notes(slug, new_text)
        return ["notes updated"]
    return []
