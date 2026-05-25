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
import re
import subprocess
import textwrap
from dataclasses import dataclass
from typing import Protocol

from .notedoc import NoteDocument, parse_text, serialize_text


@dataclass
class NoteRef:
    """A lightweight reference to an existing note (for tag discovery/capture)."""

    id: str
    title: str
    text: str  # plain text of the note body


def note_has_tag(text: str, tag: str) -> bool:
    """True if `text` contains `tag` as a whole hashtag token (#stream, not #streams)."""
    return re.search(re.escape(tag) + r"\b", text, re.IGNORECASE) is not None


def strip_tag(text: str, tag: str) -> str:
    return re.sub(re.escape(tag) + r"\b", "", text, flags=re.IGNORECASE).strip()


class NotesBridge(Protocol):
    def create_note(self, title: str, doc: NoteDocument) -> str: ...
    def read_note(self, note_id: str) -> NoteDocument: ...
    def write_note(self, note_id: str, doc: NoteDocument) -> None: ...
    def find_notes_with_tag(self, tag: str) -> list[NoteRef]: ...


class FakeNotesBridge:
    """In-memory bridge that mimics Apple's text-only round-trip (drops ids)."""

    def __init__(self) -> None:
        self.notes: dict[str, str] = {}
        self.titles: dict[str, str] = {}
        self._seq = 0

    def create_note(self, title: str, doc: NoteDocument) -> str:
        self._seq += 1
        note_id = f"note-{self._seq}"
        self.notes[note_id] = serialize_text(doc)
        self.titles[note_id] = title
        return note_id

    def read_note(self, note_id: str) -> NoteDocument:
        return parse_text(self.notes[note_id])

    def write_note(self, note_id: str, doc: NoteDocument) -> None:
        self.notes[note_id] = serialize_text(doc)
        self.titles[note_id] = doc.title

    def find_notes_with_tag(self, tag: str) -> list[NoteRef]:
        return [
            NoteRef(nid, self.titles.get(nid, ""), text)
            for nid, text in self.notes.items()
            if note_has_tag(text, tag)
        ]

    # test helper: simulate a user editing the note in the Notes app
    def user_edit(self, note_id: str, transform) -> None:
        self.notes[note_id] = transform(self.notes[note_id])

    # test helper: simulate a user creating their own (untracked) note
    def add_external_note(self, title: str, text: str) -> str:
        self._seq += 1
        note_id = f"ext-{self._seq}"
        self.notes[note_id] = text
        self.titles[note_id] = title
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


def html_to_text(body: str) -> str:
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
            raise RuntimeError(proc.stderr.strip() or "osascript failed")
        return proc.stdout.strip()

    def create_note(self, title: str, doc: NoteDocument) -> str:
        script = textwrap.dedent(
            """
            on run argv
                set acctName to item 1 of argv
                set noteBody to item 2 of argv
                tell application "Notes" to tell account acctName
                    return id of (make new note with properties {body:noteBody})
                end tell
            end run
            """
        )
        return self._osa(script, self.account, doc_to_html(doc))

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
                tell application "Notes" to set body of note id (item 1 of argv) to (item 2 of argv)
            end run
            """
        )
        self._osa(script, note_id, doc_to_html(doc))

    def find_notes_with_tag(self, tag: str) -> list[NoteRef]:
        # Coarse filter in AppleScript (body contains), precise filter in Python.
        # Fields are \x1f-separated, notes \x1e-separated.
        script = textwrap.dedent(
            """
            on run argv
                set acctName to item 1 of argv
                set tagText to item 2 of argv
                set fs to (ASCII character 31)
                set rs to (ASCII character 30)
                set out to ""
                tell application "Notes" to tell account acctName
                    repeat with n in (notes whose body contains tagText)
                        set out to out & (id of n) & fs & (name of n) & fs & (body of n) & rs
                    end repeat
                end tell
                return out
            end run
            """
        )
        raw = self._osa(script, self.account, tag)
        refs: list[NoteRef] = []
        for record in raw.split("\x1e"):
            if not record.strip():
                continue
            parts = record.split("\x1f")
            if len(parts) < 3:
                continue
            note_id, name, body = parts[0], parts[1], parts[2]
            text = html_to_text(body)
            if note_has_tag(text, tag):
                refs.append(NoteRef(note_id.strip(), name.strip(), text))
        return refs
