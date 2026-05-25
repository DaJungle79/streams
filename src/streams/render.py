"""Render a stream's current state into a NoteDocument.

Zone order is morning-digest oriented: the agent's synthesis sits near the top
(empty until Phase 3), then the user's goals and todos, their free notes, and a
read-only tail of recent events for reference. Agent-created goals/todos get the
🤖 marker (FR-11); done todos render checked; archived items are hidden.
"""

from __future__ import annotations

from .core import GoalStatus, Provenance, TodoStatus
from .notedoc import NoteDocument, NoteLine, make_zone
from .store import Store

_AGENT_PLACEHOLDER = "_(synthesis appears here after the next agent pass)_"
_RECENT_EVENT_COUNT = 5


def render(store: Store, slug: str) -> NoteDocument:
    stream = store.read_stream(slug)

    synthesis = store.read_agent(slug).strip()
    agent_lines = (
        [NoteLine(line) for line in synthesis.splitlines()]
        if synthesis
        else [NoteLine(_AGENT_PLACEHOLDER)]
    )
    agent_zone = make_zone("agent", agent_lines)

    goals = [g for g in store.list_goals(slug) if g.status is GoalStatus.active]
    goals_zone = make_zone(
        "goals",
        [NoteLine(g.text, item_id=g.id, agent=g.src is Provenance.agent) for g in goals],
    )

    todos = [t for t in store.list_todos(slug) if t.status is not TodoStatus.archived]
    todos_zone = make_zone(
        "todos",
        [
            NoteLine(
                t.text,
                item_id=t.id,
                checked=t.status is TodoStatus.done,
                agent=t.src is Provenance.agent,
            )
            for t in todos
        ],
    )

    notes_body = store.read_notes(slug)
    notes_lines = [NoteLine(line) for line in notes_body.splitlines()] if notes_body.strip() else []
    notes_zone = make_zone("notes", notes_lines)

    events = store.list_events(slug)[-_RECENT_EVENT_COUNT:]
    events_zone = make_zone(
        "events",
        [
            NoteLine(f"{e.timestamp:%Y-%m-%d} · {e.type.value}: {e.content}")
            for e in reversed(events)
        ],
    )

    return NoteDocument(
        title=stream.title,
        zones=[agent_zone, goals_zone, todos_zone, notes_zone, events_zone],
    )
