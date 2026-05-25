"""LLM abstraction so the agent is decoupled from any specific model.

``AnthropicLLM`` drives the Claude API (structured output via output_config,
prompt caching on the frozen system prompt, usage/cost tracking). ``FakeLLM`` is
a deterministic in-memory implementation for tests — no API key needed. A future
local model implements the same protocol.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

# USD per token (input, output). Cache reads ~0.1x input; writes ~1.25x input.
PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-4-7": (5 / 1e6, 25 / 1e6),
    "claude-opus-4-6": (5 / 1e6, 25 / 1e6),
    "claude-sonnet-4-6": (3 / 1e6, 15 / 1e6),
    "claude-haiku-4-5": (1 / 1e6, 5 / 1e6),
}


def cost(model: str, in_tok: int, out_tok: int, cache_read: int = 0, cache_write: int = 0) -> float:
    for key, (p_in, p_out) in PRICING.items():
        if model.startswith(key):
            return in_tok * p_in + out_tok * p_out + cache_read * p_in * 0.1 + cache_write * p_in * 1.25
    return 0.0


@dataclass
class Usage:
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int = 0
    cache_write: int = 0

    @property
    def cost_usd(self) -> float:
        return cost(self.model, self.input_tokens, self.output_tokens, self.cache_read, self.cache_write)


def _supports_effort(model: str) -> bool:
    # effort 400s on Haiku 4.5; supported on Opus/Sonnet.
    return model.startswith(("claude-opus", "claude-sonnet"))


class LLM(Protocol):
    def complete_json(
        self, system: str, user: str, schema: dict, *, model: str | None = None
    ) -> tuple[dict, Usage]: ...

    def complete_text(
        self, system: str, user: str, *, model: str | None = None
    ) -> tuple[str, Usage]: ...


class AnthropicLLM:
    """Claude-backed LLM. Reads ANTHROPIC_API_KEY from the environment."""

    def __init__(
        self, model: str, *, api_key: str | None = None, max_tokens: int = 2048, effort: str = "medium"
    ) -> None:
        import anthropic  # lazy: keep agent import light and key-free for tests

        # api_key=None lets the SDK read ANTHROPIC_API_KEY from the environment.
        self._client = anthropic.Anthropic(api_key=api_key or None)
        self.model = model
        self.max_tokens = max_tokens
        self.effort = effort

    def _system(self, system: str) -> list[dict]:
        # frozen + cacheable; volatile content must live in the user turn
        return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]

    def complete_json(self, system, user, schema, *, model=None):
        m = model or self.model
        output_config: dict = {"format": {"type": "json_schema", "schema": schema}}
        if _supports_effort(m):
            output_config["effort"] = self.effort
        resp = self._client.messages.create(
            model=m,
            max_tokens=self.max_tokens,
            system=self._system(system),
            messages=[{"role": "user", "content": user}],
            output_config=output_config,
        )
        text = next(b.text for b in resp.content if b.type == "text")
        return json.loads(text), self._usage(resp, m)

    def complete_text(self, system, user, *, model=None):
        m = model or self.model
        kwargs: dict = {
            "model": m,
            "max_tokens": self.max_tokens,
            "system": self._system(system),
            "messages": [{"role": "user", "content": user}],
        }
        if _supports_effort(m):
            kwargs["output_config"] = {"effort": self.effort}
        resp = self._client.messages.create(**kwargs)
        text = "".join(b.text for b in resp.content if b.type == "text")
        return text, self._usage(resp, m)

    @staticmethod
    def _usage(resp, model: str) -> Usage:
        u = resp.usage
        return Usage(
            model=model,
            input_tokens=getattr(u, "input_tokens", 0) or 0,
            output_tokens=getattr(u, "output_tokens", 0) or 0,
            cache_read=getattr(u, "cache_read_input_tokens", 0) or 0,
            cache_write=getattr(u, "cache_creation_input_tokens", 0) or 0,
        )


class FakeLLM:
    """Deterministic stand-in for tests. Records calls; returns canned output."""

    def __init__(
        self,
        synthesis: dict | None = None,
        overseer: dict | None = None,
        digest_text: str = "Daily digest.",
        model: str = "fake-model",
    ):
        self.synthesis = synthesis or {
            "current_state": "Holding steady.",
            "whats_next": "Confirm the next milestone.",
            "suggestions": ["Follow up with the vendor"],
        }
        self.overseer = overseer or {
            "summary": "Focus on the trip; everything else is steady.",
            "focus": ["Book flights"],
            "memory": "Trip is fixed for June.",
        }
        self.digest_text = digest_text
        self.model = model
        self.calls: list[tuple[str, str]] = []

    def _usage(self, user: str, out: str) -> Usage:
        return Usage(self.model, input_tokens=max(1, len(user) // 4), output_tokens=max(1, len(out) // 4))

    def complete_json(self, system, user, schema, *, model=None):
        self.calls.append(("json", user))
        props = (schema or {}).get("properties", {})
        data = dict(self.overseer) if "summary" in props else dict(self.synthesis)
        return data, self._usage(user, json.dumps(data))

    def complete_text(self, system, user, *, model=None):
        self.calls.append(("text", user))
        return self.digest_text, self._usage(user, self.digest_text)
