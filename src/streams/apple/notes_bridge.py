"""Notes bridges: the boundary between the pure note core and Apple Notes.

``NotesBridge`` is the interface the sync layer depends on. ``FakeNotesBridge``
is an in-memory implementation that *faithfully mimics the lossy round-trip* — it
stores the canonical text and re-parses on read, so item ids are dropped exactly
as they are with real Notes. That makes tests exercise the same reconcile path
production uses. ``AppleNotesBridge`` drives real Notes via ``osascript``.

The Apple bridge renders the document as HTML and parses by **stripping HTML back
to text** and re-parsing, so it never depends on Apple's HTML structure — only on
the text surviving. NOTE: this uses plain ``[ ] / [x]`` text checkboxes, which
round-trip reliably. Whether native Notes checklists can be created/read via
AppleScript is the open question probed by ``docs/spikes/s4_note_checklist.py``;
if viable, native checkboxes are a later UX upgrade layered on this same model.
"""

from __future__ import annotations

import html
import os
import re
import subprocess
import tempfile
import textwrap
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Protocol

from ..notes.notedoc import NoteDocument, parse_text, serialize_text


@contextmanager
def _html_tempfile(body: str):
    """Write `body` to a temp file and yield its path. The note HTML can be large
    (bigger than ARG_MAX), so it's passed to osascript by file path, never argv."""
    fd, path = tempfile.mkstemp(prefix="streams-note-", suffix=".html")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        yield path
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


class NoteGone(Exception):
    """The target note no longer exists or sits in Recently Deleted (uneditable).

    Raised by the bridge so the sync layer can react to a user-deleted note
    instead of crashing on the raw osascript error."""


@dataclass
class NoteRef:
    """A lightweight reference to an existing note (for folder discovery/capture)."""

    id: str
    title: str
    text: str  # plain text of the note body


class NotesBridge(Protocol):
    def create_note(self, title: str, doc: NoteDocument, folder: str | None = None) -> str: ...
    def read_note(self, note_id: str) -> NoteDocument: ...
    def write_note(self, note_id: str, doc: NoteDocument) -> None: ...
    def find_notes_in_folder(self, folder: str) -> list[NoteRef]: ...


class FakeNotesBridge:
    """In-memory bridge that mimics Apple's text-only round-trip (drops ids)."""

    def __init__(self) -> None:
        self.notes: dict[str, str] = {}
        self.titles: dict[str, str] = {}
        self.folders: dict[str, str | None] = {}
        self._seq = 0

    def create_note(self, title: str, doc: NoteDocument, folder: str | None = None) -> str:
        self._seq += 1
        note_id = f"note-{self._seq}"
        self.notes[note_id] = serialize_text(doc)
        self.titles[note_id] = title
        self.folders[note_id] = folder
        return note_id

    def read_note(self, note_id: str) -> NoteDocument:
        if note_id not in self.notes:
            raise NoteGone(note_id)
        return parse_text(self.notes[note_id])

    def write_note(self, note_id: str, doc: NoteDocument) -> None:
        if note_id not in self.notes:
            raise NoteGone(note_id)
        self.notes[note_id] = serialize_text(doc)
        self.titles[note_id] = doc.title

    def find_notes_in_folder(self, folder: str) -> list[NoteRef]:
        return [
            NoteRef(nid, self.titles.get(nid, ""), self.notes[nid])
            for nid, fld in self.folders.items()
            if fld == folder and nid in self.notes
        ]

    # test helper: simulate a user editing the note in the Notes app
    def user_edit(self, note_id: str, transform) -> None:
        self.notes[note_id] = transform(self.notes[note_id])

    # test helper: simulate a user deleting the note (subsequent r/w raise NoteGone)
    def delete_note(self, note_id: str) -> None:
        self.notes.pop(note_id, None)
        self.titles.pop(note_id, None)
        self.folders.pop(note_id, None)

    # test helper: simulate a user creating their own note in a folder
    def add_external_note(self, title: str, text: str, folder: str | None = None) -> str:
        self._seq += 1
        note_id = f"ext-{self._seq}"
        self.notes[note_id] = text
        self.titles[note_id] = title
        self.folders[note_id] = folder
        return note_id


def doc_to_html(doc: NoteDocument) -> str:
    """Render the canonical text as simple Notes-friendly HTML (one div per line)."""
    parts = [f"<div><h1>{html.escape(doc.title)}</h1></div>"]
    for line in serialize_text(doc).split("\n")[2:]:  # skip title + blank
        if not line.strip():
            parts.append("<div><br></div>")
        else:
            parts.append(f"<div>{html.escape(line)}</div>")
    return "".join(parts)


_TAG_RE = re.compile(r"<[^>]+>")
_BLOCK_RE = re.compile(r"</(div|h1|h2|li|p)>|<br\s*/?>", re.IGNORECASE)
# A <br> right before a block close is that block's only/last line break, not a
# line of its own — e.g. a blank line is "<div><br></div>". Without this, each
# such <br> adds an extra newline and blank lines DOUBLE on every round-trip.
_BR_BEFORE_CLOSE_RE = re.compile(r"<br\s*/?>\s*(?=</(?:div|h1|h2|li|p)>)", re.IGNORECASE)


def html_to_text(body: str) -> str:
    # Apple pretty-prints stored HTML with literal newlines between tags
    # (</div>\n<div>). Those are formatting, not content — line structure comes
    # only from block tags and <br> — so drop them, else every line accretes an
    # extra blank on each round-trip.
    body = body.replace("\r", "").replace("\n", "")
    body = _BR_BEFORE_CLOSE_RE.sub("", body)
    text = _BLOCK_RE.sub("\n", body)
    text = _TAG_RE.sub("", text)
    return html.unescape(text)


class AppleNotesBridge:
    """Real Apple Notes via osascript. Pending on-device validation (see s4)."""

    def __init__(self, account: str = "iCloud") -> None:
        self.account = account

    @staticmethod
    def _osa(script: str, *args: str) -> str:
        proc = subprocess.run(
            ["osascript", "-", *args], input=script, capture_output=True, text=True
        )
        if proc.returncode != 0:
            err = proc.stderr.strip()
            low = err.lower()
            # a deleted note ("Recently Deleted") or a purged one ("can't get note id")
            if "recently deleted" in low or "get note id" in low:
                raise NoteGone(err)
            raise RuntimeError(err or "osascript failed")
        return proc.stdout.strip()

    def create_note(self, title: str, doc: NoteDocument, folder: str | None = None) -> str:
        # Create inside `folder` (made if absent) so the note is discoverable by
        # folder membership; with no folder, create at the account's default location.
        script = textwrap.dedent(
            """
            on run argv
                set acctName to item 1 of argv
                set bodyPath to item 2 of argv
                set folderName to item 3 of argv
                set noteBody to (read (POSIX file bodyPath) as «class utf8»)
                tell application "Notes" to tell account acctName
                    if folderName is "" then
                        return id of (make new note with properties {body:noteBody})
                    end if
                    if not (exists folder folderName) then
                        make new folder with properties {name:folderName}
                    end if
                    tell folder folderName
                        return id of (make new note with properties {body:noteBody})
                    end tell
                end tell
            end run
            """
        )
        with _html_tempfile(doc_to_html(doc)) as path:
            return self._osa(script, self.account, path, folder or "")

    def read_note(self, note_id: str) -> NoteDocument:
        script = textwrap.dedent(
            """
            on run argv
                tell application "Notes" to return body of note id (item 1 of argv)
            end run
            """
        )
        return parse_text(html_to_text(self._osa(script, note_id)))

    def write_note(self, note_id: str, doc: NoteDocument) -> None:
        script = textwrap.dedent(
            """
            on run argv
                set noteId to item 1 of argv
                set bodyPath to item 2 of argv
                set noteBody to (read (POSIX file bodyPath) as «class utf8»)
                tell application "Notes" to set body of note id noteId to noteBody
            end run
            """
        )
        with _html_tempfile(doc_to_html(doc)) as path:
            self._osa(script, note_id, path)

    def find_notes_in_folder(self, folder: str) -> list[NoteRef]:
        # List every note in `folder`. Folder membership is reliable via AppleScript
        # (unlike native #hashtags). Fields are \x1f-separated, notes \x1e-separated.
        script = textwrap.dedent(
            """
            on run argv
                set acctName to item 1 of argv
                set folderName to item 2 of argv
                set fs to (ASCII character 31)
                set rs to (ASCII character 30)
                set out to ""
                tell application "Notes" to tell account acctName
                    if exists folder folderName then
                        tell folder folderName
                            repeat with n in notes
                                set out to out & (id of n) & fs & (name of n) & fs & (body of n) & rs
                            end repeat
                        end tell
                    end if
                end tell
                return out
            end run
            """
        )
        raw = self._osa(script, self.account, folder)
        refs: list[NoteRef] = []
        for record in raw.split("\x1e"):
            if not record.strip():
                continue
            parts = record.split("\x1f")
            if len(parts) < 3:
                continue
            note_id, name, body = parts[0], parts[1], parts[2]
            refs.append(NoteRef(note_id.strip(), name.strip(), html_to_text(body)))
        return refs
