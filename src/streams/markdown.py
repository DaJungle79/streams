"""Serialization between domain models and the markdown source of truth.

Formats are chosen to be both human-readable/editable and round-trippable:
- ``stream.md``  : YAML frontmatter + a title heading.
- ``goals.md``   : ``- <text> <!-- id=.. status=.. ... -->`` per goal.
- ``todos.md``   : ``- [ ] <text> <!-- id=.. status=.. ... -->`` per todo
                   (the checkbox mirrors done-ness; the comment is authoritative).
- ``events/YYYY-MM.md`` : ``## <ts> · <type> · <source>`` blocks, append-only.

Item metadata rides in an HTML comment so it stays invisible in rendered
markdown but survives round-trips. Agent markers (🤖) are NOT stored here — they
are added by the note renderer based on ``src`` (Phase 2).
"""

from __future__ import annotations

import re
from datetime import date, datetime

import yaml

from .core import (
    Event,
    EventSource,
    EventType,
    Goal,
    GoalStatus,
    Provenance,
    Stream,
    StreamState,
    Todo,
    TodoStatus,
    new_id,
)

# --- date helpers -----------------------------------------------------------


def to_iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def date_from_iso(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def as_date(value: object) -> date:
    if value is None:
        return date.today()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


# --- frontmatter ------------------------------------------------------------

_FM_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    return (yaml.safe_load(m.group(1)) or {}), m.group(2)


def dump_frontmatter(data: dict, body: str = "") -> str:
    fm = yaml.safe_dump(data, sort_keys=False, allow_unicode=True).strip()
    return f"---\n{fm}\n---\n{body}"


# --- metadata comments ------------------------------------------------------

_META_RE = re.compile(r"<!--\s*(.*?)\s*-->")


def parse_meta(s: str) -> dict[str, str]:
    m = _META_RE.search(s)
    if not m:
        return {}
    out: dict[str, str] = {}
    for token in m.group(1).split():
        if "=" in token:
            key, val = token.split("=", 1)
            out[key] = val
    return out


def format_meta(fields: dict[str, object]) -> str:
    parts = [f"{k}={v}" for k, v in fields.items() if v is not None and v != ""]
    return "<!-- " + " ".join(parts) + " -->"


def _strip_meta(s: str) -> str:
    return _META_RE.sub("", s).strip()


# --- stream.md --------------------------------------------------------------


def format_stream(stream: Stream) -> str:
    fm = {
        "id": stream.id,
        "title": stream.title,
        "state": stream.state.value,
        "weight": stream.weight,
        "note_id": stream.note_id,
        "created": to_iso(stream.created),
    }
    return dump_frontmatter(fm, f"\n# {stream.title}\n")


def parse_stream(text: str) -> Stream:
    data, _ = parse_frontmatter(text)
    return Stream(
        id=data["id"],
        title=data["title"],
        state=StreamState(data.get("state", "active")),
        weight=int(data.get("weight", 0)),
        note_id=data.get("note_id"),
        created=as_date(data.get("created")),
    )


# --- goals.md ---------------------------------------------------------------

_GOAL_RE = re.compile(r"^-\s+(.*)$")


def format_goal(goal: Goal) -> str:
    meta = format_meta(
        {
            "id": goal.id,
            "status": goal.status.value,
            "src": goal.src.value,
            "created": to_iso(goal.created),
            "target": to_iso(goal.target),
        }
    )
    return f"- {goal.text} {meta}"


def format_goals(goals: list[Goal]) -> str:
    lines = ["# Goals", ""] + [format_goal(g) for g in goals]
    return "\n".join(lines).rstrip() + "\n"


def parse_goals(text: str) -> list[Goal]:
    goals: list[Goal] = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#") or not line:
            continue
        m = _GOAL_RE.match(line)
        if not m:
            continue
        rest = m.group(1)
        meta = parse_meta(rest)
        goals.append(
            Goal(
                id=meta.get("id") or new_id("g"),
                text=_strip_meta(rest),
                status=GoalStatus(meta.get("status", "active")),
                src=Provenance(meta.get("src", "user")),
                created=date_from_iso(meta.get("created")) or date.today(),
                target=date_from_iso(meta.get("target")),
            )
        )
    return goals


# --- todos.md ---------------------------------------------------------------

_TODO_RE = re.compile(r"^- \[([ xX])\]\s*(.*)$")


def format_todo(todo: Todo) -> str:
    box = "x" if todo.status is TodoStatus.done else " "
    meta = format_meta(
        {
            "id": todo.id,
            "status": todo.status.value,
            "src": todo.src.value,
            "created": to_iso(todo.created),
            "due": to_iso(todo.due),
            "completed": to_iso(todo.completed),
            "reminder_id": todo.reminder_id,
        }
    )
    return f"- [{box}] {todo.text} {meta}"


def format_todos(todos: list[Todo]) -> str:
    lines = ["# TODOs", ""] + [format_todo(t) for t in todos]
    return "\n".join(lines).rstrip() + "\n"


def parse_todos(text: str) -> list[Todo]:
    todos: list[Todo] = []
    for line in text.splitlines():
        m = _TODO_RE.match(line.strip())
        if not m:
            continue
        box, rest = m.group(1), m.group(2)
        meta = parse_meta(rest)
        # The comment's status is authoritative; fall back to the checkbox for
        # lines a human added by hand without metadata.
        if "status" in meta:
            status = TodoStatus(meta["status"])
        else:
            status = TodoStatus.done if box.lower() == "x" else TodoStatus.open
        todos.append(
            Todo(
                id=meta.get("id") or new_id("t"),
                text=_strip_meta(rest),
                status=status,
                src=Provenance(meta.get("src", "user")),
                created=date_from_iso(meta.get("created")) or date.today(),
                due=date_from_iso(meta.get("due")),
                completed=date_from_iso(meta.get("completed")),
                reminder_id=meta.get("reminder_id"),
            )
        )
    return todos


# --- events/YYYY-MM.md ------------------------------------------------------


def format_event(event: Event) -> str:
    header = f"## {event.timestamp.isoformat()} · {event.type.value} · {event.source.value}"
    return f"{header}\n{format_meta({'id': event.id})}\n{event.content}"


def parse_events(text: str) -> list[Event]:
    events: list[Event] = []
    for part in re.split(r"(?m)^## ", text):
        part = part.rstrip()
        if not part:
            continue
        lines = part.split("\n")
        header = lines[0].strip()
        if "·" not in header:  # the file's "# Events YYYY-MM" heading, skip
            continue
        ts_s, type_s, source_s = (x.strip() for x in header.split("·"))
        body = "\n".join(lines[1:])
        meta = parse_meta(body)
        events.append(
            Event(
                id=meta.get("id") or new_id("e"),
                timestamp=datetime.fromisoformat(ts_s),
                content=_strip_meta(body),
                type=EventType(type_s),
                source=EventSource(source_s),
            )
        )
    return events
