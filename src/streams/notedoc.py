"""The note document model: one canonical representation for a stream's note.

A note is an ordered list of zones. Some zones are user-owned (goals, todos,
free notes) and some are agent-owned or read-only (agent synthesis, recent
events). Each zone holds lines; for items that came from the store, the line
carries its ``item_id`` so the reconciler can map an edited line back to a goal
or todo.

Everything is anchored on a **canonical text serialization**: the Apple Notes
bridge renders this text as HTML and, crucially, parses by stripping HTML back to
text and re-parsing. That makes the round-trip robust to Apple's HTML
normalization — we never depend on a fragile HTML structure, only on the text
content surviving (which it does). The 🤖 agent marker and ``[ ]/[x]`` checkboxes
are serialization-layer decorations; ``NoteLine.text`` is always the clean store
text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

AGENT_MARK = "🤖"

# kind -> (display heading, user-editable?)
_ZONE_DEFS: dict[str, tuple[str, bool]] = {
    "agent": ("Agent", False),
    "goals": ("Goals", True),
    "todos": ("To-dos", True),
    "notes": ("Notes", True),
    "events": ("Recent events", False),
}
# heading text (lowercased) -> kind, for parsing
_HEADING_TO_KIND = {f"{AGENT_MARK} {h}".lower(): k for k, (h, _) in _ZONE_DEFS.items()}
_HEADING_TO_KIND.update({h.lower(): k for k, (h, _) in _ZONE_DEFS.items()})


@dataclass
class NoteLine:
    text: str
    item_id: str | None = None  # store id (goal/todo) this line was rendered from
    checked: bool | None = None  # todo checkbox state; None for non-todo lines
    agent: bool = False  # FR-11: agent-created item -> 🤖 marker


@dataclass
class Zone:
    kind: str
    heading: str
    editable: bool
    lines: list[NoteLine] = field(default_factory=list)


@dataclass
class NoteDocument:
    title: str
    zones: list[Zone] = field(default_factory=list)

    def zone(self, kind: str) -> Zone | None:
        return next((z for z in self.zones if z.kind == kind), None)


def make_zone(kind: str, lines: list[NoteLine] | None = None) -> Zone:
    heading, editable = _ZONE_DEFS[kind]
    return Zone(kind=kind, heading=heading, editable=editable, lines=lines or [])


# --- serialization ----------------------------------------------------------


def format_line(kind: str, line: NoteLine) -> str:
    mark = f"{AGENT_MARK} " if line.agent else ""
    if kind == "todos":
        box = "[x] " if line.checked else "[ ] "
        return f"- {box}{mark}{line.text}"
    if kind == "goals":
        return f"- {mark}{line.text}"
    if kind == "events":
        return f"- {line.text}"
    return line.text  # agent, notes


def serialize_text(doc: NoteDocument) -> str:
    out: list[str] = [doc.title, ""]
    for zone in doc.zones:
        heading = f"{AGENT_MARK} {zone.heading}" if zone.kind == "agent" else zone.heading
        out.append(heading)
        for line in zone.lines:
            out.append(format_line(zone.kind, line))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


_TODO_RE = re.compile(r"^-\s*\[([ xX])\]\s*(.*)$")
_BULLET_RE = re.compile(r"^-\s+(.*)$")


def _split_marker(text: str) -> tuple[str, bool]:
    if text.startswith(AGENT_MARK):
        return text[len(AGENT_MARK):].lstrip(), True
    return text, False


def parse_text(text: str) -> NoteDocument:
    """Parse canonical text (or HTML-stripped text) back into a document.

    Item ids are not recoverable here (the user's editor doesn't preserve them);
    the reconciler re-associates lines with store items by aligning against the
    last-rendered snapshot.
    """
    title = ""
    zones: list[Zone] = []
    current: Zone | None = None
    seen_title = False

    for raw in text.split("\n"):
        line = raw.rstrip()
        stripped = line.strip()
        key = stripped.lower()

        if not seen_title:
            if stripped:
                title = stripped
                seen_title = True
            continue

        if key in _HEADING_TO_KIND:
            current = make_zone(_HEADING_TO_KIND[key])
            zones.append(current)
            continue

        if current is None:
            continue

        if current.kind == "notes":
            current.lines.append(NoteLine(line))  # preserve blanks/indent
            continue
        if not stripped:
            continue
        if current.kind == "todos":
            m = _TODO_RE.match(stripped)
            if not m:
                continue
            checked = m.group(1).lower() == "x"
            txt, agent = _split_marker(m.group(2).strip())
            current.lines.append(NoteLine(txt, checked=checked, agent=agent))
        elif current.kind == "goals":
            m = _BULLET_RE.match(stripped)
            if not m:
                continue
            txt, agent = _split_marker(m.group(1).strip())
            current.lines.append(NoteLine(txt, agent=agent))
        else:  # agent, events (read-only; parsed for completeness)
            txt = _BULLET_RE.match(stripped)
            current.lines.append(NoteLine(txt.group(1) if txt else stripped))

    # trim trailing blank lines that belong to zone separation, not the notes body
    notes = next((z for z in zones if z.kind == "notes"), None)
    if notes:
        while notes.lines and not notes.lines[-1].text.strip():
            notes.lines.pop()

    return NoteDocument(title=title, zones=zones)


def notes_text(doc: NoteDocument) -> str:
    """The free-notes zone joined back to plain text (for writing notes.md)."""
    zone = doc.zone("notes")
    if zone is None:
        return ""
    return "\n".join(line.text for line in zone.lines).strip()
