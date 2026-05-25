"""Sync orchestration: the render ↔ reconcile round-trip for one stream.

On each sync we read the note, reconcile any user edits into the store (user
edits always win), then re-render from the updated store and write it back, so
the note normalizes and stays consistent. The last-rendered document is
persisted to ``.render/<slug>.json`` (the manifest) to serve as the reconcile
base and to recover ids the parsed note can't carry.

This is the daemon's per-stream unit of work; the full poll loop is Phase 6.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .notedoc import NoteDocument, NoteLine, Zone, make_zone
from .notes_bridge import NoteGone, NotesBridge
from .reconcile import reconcile
from .render import render
from .store import Store


@dataclass
class SyncResult:
    slug: str
    created: bool = False
    changes: list[str] | None = None
    archived: bool = False  # the note was deleted -> the stream was archived

    def __post_init__(self) -> None:
        if self.changes is None:
            self.changes = []


# --- snapshot persistence (the manifest) ------------------------------------


def _render_dir(store: Store) -> Path:
    d = store.repo / ".render"
    d.mkdir(exist_ok=True)
    return d


def _snapshot_path(store: Store, slug: str) -> Path:
    return _render_dir(store) / f"{slug}.json"


def _doc_payload(doc: NoteDocument) -> dict:
    return {
        "title": doc.title,
        "zones": [
            {
                "kind": z.kind,
                "lines": [
                    {"text": l.text, "item_id": l.item_id, "checked": l.checked, "agent": l.agent}
                    for l in z.lines
                ],
            }
            for z in doc.zones
        ],
    }


def save_snapshot(store: Store, slug: str, doc: NoteDocument) -> None:
    payload = _doc_payload(doc)
    _snapshot_path(store, slug).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def load_snapshot(store: Store, slug: str) -> NoteDocument | None:
    path = _snapshot_path(store, slug)
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    zones: list[Zone] = []
    for z in data["zones"]:
        zone = make_zone(z["kind"])
        zone.lines = [
            NoteLine(text=l["text"], item_id=l["item_id"], checked=l["checked"], agent=l["agent"])
            for l in z["lines"]
        ]
        zones.append(zone)
    return NoteDocument(title=data["title"], zones=zones)


# --- the round-trip ---------------------------------------------------------


def sync_stream(store: Store, bridge: NotesBridge, slug: str, tag: str | None = None) -> SyncResult:
    stream = store.read_stream(slug)

    # First time: create the note from current state and snapshot it.
    if not stream.note_id:
        doc = render(store, slug, tag=tag)
        note_id = bridge.create_note(stream.title, doc)
        store.set_note_id(slug, note_id)
        save_snapshot(store, slug, doc)
        return SyncResult(slug, created=True)

    try:
        current = bridge.read_note(stream.note_id)
        # base carries ids; fall back to a fresh render if the snapshot was lost.
        snapshot = load_snapshot(store, slug)
        base = snapshot or render(store, slug, tag=tag)
        changes = reconcile(store, slug, base, current)

        # Re-render from the (now updated) store and write back when the output
        # actually differs from what the note last showed — this covers user
        # edits *and* fresh agent synthesis written since the last sync. Skip the
        # write when render == snapshot, to avoid churning the modification date.
        doc = render(store, slug, tag=tag)
        if snapshot is None or _doc_payload(doc) != _doc_payload(snapshot):
            bridge.write_note(stream.note_id, doc)
            save_snapshot(store, slug, doc)
    except NoteGone:
        # the user deleted the managed note; markdown is authoritative and is
        # preserved in archive/ (recoverable via git).
        store.archive_stream(slug)
        return SyncResult(slug, archived=True)

    return SyncResult(slug, changes=changes)


def capture_tagged(store: Store, bridge: NotesBridge, tag: str) -> list[str]:
    """Adopt user-created notes carrying `tag` that we don't already track.

    For each new tagged note: create a stream (title from the note), move the
    note's free text into the stream's notes, claim its note_id, then render our
    structured doc over it and snapshot. Returns the new stream slugs.
    """
    from .notes_bridge import strip_tag

    known = {s.note_id for s in store.list_streams() if s.note_id}
    created: list[str] = []
    for ref in bridge.find_notes_with_tag(tag):
        if ref.id in known:
            continue  # already a managed stream note
        stream = store.create_stream(ref.title.strip() or "Captured stream")
        body = strip_tag(ref.text, tag)
        if body.strip():
            store.set_notes(stream.id, body)
        store.set_note_id(stream.id, ref.id)
        doc = render(store, stream.id, tag=tag)
        bridge.write_note(ref.id, doc)
        save_snapshot(store, stream.id, doc)
        created.append(stream.id)
    return created
