"""The overseer: the high-level layer above per-stream synthesis.

Where ``runner.synthesize_stream`` manages a single stream, the overseer sees all
streams at once and produces prioritization + cross-stream juggling. It keeps its
own durable state in ``overseer/status.md`` (the current prioritization snapshot)
and ``overseer/memory.md`` (durable cross-stream memory it carries forward), so it
has continuity from run to run.

It is read-mostly with respect to streams (it never mutates them) — surfacing
priorities, not deciding — consistent with the conservative posture.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..store import Store
from . import prompts
from .context import DEFAULT_BUDGET, build_overseer_context
from .llm import LLM, Usage
from .runner import log_usage, run_pass, should_process


@dataclass
class OverseerResult:
    summary: str
    focus: list[str] = field(default_factory=list)
    usage: Usage | None = None


def oversee(store: Store, llm: LLM, budget: int = DEFAULT_BUDGET) -> OverseerResult:
    slugs = [s.id for s in store.list_streams() if should_process(store, s)]
    context = build_overseer_context(
        store, slugs, store.read_overseer_status(), store.read_overseer_memory(), budget
    )
    data, usage = llm.complete_json(prompts.SYSTEM_OVERSEER, context, prompts.OVERSEER_SCHEMA)

    summary = str(data.get("summary", "")).strip()
    focus = [str(x).strip() for x in (data.get("focus") or []) if str(x).strip()]
    memory = str(data.get("memory", "")).strip()

    status_doc = summary
    if focus:
        status_doc += "\n\n## Focus\n" + "\n".join(f"- {f}" for f in focus)
    store.write_overseer_status(status_doc)
    store.write_overseer_memory(memory)  # git history is the safety net for pruning

    log_usage(store, "overseer", usage)
    return OverseerResult(summary=summary, focus=focus, usage=usage)


def run_cycle(store: Store, llm: LLM, budget: int = DEFAULT_BUDGET):
    """A full cycle: per-stream synthesis first, then the overseer over the fresh
    stream states. Returns (stream results, overseer result)."""
    stream_results = run_pass(store, llm, budget)
    overseer_result = oversee(store, llm, budget)
    return stream_results, overseer_result
