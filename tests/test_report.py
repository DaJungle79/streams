from streams.agent.llm import FakeLLM
from streams.agent.runner import synthesize_stream
from streams.report import weekly_report
from streams.store import Store


def test_report_aggregates_cost_and_suggestions(tmp_path):
    store = Store(tmp_path / "data")
    store.create_stream("Trip")
    # a synthesis pass logs cost to meta and (with this canned LLM) adds 1 suggestion
    synthesize_stream(store, FakeLLM(synthesis={
        "current_state": "x", "whats_next": "y", "suggestions": ["do a thing"],
    }), "trip")

    report = weekly_report(store, days=7)
    assert "agent calls logged: 1" in report
    assert "suggestions added:  1" in report
    assert "estimated cost:" in report


def test_report_without_meta_is_safe(tmp_path):
    store = Store(tmp_path / "data")
    store.create_stream("Trip")
    report = weekly_report(store)  # no agent runs yet -> no meta stream
    assert "agent calls logged: 0" in report
