from streams.agent.llm import FakeLLM, Usage, cost


def test_cost_input_output():
    assert cost("claude-opus-4-7", 1_000_000, 0) == 5.0
    assert cost("claude-opus-4-7", 0, 1_000_000) == 25.0
    assert cost("claude-haiku-4-5", 1_000_000, 1_000_000) == 6.0


def test_cost_handles_dated_id_and_cache():
    # dated full id still matches the alias prefix
    assert cost("claude-haiku-4-5-20251001", 1_000_000, 0) == 1.0
    # cache reads are ~0.1x input
    assert cost("claude-opus-4-7", 0, 0, cache_read=1_000_000) == 0.5


def test_cost_unknown_model_is_zero():
    assert cost("some-local-model", 1_000_000, 1_000_000) == 0.0


def test_usage_cost_property():
    u = Usage("claude-haiku-4-5", input_tokens=1_000_000, output_tokens=0)
    assert u.cost_usd == 1.0


def test_fake_llm_shapes():
    llm = FakeLLM()
    data, usage = llm.complete_json("sys", "user ctx", {})
    assert set(data) == {"current_state", "whats_next", "suggestions"}
    assert usage.input_tokens > 0
    text, usage2 = llm.complete_text("sys", "user ctx")
    assert isinstance(text, str)
    assert llm.calls == [("json", "user ctx"), ("text", "user ctx")]
