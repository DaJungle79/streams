"""Agent passes: per-stream synthesis, cross-stream digest, and cost logging.

Every pass writes the synthesis to ``agent.md`` (rendered into the note's agent
zone), adds at most a few marked (FR-11) suggestions as agent todos, logs an
``agent-note`` event for the audit trail, and records token/cost usage to the
``meta`` stream. Conservative by design — dormant streams are skipped, and
maintenance streams are processed only when something material has changed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core import EventSource, EventType, Provenance, Stream, StreamState
from ..store import Store, StreamNotFound
from . import prompts
from .context import DEFAULT_BUDGET, build_digest_context, build_stream_context
from .llm import LLM, Usage

META_SLUG = "meta"
MAX_SUGGESTIONS = 3


@dataclass
class SynthesisResult:
    slug: str
    suggestions_added: list[str] = field(default_factory=list)
    usage: Usage | None = None


# --- meta stream (cost/usage ledger) ---------------------------------------


def ensure_meta(store: Store) -> None:
    try:
        store.read_stream(META_SLUG)
    except StreamNotFound:
        store.create_stream("meta", state=StreamState.dormant)


def log_usage(store: Store, slug: str, usage: Usage) -> None:
    ensure_meta(store)
    store.append_event(
        META_SLUG,
        f"{slug}: model={usage.model} in={usage.input_tokens} out={usage.output_tokens} "
        f"cache_read={usage.cache_read} cost=${usage.cost_usd:.4f}",
        type=EventType.agent_note,
        source=EventSource.agent,
    )


# --- per-stream synthesis ---------------------------------------------------


def synthesize_stream(store: Store, llm: LLM, slug: str, budget: int = DEFAULT_BUDGET) -> SynthesisResult:
    context = build_stream_context(store, slug, budget)
    data, usage = llm.complete_json(prompts.SYSTEM_SYNTH, context, prompts.SYNTH_SCHEMA)

    current_state = str(data.get("current_state", "")).strip()
    whats_next = str(data.get("whats_next", "")).strip()
    store.write_agent(slug, f"Current state — {current_state}\n\nNext — {whats_next}")

    added = _apply_suggestions(store, slug, data.get("suggestions", []))

    note = "Synthesis pass: refreshed state/next"
    note += f", added {len(added)} suggestion(s)." if added else "; no new suggestions."
    store.append_event(slug, note, type=EventType.agent_note, source=EventSource.agent)
    log_usage(store, slug, usage)

    return SynthesisResult(slug=slug, suggestions_added=added, usage=usage)


def _apply_suggestions(store: Store, slug: str, suggestions) -> list[str]:
    """Add up to MAX_SUGGESTIONS new agent todos, deduped against existing ones."""
    existing = {t.text.strip().lower() for t in store.list_todos(slug) if t.status.value != "archived"}
    added: list[str] = []
    for raw in suggestions or []:
        text = str(raw).strip()
        if not text or text.lower() in existing:
            continue
        store.add_todo(slug, text, src=Provenance.agent)
        existing.add(text.lower())
        added.append(text)
        if len(added) >= MAX_SUGGESTIONS:
            break
    return added


# --- full pass over all streams --------------------------------------------


def _has_material_change(store: Store, slug: str) -> bool:
    """True if a non-agent event arrived since the last agent pass."""
    events = store.list_events(slug)
    last_agent = max(
        (e.timestamp for e in events if e.type is EventType.agent_note and e.source is EventSource.agent),
        default=None,
    )
    if last_agent is None:
        return bool(events)
    return any(e.timestamp > last_agent and e.source is not EventSource.agent for e in events)


def should_process(store: Store, stream: Stream) -> bool:
    if stream.id == META_SLUG or stream.state is StreamState.dormant:
        return False
    if stream.state is StreamState.active:
        return True
    return _has_material_change(store, stream.id)  # maintenance


def run_pass(store: Store, llm: LLM, budget: int = DEFAULT_BUDGET) -> list[SynthesisResult]:
    return [
        synthesize_stream(store, llm, s.id, budget)
        for s in store.list_streams()
        if should_process(store, s)
    ]


# --- cross-stream digest ----------------------------------------------------


def daily_digest(store: Store, llm: LLM, budget: int = DEFAULT_BUDGET) -> tuple[str, Usage]:
    slugs = [s.id for s in store.list_streams() if should_process(store, s)]
    context = build_digest_context(store, slugs, budget)
    text, usage = llm.complete_text(prompts.SYSTEM_DIGEST, context)

    ensure_meta(store)
    store.write_agent(META_SLUG, text)
    log_usage(store, "digest", usage)
    return text, usage
