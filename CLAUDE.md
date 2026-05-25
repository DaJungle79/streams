# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 0–6 of `docs/plan.md` are implemented (112 tests). The full pipeline exists: core store, note render/reconcile, capture, two-layer agent, Reminders, iMessage, and the daemon. Background on intent: `streams-brief.md` (scope) and `docs/plan.md` (sequencing); `docs/ops.md` for running it.

### Commands

```sh
uv sync                  # base + dev (pytest); add --group apple for the pyobjc bridges
uv run pytest            # full suite (no Mac/API key needed — Apple + LLM are faked)
uv run pytest tests/test_reconcile.py -k check   # a single test
uv run streams --help    # CLI: stream/goal/todo/event/note/query/sync/capture/
                         #      reminders/imessage/agent/daemon/report/health/backup/setup
```

Tests use fakes for every external surface (`FakeLLM`, `FakeNotesBridge`, `FakeReminders`, `FakeMessages`), so the whole suite runs without a Mac, permissions, or an API key. The real bridges (`Apple*`, `EventKit*`, `AnthropicLLM`) are validated on-device; treat anything touching osascript/EventKit/chat.db/Claude as untested-in-CI.

## What Streams is

A headless personal operating system for running 10–20 parallel ventures, accessed entirely through **existing Apple surfaces (Apple Notes, Apple Reminders, iMessage) plus a terminal CLI** — zero dedicated UI. A single always-on daemon on a Mac mini renders each stream into an Apple Note, reconciles the user's edits back, runs scheduled agent passes for synthesis, and maintains an auditable git timeline. Single-user (v1).

## Architecture

A single **always-on daemon**; markdown-in-git is the source of truth; **Apple Notes is the primary UI** (one note ↔ one stream, both rendered output and editable input). Load-bearing decisions:

- **A Stream is a folder = metadata + four sub-object collections: goals, todos, events, notes.** Layout: `streams/<slug>/` with `stream.md` (frontmatter: id, title, state, weight, note_id, created), `goals.md`, `todos.md`, `notes.md`, and `events/YYYY-MM.md` (append-only, monthly-sharded). Goals are a first-class collection, not a frontmatter field.
- **Markdown-in-git is authoritative.** Every change is committed (authored by the configured `agent_name`, so `git log` shows who signed each edit); revert = git, restore = git clone. Keep the repo portable. All store commits go through `Store.commit`.
- **Agent identity.** `config.agent_name` signs outbound iMessages and authors git commits. (A setup procedure will prompt for it, the API key, and handle later.)
- **SQLite is a disposable index**, rebuilt nightly from markdown for cross-stream queries + recency retrieval. Never authoritative.
- **Layered core, surface-agnostic:** `core` (domain) → `store` (markdown/git) → `index` (sqlite) → `notes` (render/reconcile) → `apple` (bridges) → `agent` (Claude loop) → `daemon` (scheduler/poll) / `cli`. Each layer depends only on inner ones. The CLI and (future) MCP must call the shared core, never duplicate logic.
- **The note round-trip is the make-or-break component.** A note is both rendered output and editable input, with **delimited zones**: user-owned (goals, todo checklist, free *Notes/Thoughts*), agent-owned (current state, what's next, suggestions), read-only (recent events). Reconcile rule: **user edits always win and reconcile first; the agent only rewrites its own zones.** Structured edits (checkbox/add/remove/goal) are handled deterministically via the `.render/<slug>.json` manifest; the free-form region uses the LLM.
- **Note identity & capture.** A stream's note is identified by `note_id` (stored in `stream.md`), set when the note is created — that mapping, not the tag, is the source of truth for which note is which. A configurable hashtag (`note_tag`, default `#stream`) is rendered into every managed note and used for **discovery**: `sync.capture_tagged` finds tagged notes whose id we don't track and adopts them into new streams (user creates a `#stream` note → it becomes a stream). The note is created lazily by `sync_stream` on first sync (keeping the store Apple-free); `stream create --note` opts into immediate creation.
- **No change-events from Apple** — the daemon **polls** Notes, Reminders (completion), and iMessage (`chat.db`).
- **Daemon, `streams.daemon`.** `run_poll_tick` (frequent: capture + reconcile note edits + reminder completions + iMessage replies; a stream whose note just changed or was just captured is synthesized immediately and projected back, so new info is processed without waiting for the next pass — `synthesize=False` skips this for the scheduled pass, which runs `run_cycle` itself) and `run_scheduled_pass` (ingest → two-layer agent → project synthesis back to notes → nudge digest → health), both taking a `Deps` bundle so tests drive them with fakes. `run_forever` is the thin launchd-kept loop (catches per-tick errors); on startup it runs one full pass regardless of schedule (`pass_on_start`, default true) so a restart/reboot refreshes the overseer report immediately. `health_check` probes each bridge; `streams.report` aggregates the `meta` cost/noise ledger; `streams setup` writes `config.yaml`. See `docs/ops.md`.
- **Apple bridges, all-Python where possible:** pyobjc/EventKit for Reminders; AppleScript/JXA for Notes; `chat.db` SQLite read + AppleScript send for iMessage. Put bridges behind interfaces so core/agent test with fakes (no Mac in CI). Needs macOS Automation, Reminders, and **Full Disk Access** (chat.db) permissions.
- **Reminders (push + completion-back), `streams.reminders`.** Push open, due-dated todos as nudges (mapping via `Todo.reminder_id`); checking a reminder off completes the todo; a todo completed elsewhere completes its reminder. Not general capture. `EventKitReminders` (real) + `FakeReminders` (tests).
- **iMessage (two-way), `streams.messages`.** `ask` sends a question and records it pending (anchoring a chat.db cursor so the reply isn't missed); `poll_inbound` routes each reply to the oldest open question (FIFO) → logs it to that stream as a `sync` event; unrouted replies go to `meta`. State in `messages/state.json` (committed). `AppleMessages` (osascript send + chat.db read, FDA required; best-effort `attributedBody` decode) + `FakeMessages` (tests).
- **LLM:** Claude API with prompt caching; model selectable per pass type. Keep the agent decoupled from the model (the `LLM` protocol: `AnthropicLLM` + `FakeLLM`) so a local model can take over routine passes later.
- **Two-layer agent.** Stream level (`agent.runner.synthesize_stream`) manages one stream → its `agent.md` synthesis + marked suggestions. Overseer level (`agent.overseer`) sits above all streams for prioritization/juggling and keeps durable `overseer/status.md` + `overseer/memory.md` it carries forward each run. `run_cycle` = stream passes → overseer. Both are read-mostly and conservative; usage/cost logged to the dormant `meta` stream.

## Non-negotiable constraints

From the brief's risk analysis and Go conditions — respect even under time pressure:

- **Spike before building the fragile bits.** Apple Notes round-trip (S1) and iMessage `chat.db` read (S2) get go/no-go spikes in Phase 0, before the domain is built around them.
- **FR-11 — agent-item markers are not optional.** Agent-created todos/suggestions must be visually distinct in the note (e.g. 🤖). Primary control for the agent-noise → trust-collapse risk.
- **Conservative agent first.** "Surface, don't decide" prompt; measure noise for 7 days before adding autonomy.
- **Token budget per agent call is hard-capped** (configurable). Assemble context via recency-weighted *retrieval*, never bulk-load. Plan monthly event-log compaction + semantic search over notes.
- **Stream weight/state drives prioritization:** `dormant` excluded from the daily digest; `maintenance` surfaces only on material change.
- **Provenance everywhere.** Events: source (`manual`/`agent`/`sync`) + type (`event`/`decision`/`agent-note`). Todos: provenance (`user`/`agent`/`reminders-sync`). Goals: provenance (`user`/`agent`). Decisions are events with `type: decision` — no separate decision entity in v1.
- **Apple sync resilience.** Notes two-way falls back to one-way write-only without data loss; iMessage falls back to outbound-only. Surface sync health in the morning digest. A managed note found deleted (Recently Deleted / purged) raises `NoteGone` from the bridge; `sync_stream` then archives the stream to `archive/` (markdown preserved, recoverable via git) rather than crashing — deleting a note is the de-facto "retire this stream" gesture.
- **Multi-tenancy boundary discipline.** Confine single-user identity (iMessage number, Notes account, repo path) to `config.yaml`. Keep data model and agent logic stream-scoped; never bake single-user assumptions into file paths or prompts.

## Stack

- Python 3.12+, `uv` for env/deps. macOS-only host (Mac mini, M1).
- `launchd` supervises the daemon; an internal scheduler runs the 3×/day passes and poll cadences.
- anthropic SDK (prompt caching); git via subprocess; SQLite stdlib.

## Out of scope for v1 (don't build these)

MCP server / Claude-desktop surface (deferred — keep core surface-agnostic so it's a thin add later), Gmail/Calendar ingestion, generic webhooks, stream nesting/hierarchy, full agent review queue with confidence thresholds, web UI/dashboard, general capture of arbitrary new Reminders (v1 Reminders is push + completion-back only), multi-user/sharing, native mobile app, voice capture, separate decision-log entity, local LLM execution.
