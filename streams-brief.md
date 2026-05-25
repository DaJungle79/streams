# Streams — Project Brief

> **Updated 2026-05-25.** Architecture refined after design review: Apple-surfaces-first (Apple Notes is the primary UI), single always-on daemon, two-way iMessage channel, and Streams as a container of four sub-object collections (goals, todos, events, notes). The MCP server / Claude-desktop surface is deferred from v1. See `docs/plan.md` for the build plan.

## Problem Statement
Operating multiple parallel ventures and initiatives (companies, software projects, management streams, exploratory bets) currently fails across four dimensions simultaneously: commitments fall through the cracks, context-switching between ventures destroys working state, no single timeline exists to reconstruct what happened in a project, and the system is reactive rather than proactive. The user has been trying to solve this with scattered tools — Notion, Obsidian, paper notebooks, e-ink note-takers, custom spreadsheets — and none of them combine durable storage, cross-venture synthesis, and autonomous orchestration in one place.

## Product Goal
A headless personal operating system for parallel ventures, where an AI agent autonomously organizes commitments, surfaces priorities, and maintains an auditable timeline across 10–20 active streams — accessed entirely through existing Apple surfaces (Apple Notes, Apple Reminders, iMessage) plus a terminal CLI, with zero dedicated UI.

## Product Description
Streams is a single always-on daemon plus a git-backed markdown store, running on a Mac mini. Each Stream is a folder in a git repository and is modeled as a container of four sub-object collections — **goals, todos, events, and notes** — plus metadata (title, weight/state).

**Apple Notes is the primary UI.** Each stream maps to exactly one Apple Note (1 note ↔ 1 stream). The daemon renders the note as a compiled, hybrid-structured view of the stream: current goals, open todos (as native checklists), the latest few events, and the agent's synthesis of current state and what's next. The user edits that note freely — adding or removing a todo, recording a thought, refining a goal — and the daemon reconciles those edits back into the markdown source of truth. Edits are detected by polling (Apple Notes has no change-event API).

The daemon wakes on a schedule (three passes a day, configurable) to refresh notes where needed and push priority todos to Apple Reminders as nudges; checking a reminder off flows the completion back. When the agent needs a decision, it asks via **iMessage** and reads the reply. Markdown-in-git is source of truth; every change is committed (revert = git); a nightly-rebuilt SQLite index powers fast cross-stream queries and is disposable.

## Target Users
**v1:** Single user — Ivo (CTO, multiple ventures, Bulgarian/English, Mac + iOS user, Claude power user, terminal-fluent). Usage frequency: daily (morning digest, ad-hoc captures, end-of-day reflection) plus weekly planning session.

**Future:** Founders, CTOs, and senior operators running parallel ventures or significant initiatives across multiple contexts. Productizable after v1 proves the model.

## Core Use Cases
1. **Morning digest** — Open the digest note (or a stream's note) and read the agent's overnight synthesis: top priorities, blockers, items needing decision, conflicts.
2. **Quick capture from phone** — Add a todo or thought directly in a stream's Apple Note (or create a Reminder the agent picks up); Streams ingests it into the right stream.
3. **End-of-day reflection** — Edit notes / run a CLI pass to log the day's decisions and events to the relevant streams.
4. **Weekly planning** — Agent proposes the upcoming week (priorities, focus areas, anticipated conflicts) in the digest; user edits in the note.
5. **Ad-hoc status check** — When context-switching, open a stream's note for synthesized current state, or query via CLI.
6. **Next-step proposals** — Agent proposes concrete next actions per stream (in the note's agent zone, marked) based on goals, current events, and outstanding todos.
7. **Cross-stream queries** — "What did I commit to this week?", "What's blocked on someone else?", "What conflicts with the Bali trip?" via CLI.
8. **Agent asks, user answers** — Agent sends a clarifying question over iMessage; the user's reply routes back into the relevant stream.

## Functional Requirements
1. **Stream CRUD.** Create, read, update, archive streams. Each stream is a container of four sub-object collections — **goals, todos, events, notes** — plus metadata: title, weight, and state (`active` / `maintenance` / `dormant`).
2. **Goals (sub-object).** Create, update, and mark goals `achieved` / `dropped` per stream. Each goal has id, text, status, created date, optional target date, and provenance (`user` / `agent`).
3. **Events (sub-object).** Append events with timestamp, source (`manual` / `agent` / `sync`), type (`event` / `decision` / `agent-note`), and free-form content. Append-only; sharded by month.
4. **Todos (sub-object).** Create, complete, defer, archive. Each todo has stream association, status, optional due date, and provenance (`user` / `agent` / `reminders-sync`).
5. **Notes (sub-object).** Free-form long-form notes per stream.
6. **Apple Notes as primary UI (two-way).** One note per stream. Daemon renders a hybrid note: a deterministically-parsed structured skeleton (goals, todos as checklists, recent events read-only) plus a free-form Notes/Thoughts region interpreted by the LLM. User edits reconcile back to markdown. **Zone separation:** user-owned zones (todos, free notes, goals) are never overwritten by the agent; the agent only rewrites its own zones (current state, what's next, suggestions).
7. **Apple Reminders (push + completion-back).** Agent pushes select todos to Reminders as nudges; completing a reminder marks the corresponding todo done. No general capture of arbitrary new reminders in v1.
8. **iMessage (two-way channel).** Agent sends clarifying questions and nudges via iMessage and reads replies (chat.db poll) as answers/commands, using a pending-question state machine so a reply maps to the question asked. Degrades to outbound-only / in-note questions if chat.db is unreadable.
9. **Daemon.** Always-on process: scheduled passes (3×/day, configurable) refresh notes where needed and push reminders; poll loops detect note edits, reminder completions, and inbound iMessage.
10. **Agent passes.** Conservative posture ("surface, don't decide" until noise is measured). Reads relevant streams, proposes prioritization, drafts the digest, logs all actions as `agent-note` events with full reasoning trail. Hard token budget per call.
11. **Agent-item markers.** Agent-created items (todos, suggestions) are visually distinguishable from user-created items in the note, allowing low-friction acknowledgment — the noise-control mechanism for the #1 risk.
12. **CLI.** Terminal-native admin/power tool over the same internal core API the daemon uses: stream CRUD, goal/event/todo ops, force a pass, cross-stream queries, revert.
13. **Cross-stream query layer.** Agent and user can ask questions spanning all streams; answers cite source events/todos.
14. **Memory/context optimizer.** Recency-weighted retrieval, monthly event log compaction, semantic search over notes, hard token budget per agent call.
15. **Audit trail.** Every agent write produces an `agent-note` event; every change is a git commit. User can review and revert.
16. **State/weight prioritization.** Dormant streams excluded from the daily digest; maintenance streams surface only when something material changes.

## Non-Functional Requirements
- **Source of truth:** Markdown files in a git repository. Every change is committed. Repo is portable.
- **Hosting:** Single daemon process running on an always-on Mac mini at home. No cloud dependency for core functionality (Claude API calls excepted).
- **Backup/restore:** Git push to a private remote. Restore = git clone.
- **Audit trail:** Every agent write produces an `agent-note` event with prompt context, action taken, and reasoning. User can revert any agent change via git.
- **Memory discipline:** No agent call may exceed a configurable token budget. Context assembled via retrieval, not bulk load.
- **Boundary cleanliness:** Single-user assumptions (iMessage number, Notes account, repo path) confined to one thin config layer; data model and agent logic stream-scoped so multi-tenancy is a deployment concern, not a refactor.
- **Apple sync resilience:** Apple Notes is the primary surface and the highest-stakes integration. If two-way Notes sync fails, the system falls back to one-way (write-only) without data loss. iMessage degrades to outbound-only. Sync health is surfaced in the morning digest.
- **Language:** Python.

## Out of Scope (v1)
- **MCP server / Claude-desktop & mobile surface** (deferred — the core stays surface-agnostic so this is a thin add later, not a rewrite).
- Gmail and Google Calendar event ingestion (deferred — manual events only).
- Generic webhook ingestion (deferred).
- Stream hierarchy / nesting (flat list only).
- Full agent review queue with confidence thresholds (replaced by minimal agent-item marker per FR-11).
- Web UI / dashboard.
- General capture of arbitrary new Apple Reminders into streams (v1 Reminders is push + completion-back only).
- Multi-user, sharing, collaboration features.
- Native mobile app (Apple Notes + Reminders + iMessage is the mobile surface).
- Voice capture.
- Separate Decision log entity (decisions are events with `type: decision` in v1).
- Local LLM execution (Claude only in v1; DGX Spark / local model offload is a v2 concern).

## Technical Constraints & Dependencies
- **Stack:** Python 3.12+, Claude Code as primary build tool. `uv` for environment/dependencies.
- **Storage:** Markdown files in a git repo on the Mac mini. Per-stream folder with `stream.md` (metadata), `goals.md`, `todos.md`, `notes.md`, and append-only monthly event logs (`streams/<slug>/events/YYYY-MM.md`). Nightly SQLite index rebuilt from markdown for fast cross-stream queries; SQLite is disposable.
- **Host:** Always-on Mac mini (M1 currently; M5 Pro consideration is independent of this product).
- **LLM:** Claude API for all agent reasoning in v1, with prompt caching. Model selectable per pass type (cheaper for routine refresh, stronger for synthesis). Architecture must allow swapping a local model for routine passes later without rewiring the agent.
- **Apple access (all-Python where possible):** EventKit via **pyobjc** for Reminders; AppleScript/JXA (or ScriptingBridge) for Notes; direct read of the Messages `chat.db` SQLite for inbound iMessage plus AppleScript for sending. Requires macOS **Automation**, **Reminders**, and **Full Disk Access** (chat.db) permissions.
- **Apple Notes sync:** Primary UI, two-way. **Known fragility** — must include a one-way write-only fallback and a health-check that surfaces sync failures into the morning digest.
- **Daemon:** Single always-on process, supervised by `launchd` (keepalive/restart). Internal scheduler for the 3×/day passes and the poll cadences.
- **CLI:** Thin wrapper over the same internal core API the daemon uses.

## Key Risks & Open Questions
1. **Note round-trip correctness (highest risk).** Apple Notes is both the rendered output and the editable input. Regeneration must never clobber user edits; reconciliation must reliably extract user intent. Zone separation (FR-6) and deterministic handling of structured edits are the mitigation; the free-form region uses the LLM and is the main place misreads (= noise) can occur. Spike before building.
2. **Agent noise → trust collapse.** If the digest/synthesis is noisy or wrong twice in a row, the user stops reading it. FR-11 (visual marker on agent-created items) is the minimum; conservative "surface, don't decide" prompt for the first 7 days; honest noise evaluation before increasing autonomy.
3. **iMessage two-way fragility.** Reading `chat.db` requires Full Disk Access and is sensitive to macOS/Messages changes. Mitigation: outbound-only fallback, health surfaced in digest. Spike before building.
4. **Memory/context degradation as data grows.** Cross-stream queries over months of history need real engineering: monthly event log files, SQLite index, recency-weighted retrieval, compaction. Designed on day one, not after data accumulates.
5. **Timeline realism.** Notes is now the centerpiece, not a deferred feature — the round-trip is the bulk of the work. Estimate accordingly.
6. **Cost of daily Claude passes.** Measure early. Establish a cost budget per agent pass in week 1; log to a `streams.meta` stream.
7. **Multi-tenancy boundary discipline.** Single-user assumptions (iMessage number, Notes account, repo path) kept in one thin config layer.

## Go/No-Go Verdict
**Verdict:** Go

**Reasoning:** The problem is validated by the user's own multi-tool, multi-medium attempts to solve it. The refined architecture (markdown-in-git + Mac mini daemon + Claude via API + Apple Notes/Reminders/iMessage) is coherent, minimal, and matches the user's existing infrastructure and habits — using surfaces the user already lives in rather than introducing a new app. Scope is honest about deferrals (MCP, Calendar/Gmail, multi-user). The user is both the builder and the only v1 user, eliminating feedback-loop friction. The product is buildable in evenings with Claude Code, useful from day one, and productizable later without rewrite if boundaries are kept clean. The dominant risks — note round-trip correctness and agent noise — are addressable with zone separation, deterministic structured edits, and the FR-11 marker pattern.

**Conditions:** None blocking, but design discipline conditions worth respecting during build:
- Spike the Apple Notes round-trip and the iMessage `chat.db` read before building the domain around them.
- Do not skip FR-11 (agent-item markers) under time pressure; it is the noise-control mechanism for the agent-noise risk.
- Do not hand-wave memory/context management; design the monthly-event-log + SQLite-index structure on day one, not after data accumulates.
- Keep the core surface-agnostic so the deferred MCP surface is a thin add, not a refactor.

## Suggested Next Steps
See `docs/plan.md` for the full phased build plan. In short: (0) scaffold + spike Notes round-trip, iMessage read, and Reminders; (1) core domain + markdown store + git + CLI; (2) note render + reconcile loop; (3) conservative agent layer with cost instrumentation; (4) Reminders push + completion-back; (5) iMessage two-way; (6) hardening + launchd ops.
