"""Token-budgeted context assembly.

Goals and open todos are always included (small and load-bearing); recent events
(newest first) and notes fill the remaining budget and are trimmed to fit. The
budget is a hard cap on assembled input — context comes from retrieval, not bulk
load (a brief NFR). Token counts are estimated (~4 chars/token); good enough for
budgeting without a network round-trip.
"""

from __future__ import annotations

from datetime import date

from ..core import GoalStatus, Provenance, TodoStatus
from ..store import Store

DEFAULT_BUDGET = 8000


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def build_stream_context(store: Store, slug: str, budget_tokens: int = DEFAULT_BUDGET) -> str:
    stream = store.read_stream(slug)

    goals = [g for g in store.list_goals(slug) if g.status is GoalStatus.active]
    todos = [t for t in store.list_todos(slug) if t.status in (TodoStatus.open, TodoStatus.deferred)]

    head = [
        f"# Stream: {stream.title}  (state={stream.state.value}, weight={stream.weight})",
        "## Goals",
        "\n".join(f"- {g.text}" for g in goals) or "(none)",
        "## Open todos",
        "\n".join(
            f"- {t.text}"
            + (f" (due {t.due})" if t.due else "")
            + (" [agent-suggested]" if t.src is Provenance.agent else "")
            for t in todos
        )
        or "(none)",
    ]
    head_text = "\n".join(head)
    remaining = budget_tokens - estimate_tokens(head_text)

    # Recent events, newest first, up to ~60% of the remaining budget.
    event_lines: list[str] = []
    event_cap = max(0, remaining) * 0.6
    for e in reversed(store.list_events(slug)):
        line = f"- {e.timestamp:%Y-%m-%d} [{e.type.value}] {e.content}"
        if estimate_tokens("\n".join([*event_lines, line])) > event_cap:
            break
        event_lines.append(line)
    events_block = "## Recent events (newest first)\n" + ("\n".join(event_lines) or "(none)")

    # Notes get whatever budget is left.
    notes = store.read_notes(slug).strip()
    notes_budget_chars = max(0, (remaining - estimate_tokens(events_block)) * 4)
    notes_block = "## Notes\n" + (notes[:notes_budget_chars] if notes else "(none)")

    return f"{head_text}\n\n{events_block}\n\n{notes_block}"


def _stream_state_line(store: Store, slug: str) -> str:
    """The 'Current state — ...' line from a stream's agent synthesis, if any."""
    first = store.read_agent(slug).strip().splitlines()
    return first[0] if first else ""


def build_overseer_context(
    store: Store,
    slugs: list[str],
    prior_status: str,
    prior_memory: str,
    budget_tokens: int = DEFAULT_BUDGET,
) -> str:
    """Context for the high-level overseer: its own memory + status, then a
    compact snapshot of every active stream."""
    today = date.today()
    lines = ["# Overseer input", f"Date: {today}", ""]
    if prior_memory.strip():
        lines += ["## Your durable memory (carry forward, refine, prune)", prior_memory.strip(), ""]
    if prior_status.strip():
        lines += ["## Your previous status", prior_status.strip(), ""]

    lines.append("## Active streams")
    for slug in slugs:
        stream = store.read_stream(slug)
        todos = [t for t in store.list_todos(slug) if t.status in (TodoStatus.open, TodoStatus.deferred)]
        due_soon = [t for t in todos if t.due and (t.due - today).days <= 7]
        state = _stream_state_line(store, slug)
        lines.append(f"### {stream.title}  (state={stream.state.value}, weight={stream.weight})")
        lines.append(f"open todos: {len(todos)}; due within 7d: {len(due_soon)}")
        if due_soon:
            lines.append("due soon: " + "; ".join(t.text for t in due_soon[:5]))
        if state:
            lines.append(state)
        lines.append("")
    return "\n".join(lines)[: budget_tokens * 4]


def build_digest_context(store: Store, slugs: list[str], budget_tokens: int = DEFAULT_BUDGET) -> str:
    lines = ["# Active streams (for today's digest)", f"Date: {date.today()}", ""]
    today = date.today()
    for slug in slugs:
        stream = store.read_stream(slug)
        todos = [t for t in store.list_todos(slug) if t.status in (TodoStatus.open, TodoStatus.deferred)]
        due_soon = [t for t in todos if t.due and (t.due - today).days <= 7]
        state = store.read_agent(slug).strip().splitlines()
        lines.append(f"## {stream.title}  (weight {stream.weight})")
        lines.append(f"open todos: {len(todos)}; due within 7d: {len(due_soon)}")
        if due_soon:
            lines.append("due soon: " + "; ".join(t.text for t in due_soon[:5]))
        if state:
            lines.append(f"agent state: {state[0]}")
        lines.append("")
    return "\n".join(lines)[: budget_tokens * 4]
