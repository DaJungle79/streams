from datetime import datetime

import pytest

from streams.agent.llm import FakeLLM
from streams.agent.runner import (
    META_SLUG,
    daily_digest,
    run_pass,
    should_process,
    synthesize_stream,
)
from streams.core import EventSource, EventType, Provenance, StreamState
from streams.notes.render import render
from streams.store import Store


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "data")
    s.create_stream("Trip")
    s.add_todo("trip", "Book flights")
    return s


def test_synthesize_writes_state_and_marks_suggestion(store):
    llm = FakeLLM(synthesis={
        "current_state": "Planning underway.",
        "whats_next": "Lock the dates.",
        "suggestions": ["Reserve the villa"],
    })
    result = synthesize_stream(store, llm, "trip")

    # synthesis written + rendered into the agent zone
    assert "Planning underway." in store.read_agent("trip")
    agent_zone = render(store, "trip").zone("agent")
    assert any("Planning underway." in l.text for l in agent_zone.lines)

    # suggestion added as a marked agent todo (FR-11)
    suggested = [t for t in store.list_todos("trip") if t.text == "Reserve the villa"]
    assert suggested and suggested[0].src is Provenance.agent
    assert result.suggestions_added == ["Reserve the villa"]


def test_synthesize_logs_agent_note_and_cost(store):
    synthesize_stream(store, FakeLLM(), "trip")
    notes = [e for e in store.list_events("trip")
             if e.type is EventType.agent_note and e.source is EventSource.agent]
    assert notes
    # cost ledger written to the meta stream
    meta_events = store.list_events(META_SLUG)
    assert any("cost=$" in e.content for e in meta_events)
    assert store.read_stream(META_SLUG).state is StreamState.dormant


def test_suggestions_deduped_against_existing(store):
    # a todo already matching the suggestion -> not added again
    store.add_todo("trip", "Reserve the villa")
    llm = FakeLLM(synthesis={"current_state": "x", "whats_next": "y",
                             "suggestions": ["Reserve the villa"]})
    result = synthesize_stream(store, llm, "trip")
    assert result.suggestions_added == []
    villas = [t for t in store.list_todos("trip") if t.text == "Reserve the villa"]
    assert len(villas) == 1


def test_run_pass_respects_state(store):
    store.create_stream("Dormant one", state=StreamState.dormant)
    store.create_stream("Maint", state=StreamState.maintenance)
    # maintenance with no events -> no material change -> skipped
    results = run_pass(store, FakeLLM())
    slugs = {r.slug for r in results}
    assert "trip" in slugs              # active
    assert "dormant-one" not in slugs   # dormant
    assert "maint" not in slugs         # maintenance, nothing material
    assert META_SLUG not in slugs       # ledger never processed


def test_maintenance_processed_after_material_change(store):
    store.create_stream("Maint", state=StreamState.maintenance)
    store.append_event("maint", "client emailed", source=EventSource.manual,
                       timestamp=datetime(2026, 5, 20, 9, 0))
    assert should_process(store, store.read_stream("maint")) is True
    results = run_pass(store, FakeLLM())
    assert "maint" in {r.slug for r in results}


def test_daily_digest_writes_meta_and_returns_text(store):
    text, usage = daily_digest(store, FakeLLM(digest_text="Top priority: flights."))
    assert "flights" in text
    assert "flights" in store.read_agent(META_SLUG)
    assert usage.cost_usd >= 0
