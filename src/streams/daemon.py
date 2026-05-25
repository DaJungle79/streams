"""The always-on daemon: scheduled passes + a poll loop, plus launchd glue.

The orchestration is split into small, testable units — ``run_poll_tick`` (the
frequent ingest/reconcile), ``run_scheduled_pass`` (ingest → think → project, a
few times a day), and ``health_check`` — each taking a ``Deps`` bundle so tests
drive them with fakes. ``run_forever`` is the thin loop launchd keeps alive; it
catches per-tick errors so one failure never kills the daemon.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime

from .agent.context import DEFAULT_BUDGET
from .agent.llm import LLM
from .agent.overseer import run_cycle
from .agent.runner import ensure_meta, should_process, synthesize_stream
from .core import EventSource, EventType
from .messages import MessagesBridge, poll_inbound, send
from .notes_bridge import NotesBridge
from .reminders import RemindersBridge, sync_all_reminders
from .store import Store, StreamNotFound
from .sync import capture_tagged, sync_stream

META_SLUG = "meta"


@dataclass
class Deps:
    llm: LLM
    notes: NotesBridge
    reminders: RemindersBridge
    messages: MessagesBridge | None = None
    note_tag: str = "#stream"
    reminders_list: str | None = None
    agent_name: str = "Streams"
    budget: int = DEFAULT_BUDGET


def _syncable(store: Store):
    return [s for s in store.list_streams() if s.id != META_SLUG]


# --- daemon state (daemon/state.json, committed) ----------------------------
# Two pieces of cross-tick memory: which scheduled passes already fired today
# (so a restart doesn't re-run them) and the last digest we sent (so an
# unchanged summary isn't re-sent every pass).


def _state_path(store: Store):
    return store.repo / "daemon" / "state.json"


def _load_state(store: Store) -> dict:
    path = _state_path(store)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _save_state(store: Store, state: dict) -> None:
    path = _state_path(store)
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    store.commit("update daemon state", [path])


# --- the two units of work --------------------------------------------------


def run_poll_tick(store: Store, deps: Deps, synthesize: bool = True) -> dict:
    """Frequent ingest: capture new tagged notes, reconcile note edits, pull
    reminder completions, and route inbound iMessage replies. A stream whose note
    just changed (or was just captured) is synthesized immediately so newly
    surfaced information is processed without waiting for the next scheduled
    pass; the refreshed synthesis is then projected back into the note.

    ``synthesize=False`` does ingest only — used by the scheduled pass, which runs
    a full ``run_cycle`` right after and would otherwise synthesize twice."""
    summary: dict = {"captured": [], "notes_synced": 0, "synthesized": [], "archived": []}
    summary["captured"] = capture_tagged(store, deps.notes, deps.note_tag)
    dirty: set[str] = set(summary["captured"])
    for stream in _syncable(store):
        result = sync_stream(store, deps.notes, stream.id, tag=deps.note_tag)
        if result.archived:
            summary["archived"].append(stream.id)  # note was deleted -> stream archived
        elif result.created or result.changes:
            summary["notes_synced"] += 1
            dirty.add(stream.id)

    if synthesize:
        for slug in sorted(dirty):
            try:
                stream = store.read_stream(slug)
            except StreamNotFound:
                continue
            if not should_process(store, stream):
                continue
            synthesize_stream(store, deps.llm, slug, deps.budget)
            sync_stream(store, deps.notes, slug, tag=deps.note_tag)  # project synthesis back
            summary["synthesized"].append(slug)

    summary["reminders"] = sync_all_reminders(store, deps.reminders, deps.reminders_list)
    if deps.messages is not None:
        summary["imessage"] = poll_inbound(store, deps.messages)
    return summary


def run_scheduled_pass(store: Store, deps: Deps) -> dict:
    """A full pass: ingest latest input, run the two-layer agent, project the
    refreshed synthesis back to notes, nudge the digest, and record health."""
    tick = run_poll_tick(store, deps, synthesize=False)  # run_cycle below synthesizes
    stream_results, overseer = run_cycle(store, deps.llm, deps.budget)

    # project the refreshed agent synthesis back into the notes
    for stream in _syncable(store):
        sync_stream(store, deps.notes, stream.id, tag=deps.note_tag)

    # push due todos the agent may have surfaced
    sync_all_reminders(store, deps.reminders, deps.reminders_list)

    # nudge the digest only when it actually changed — the overseer returns a
    # summary every pass, so an unconditional send is one message per pass.
    if deps.messages is not None and overseer.summary:
        state = _load_state(store)
        if overseer.summary != state.get("last_digest"):
            send(store, deps.messages, overseer.summary, signature=deps.agent_name)
            state["last_digest"] = overseer.summary
            _save_state(store, state)

    health = health_check(store, deps)
    _log_pass(store, len(stream_results), health)
    return {
        "tick": tick,
        "streams": len(stream_results),
        "overseer": overseer.summary,
        "health": health,
    }


# --- health -----------------------------------------------------------------


def _probe(fn) -> str | None:
    try:
        fn()
        return None
    except Exception as exc:  # noqa: BLE001 — surface any failure as a status string
        return str(exc)


def health_check(store: Store, deps: Deps) -> dict[str, str | None]:
    """Cheap probe of each integration. None = ok, str = error message."""
    status: dict[str, str | None] = {
        "notes": _probe(lambda: deps.notes.find_notes_with_tag(deps.note_tag)),
        "reminders": _probe(lambda: deps.reminders.is_completed("__healthcheck__")),
    }
    if deps.messages is not None:
        status["imessage"] = _probe(deps.messages.latest_rowid)
    return status


def _log_pass(store: Store, n_streams: int, health: dict[str, str | None]) -> None:
    ensure_meta(store)
    unhealthy = [k for k, v in health.items() if v]
    health_str = "ok" if not unhealthy else "ISSUES: " + ", ".join(unhealthy)
    store.append_event(
        META_SLUG,
        f"scheduled pass: {n_streams} streams synthesized; health: {health_str}",
        type=EventType.agent_note,
        source=EventSource.agent,
    )


# --- the loop (thin glue, not unit-tested) ----------------------------------


def run_forever(
    store: Store,
    deps: Deps,
    pass_times: tuple[str, ...],
    poll_interval: int,
    logger: logging.Logger | None = None,
) -> None:  # pragma: no cover — the loop itself isn't unit-tested
    log = logger or logging.getLogger("streams.daemon")
    # Seed from now so a (re)start never retro-fires passes already in the past;
    # a pass fires only when the running clock *crosses* its time. Marks already
    # recorded for today are reloaded each tick so a restart can't re-fire them.
    last_hm = datetime.now().strftime("%H:%M")
    log.info("daemon started (passes at %s, poll every %ss)", ", ".join(pass_times), poll_interval)
    while True:
        try:
            now = datetime.now()
            today = now.date().isoformat()
            now_hm = now.strftime("%H:%M")
            state = _load_state(store)
            done = set(state.get("passes_done", [])) if state.get("schedule_date") == today else set()
            for t in pass_times:
                if t not in done and last_hm < t <= now_hm:  # clock crossed t
                    log.info("scheduled pass for %s", t)
                    run_scheduled_pass(store, deps)
                    done.add(t)
                    state = _load_state(store)  # re-read: the pass may have written last_digest
                    state["schedule_date"] = today
                    state["passes_done"] = sorted(done)
                    _save_state(store, state)
            last_hm = now_hm
            run_poll_tick(store, deps)
        except Exception:  # noqa: BLE001 — never let one tick kill the daemon
            log.exception("daemon tick failed")
        time.sleep(poll_interval)


# --- launchd ----------------------------------------------------------------


def launchd_plist(label: str, program_args: list[str], working_dir: str, log_path: str) -> str:
    args = "".join(f"        <string>{a}</string>\n" for a in program_args)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
        "<dict>\n"
        f"    <key>Label</key><string>{label}</string>\n"
        "    <key>ProgramArguments</key>\n"
        f"    <array>\n{args}    </array>\n"
        f"    <key>WorkingDirectory</key><string>{working_dir}</string>\n"
        "    <key>RunAtLoad</key><true/>\n"
        "    <key>KeepAlive</key><true/>\n"
        f"    <key>StandardOutPath</key><string>{log_path}</string>\n"
        f"    <key>StandardErrorPath</key><string>{log_path}</string>\n"
        "</dict>\n"
        "</plist>\n"
    )


def build_deps(cfg) -> Deps:
    """Construct real bridges + LLM from config (lazy imports; needs a Mac + key)."""
    from .agent.llm import AnthropicLLM
    from .messages import AppleMessages
    from .notes_bridge import AppleNotesBridge
    from .reminders import EventKitReminders

    return Deps(
        llm=AnthropicLLM(cfg.model_synthesis, api_key=cfg.anthropic_api_key or None),
        notes=AppleNotesBridge(account=cfg.notes_account),
        reminders=EventKitReminders(list_name=cfg.reminders_list or None),
        messages=AppleMessages(cfg.imessage_handle) if cfg.imessage_handle else None,
        note_tag=cfg.note_tag,
        reminders_list=cfg.reminders_list or None,
        agent_name=cfg.agent_name,
        budget=cfg.token_budget,
    )
