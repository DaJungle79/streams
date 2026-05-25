import pytest

from streams.agent.context import build_overseer_context
from streams.agent.llm import FakeLLM
from streams.agent.overseer import oversee, run_cycle
from streams.agent.runner import META_SLUG
from streams.store import Store


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "data")
    s.create_stream("Trip")
    s.add_todo("trip", "Book flights")
    s.create_stream("Company")
    s.add_todo("company", "Hire CTO")
    return s


def test_oversee_writes_status_and_memory(store):
    llm = FakeLLM(overseer={
        "summary": "Trip first, then Company hiring.",
        "focus": ["Book flights", "Open the CTO search"],
        "memory": "Trip fixed for June. Company hiring is the Q3 priority.",
    })
    result = oversee(store, llm)

    assert "Trip first" in store.read_overseer_status()
    assert "Book flights" in store.read_overseer_status()  # focus folded in
    assert "Q3 priority" in store.read_overseer_memory()
    assert result.focus == ["Book flights", "Open the CTO search"]


def test_oversee_logs_cost_to_meta(store):
    oversee(store, FakeLLM())
    meta_events = store.list_events(META_SLUG)
    assert any("overseer:" in e.content and "cost=$" in e.content for e in meta_events)


def test_overseer_context_feeds_prior_state_and_streams(store):
    ctx = build_overseer_context(
        store,
        ["trip", "company"],
        prior_status="Yesterday: trip was top.",
        prior_memory="Trip fixed for June.",
    )
    assert "Trip fixed for June." in ctx          # memory carried in
    assert "Yesterday: trip was top." in ctx       # prior status carried in
    assert "Trip" in ctx and "Company" in ctx      # all streams snapshotted


def test_oversee_continuity_across_runs(store):
    llm = FakeLLM(overseer={"summary": "s1", "focus": [], "memory": "remember: launch in Aug"})
    oversee(store, llm)
    # second run should receive the memory written by the first
    oversee(store, llm)
    json_calls = [u for kind, u in llm.calls if kind == "json"]
    assert any("remember: launch in Aug" in u for u in json_calls)


def test_run_cycle_runs_streams_then_overseer(store):
    llm = FakeLLM()
    stream_results, overseer = run_cycle(store, llm)
    assert {r.slug for r in stream_results} == {"trip", "company"}
    assert overseer.summary
    # each stream got synthesized, then the overseer ran over the fresh states
    assert store.read_agent("trip").strip()
    assert store.read_overseer_status().strip()
