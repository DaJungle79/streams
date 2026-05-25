from datetime import datetime

import pytest

from streams.agent.context import build_stream_context, estimate_tokens
from streams.store import Store


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "data")
    s.create_stream("Trip")
    s.add_goal("trip", "Relax")
    s.add_todo("trip", "Book flights")
    return s


def test_context_includes_goals_and_todos(store):
    ctx = build_stream_context(store, "trip")
    assert "Relax" in ctx
    assert "Book flights" in ctx
    assert "# Stream: Trip" in ctx


def test_context_respects_budget(store):
    # many large events
    for i in range(50):
        store.append_event("trip", f"event number {i} " + "x" * 200,
                           timestamp=datetime(2026, 5, 1, 0, i % 60))
    small = build_stream_context(store, "trip", budget_tokens=200)
    big = build_stream_context(store, "trip", budget_tokens=8000)
    assert estimate_tokens(small) < estimate_tokens(big)
    # goals/todos survive even under a tight budget
    assert "Book flights" in small


def test_notes_truncated_under_budget(store):
    store.set_notes("trip", "y" * 10000)
    ctx = build_stream_context(store, "trip", budget_tokens=300)
    assert estimate_tokens(ctx) < 600  # roughly bounded by the budget
