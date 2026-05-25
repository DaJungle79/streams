# Streams — Project Brief

## Problem Statement
Operating multiple parallel ventures and initiatives (companies, software projects, management streams, exploratory bets) currently fails across four dimensions simultaneously: commitments fall through the cracks, context-switching between ventures destroys working state, no single timeline exists to reconstruct what happened in a project, and the system is reactive rather than proactive. The user has been trying to solve this with scattered tools — Notion, Obsidian, paper notebooks, e-ink note-takers, custom spreadsheets — and none of them combine durable storage, cross-venture synthesis, and autonomous orchestration in one place.

## Product Goal
A headless personal operating system for parallel ventures, where an AI agent autonomously organizes commitments, surfaces priorities, and maintains an auditable timeline across 10–20 active streams — accessed entirely through existing surfaces (Claude mobile/desktop, terminal, Apple Reminders, Apple Notes) with zero dedicated UI.

## Product Description
Streams is an MCP server plus sync layer running on an always-on Mac mini. Each Stream is a markdown file (or folder) in a git repository containing a goal, TODO list, append-only event log, and free-form notes. An agent runs scheduled passes morning and evening, plus on-demand invocations through Claude or CLI, to organize items, propose next steps based on goals/events/TODOs, prioritize across streams, and surface what matters. Every agent action is logged to the relevant stream's event timeline, leaving an auditable trail. Apple Reminders provides two-way sync for TODOs and nudges; Apple Notes provides two-way sync for notes and summaries. Markdown-in-git is source of truth; a nightly-rebuilt SQLite index powers fast cross-stream queries.

## Target Users
**v1:** Single user — Ivo (CTO, multiple ventures, Bulgarian/English, Mac + iOS user, Claude power user, terminal-fluent). Usage frequency: daily (morning digest, ad-hoc captures, end-of-day reflection) plus weekly planning session.

**Future:** Founders, CTOs, and senior operators running parallel ventures or significant initiatives across multiple contexts. Productizable after v1 proves the model.

## Core Use Cases
1. **Morning digest** — Ask Claude "what's on my plate today" and read the agent's overnight synthesis: top priorities, blockers, items needing decision, conflicts.
2. **Quick capture from phone** — Add a TODO or note via Apple Reminders/Notes; Streams ingests it into the right stream.
3. **End-of-day reflection** — Run a Claude pass to log the day's decisions and events to the relevant streams.
4. **Weekly planning** — Agent proposes the upcoming week (priorities, focus areas, anticipated conflicts); user edits.
5. **Ad-hoc status check** — When context-switching, ask "what's the status of [stream]" and get a synthesized current state.
6. **Next-step proposals** — Agent proposes concrete next actions per stream based on goals, current events, and outstanding TODOs.
7. **Cross-stream queries** — "What did I commit to this week?", "What's blocked on someone else?", "What conflicts with the Bali trip?"

## Functional Requirements
1. Create, read, update, archive streams. Each stream has: goal(s), TODO list, append-only event log, notes, weight/state (active / maintenance / dormant).
2. Append events to a stream with timestamp, source (manual / agent / sync), type (event / decision / agent-note), and free-form content.
3. Manage TODOs per stream: create, complete, defer, archive. Each TODO has stream association, status, optional due date, and provenance (user / agent / Apple Reminders sync).
4. Two-way sync with Apple Reminders: TODOs in Streams appear as Reminders; completions and new captures from Reminders sync back.
5. Two-way sync with Apple Notes: Streams writes synthesis notes per stream; Streams reads notes tagged for a stream and ingests them.
6. Scheduled agent passes (morning and evening, configurable): the agent reads relevant streams, proposes prioritization, drafts the digest, logs all actions as `agent-note` events with full reasoning trail.
7. On-demand agent invocation via MCP from Claude and via CLI from terminal, returning synthesis or proposals on request.
8. Cross-stream query layer: agent and user can ask questions spanning all streams; answers cite source events/TODOs.
9. Memory/context optimizer: recency-weighted retrieval, monthly event log compaction, semantic search over notes, hard token budget per agent call.
10. Audit trail: every agent action appears as an event in the affected stream(s); user can review and revert.
11. Agent-created items are visually distinguishable (e.g., flag/marker) from user-created items, allowing low-friction acknowledgment — a minimal version of the deferred review-queue concept, mandated by the noise-control risk.
12. Stream weight/state affects agent prioritization: dormant streams are excluded from the daily digest; maintenance streams surface only when something material changes.

## Non-Functional Requirements
- **Source of truth:** Markdown files in a git repository. Every change is committed. Repo is portable.
- **Hosting:** Single process running on always-on Mac mini at home. No cloud dependency for core functionality (Claude API calls excepted).
- **Backup/restore:** Git push to a private remote. Restore = git clone.
- **Audit trail:** Every agent write produces an `agent-note` event with prompt context, action taken, and reasoning. User can revert any agent change via git.
- **Memory discipline:** No agent call may exceed a configurable token budget. Context assembled via retrieval, not bulk load.
- **Boundary cleanliness:** Single-user assumptions confined to a thin layer; data model and agent logic stream-scoped so multi-tenancy is a deployment concern, not a refactor.
- **Apple sync resilience:** If Notes two-way sync fails, system falls back to one-way (write-only) without data loss.
- **Language:** Python.

## Out of Scope (v1)
- Gmail and Google Calendar event ingestion (deferred — manual events only).
- Generic webhook ingestion (deferred).
- Stream hierarchy / nesting (flat list only).
- Full agent review queue with confidence thresholds (replaced by minimal agent-item marker per FR-11).
- Web UI / dashboard.
- Multi-user, sharing, collaboration features.
- Native mobile app (Claude mobile + Apple Reminders + Apple Notes is the mobile surface).
- Voice capture.
- Separate Decision log entity (decisions are events with `type: decision` in v1).
- Local LLM execution (Claude only in v1; DGX Spark / local model offload is a v2 concern).

## Technical Constraints & Dependencies
- **Stack:** Python 3.12+, Claude Code as primary build tool.
- **Storage:** Markdown files in a git repo on the Mac mini. Append-only monthly event logs per stream (`streams/<name>/events/YYYY-MM.md`) to keep individual files small. Nightly SQLite index rebuilt from markdown for fast cross-stream queries; SQLite is disposable.
- **Host:** Always-on Mac mini (M1 currently; M5 Pro consideration is independent of this product).
- **LLM:** Claude API for all agent reasoning in v1. Architecture must allow swapping a local model for routine passes later without rewiring the agent.
- **Apple Reminders sync:** EventKit via a small Swift/AppleScript bridge, polled or event-driven.
- **Apple Notes sync:** AppleScript/JXA bridge running on the Mac mini. **Known fragility** — must include a one-way fallback path and a health-check that surfaces sync failures into the morning digest.
- **MCP server:** Single MCP server exposing tools for stream CRUD, event append, TODO management, agent invocation, and cross-stream queries — consumed by Claude desktop/mobile.
- **CLI:** Thin wrapper over the same internal API the MCP server uses. Same operations, terminal-native.
- **Scheduling:** `launchd` on macOS for morning/evening agent passes.

## Key Risks & Open Questions
1. **Agent noise → trust collapse (highest risk).** If the morning digest is noisy or wrong twice in a row, the user stops reading it and the product dies. The deferred full review queue is replaced by FR-11 (visual marker on agent-created items), but this is a minimum — needs honest evaluation in week 2–3 of use. Conditional risk: may need to bring forward more of the review-queue design.
2. **Apple Notes two-way sync stability.** AppleScript on always-on Mac is the only realistic path. Fragile to macOS/Notes updates. Mitigation: explicit one-way fallback, sync health surfaced in digest.
3. **Memory/context degradation as data grows.** Markdown-in-git is fine as storage; cross-stream queries over months of event history are not. Requires real engineering: monthly event log files, SQLite index, recency-weighted retrieval, compaction. Easy to under-build.
4. **Timeline realism.** "2–3 weekends" for the defined MVP is ambitious. Realistic estimate: 3–4 weekends if Apple Notes sync cooperates, 5+ if it doesn't.
5. **Cost of daily Claude passes.** Ranked lowest risk by user but worth measuring early. Establish a cost budget per agent pass in week 1.
6. **Multi-tenancy boundary discipline.** Single-user v1 design must keep auth/identity assumptions in one thin layer. Easy to leak single-user assumptions into the agent prompts or file paths if not deliberate.

## Go/No-Go Verdict
**Verdict:** Go

**Reasoning:** The problem is validated by the user's own multi-tool, multi-medium attempts to solve it. The architecture (markdown-in-git + Mac mini + Claude via MCP + Apple sync) is coherent, minimal, and matches the user's existing infrastructure and habits. Scope is honest about deferrals. The user is both the builder and the only v1 user, eliminating feedback-loop friction. The product is buildable in evenings with Claude Code, useful from day one, and productizable later without rewrite if boundaries are kept clean. The dominant risk — agent noise causing trust collapse — is addressable with the minimal marker pattern in FR-11 and a willingness to bring forward more review-queue work if needed.

**Conditions:** None blocking, but two design discipline conditions worth respecting during build:
- Do not skip FR-11 (agent-item markers) under time pressure; it is the noise-control mechanism for the #1 risk.
- Do not hand-wave memory/context management; design the monthly-event-log + SQLite-index structure on day one, not after data accumulates.

## Suggested Next Steps
1. **Sketch the markdown schema** for a stream (folder layout, frontmatter fields, event log format, decision tagging). Half a weekend.
2. **Spike Apple Notes sync** before committing to two-way. One evening. If AppleScript path works for read + write on a tagged note, full two-way is feasible; if not, fall back to one-way and document.
3. **Build the core MCP server with stream CRUD + manual event/TODO append.** Weekend 1. No agent yet. Validate the data model and MCP surface from Claude.
4. **Add Apple Reminders two-way sync.** Weekend 2. Easier than Notes; gives immediate phone-capture path.
5. **Add the agent layer with morning/evening pass + on-demand.** Weekend 3. Start with a deliberately conservative prompt: surface, don't decide. Measure noise level over 7 days of real use before increasing autonomy.
6. **Add Apple Notes sync** (per spike outcome). Weekend 4 if needed.
7. **Instrument cost and context size from day one.** Log token usage per agent call to a stream of its own ("streams.meta"). Review weekly.
