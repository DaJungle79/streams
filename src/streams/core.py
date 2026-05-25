"""Domain models for Streams.

A Stream is a container of four sub-object collections — goals, todos, events,
notes — plus metadata. These dataclasses are pure data; persistence lives in
``streams.store`` and (de)serialization in ``streams.markdown``.

Provenance is tracked on every item so agent-created content stays
distinguishable from user-created content (the FR-11 trust mechanism); the
visual marker is a render concern (Phase 2), but the source of truth is ``src``.
"""

from __future__ import annotations

import enum
import re
import secrets
from dataclasses import dataclass, field
from datetime import date, datetime


class StreamState(str, enum.Enum):
    active = "active"
    maintenance = "maintenance"
    dormant = "dormant"


class GoalStatus(str, enum.Enum):
    active = "active"
    achieved = "achieved"
    dropped = "dropped"


class TodoStatus(str, enum.Enum):
    open = "open"
    done = "done"
    deferred = "deferred"
    archived = "archived"


class Provenance(str, enum.Enum):
    user = "user"
    agent = "agent"
    reminders_sync = "reminders-sync"


class EventType(str, enum.Enum):
    event = "event"
    decision = "decision"
    agent_note = "agent-note"


class EventSource(str, enum.Enum):
    manual = "manual"
    agent = "agent"
    sync = "sync"


@dataclass
class Stream:
    """Stream metadata (the ``stream.md`` frontmatter). Collections live in
    sibling files and are loaded separately by the store."""

    id: str  # slug, also the folder name
    title: str
    state: StreamState = StreamState.active
    weight: int = 0
    note_id: str | None = None  # Apple Notes identifier, set in Phase 2
    created: date = field(default_factory=date.today)


@dataclass
class Goal:
    id: str
    text: str
    status: GoalStatus = GoalStatus.active
    src: Provenance = Provenance.user
    created: date = field(default_factory=date.today)
    target: date | None = None


@dataclass
class Todo:
    id: str
    text: str
    status: TodoStatus = TodoStatus.open
    src: Provenance = Provenance.user
    created: date = field(default_factory=date.today)
    due: date | None = None
    completed: date | None = None
    reminder_id: str | None = None  # set when pushed to Apple Reminders (Phase 4)


@dataclass
class Event:
    id: str
    timestamp: datetime
    content: str
    type: EventType = EventType.event
    source: EventSource = EventSource.manual


def new_id(prefix: str) -> str:
    """Short, collision-resistant id, e.g. ``t_1a2b3c4d``."""
    return f"{prefix}_{secrets.token_hex(4)}"


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    """Turn a title into a filesystem-safe slug."""
    slug = _SLUG_RE.sub("-", title.lower().strip()).strip("-")
    return slug or "stream"
