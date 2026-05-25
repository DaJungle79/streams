# Streams — Development Plan

Companion to `streams-brief.md`. Reflects the design decisions taken 2026-05-25:
**Apple-surfaces-first**, single always-on daemon, **hybrid notes**, **Reminders push + completion-back**, **two-way iMessage**, and a Stream modeled as a container of four sub-object collections (**goals, todos, events, notes**). The MCP server / Claude-desktop surface is deferred from v1; the core stays surface-agnostic so it is a thin add later, not a refactor.

## Architecture

A single **always-on daemon** on the Mac mini. Markdown-in-git is the source of truth; **Apple Notes is the primary UI** (one note ↔ one stream, both rendered output and editable input).

Layers, inner → outer (each depends only on the ones above it):

| Layer | Module | Responsibility |
|---|---|---|
| **Core domain** | `streams.core` | Stream + its four sub-objects (goals, todos, events, notes). The internal API everything calls. No Apple, no Claude. |
| **Store** | `streams.store` | Markdown read/write + frontmatter, append-only monthly event logs, git commit-per-change. |
| **Index** | `streams.index` | Disposable SQLite rebuilt from markdown; cross-stream queries + recency retrieval. |
| **Notes engine** | `streams.notes` | `render` (stream → hybrid note) and `reconcile` (note edits → markdown). The hard core. |
| **Apple bridges** | `streams.apple` | `notes`, `reminders` (EventKit/pyobjc), `messages` (AppleScript send + chat.db read). Behind interfaces so core is testable with fakes. |
| **Agent** | `streams.agent` | Claude API tool-use loop: synthesis, marked suggestions, clarifying questions. Token-budgeted; every write → `agent-note` event. |
| **Daemon** | `streams.daemon` | Scheduler (3×/day passes) + poll loops (note edits, reminder completions, inbound iMessage) + health checks. |
| **CLI** | `streams.cli` | Thin admin/power wrapper over core (create stream, manage goals/todos/events, force pass, query, revert). |

**No change-events:** Apple Notes has no edit-notification API, so "user-triggered wake" is the daemon **polling** Notes (modification-date/hash compare) on a configurable cadence. Same for iMessage (chat.db poll) and Reminders completion.

## Data model & layout

A Stream is a folder containing metadata plus four sub-object collections.

```
repo/
  streams/<slug>/
    stream.md            # frontmatter: id, title, state, weight, note_id, created
    goals.md             # goals collection
    todos.md             # todos collection
    notes.md             # free-form long-form notes
    events/2026-05.md    # append-only monthly event log
  config.yaml            # pass times, poll cadence, token budget, identities (number, Notes account, repo path)
  .index.sqlite          # disposable
  .render/<slug>.json     # last-rendered note snapshot + line→item manifest (for 3-way reconcile)
```

Sub-object shapes:
- **Goal** — `id, text, status (active|achieved|dropped), created, target? , src (user|agent)`
- **Todo** — `id, text, status (open|done|deferred|archived), src (user|agent|reminders-sync), due?, created, reminder_id?`
- **Event** — `timestamp, source (manual|agent|sync), type (event|decision|agent-note), content` (append-only, monthly files)
- **Note** — free-form markdown in `notes.md`

Todos and goals are stored in markdown with their metadata; the **note** renders clean checklists/lines and the `.render` manifest maps each note line back to its sub-object id.

## The note round-trip (make-or-break)

Each note has **clearly delimited zones**:
- **User-owned**: goals, the todo checklist (add/check/remove freely), and a free-form *Notes / Thoughts* region.
- **Agent-owned**: *Current state*, *What's next*, *Suggestions* (agent-proposed todos carry an FR-11 marker, e.g. 🤖).
- **Read-only**: *Recent events*.

**Reconcile (on detected edit):** diff current note vs last render → classify:
- checkbox toggle / removed line / new checklist line / goal edit = **deterministic** ops resolved via the manifest;
- edits inside *Notes / Thoughts* = **LLM** intent extraction (short thoughts → events; longer prose → `notes.md`).

Apply via core, commit, then **zone-safe re-render** that never overwrites the user's zones. **Rule: user edits always win and reconcile first; the agent only rewrites its own zones.** Build and test this zone machinery before the LLM is involved.

## Phased build

### Phase 0 — Foundations & spikes (de-risk the fragile Apple integrations first)
- Python 3.12 scaffold (`uv` + `pyproject`), config loader, logging, `pytest`.
- **S1 Notes round-trip**: create/read a note, detect an external edit, rewrite preserving a user region. Go/no-go for the whole UI model.
- **S2 iMessage**: read `chat.db` (needs **Full Disk Access**), send via AppleScript. Go/no-go for two-way iMessage.
- **S3 Reminders**: create + read completion via EventKit (pyobjc).
- Output: throwaway scripts + a committed go/no-go note per spike under `docs/spikes/`; documented macOS permissions.

### Phase 1 — Core + store + git + CLI
- Models for Stream + goals/todos/events/notes; markdown round-trip with frontmatter; monthly event append; git commit-per-change with structured messages; SQLite index build + a couple cross-stream queries.
- CLI: stream CRUD; goal/todo/event ops; query. *No Apple, no Claude yet.*
- Tests: serialize/parse round-trip, event append, index rebuild correctness.
- **Deliverable:** full data model usable from the terminal, committed to git, queryable — validated independently of Apple/Claude.

### Phase 2 — Render + reconcile loop (the core)
- Renderer (stream → hybrid note) + manifest; Notes bridge wired to real Apple Notes (one note per stream, map `note_id`).
- Reconciler: deterministic goal/todo handling + a rule-based free-form extractor; daemon poll skeleton detects note changes → reconcile.
- Tests: simulate note edits, assert markdown reconciliation and zone-protection.
- **Deliverable:** edit a stream's note on your phone → changes land in markdown+git, nothing clobbered. The heart works without the LLM.

### Phase 3 — Agent (conservative)
- Anthropic SDK tool-use loop with **prompt caching**; recency-weighted retrieval; hard token budget per call.
- Produces per-stream synthesis (*current state* / *what's next*) + marked suggestions + a cross-stream daily digest; upgrades the free-form extractor to LLM.
- Respects state/weight (dormant excluded, maintenance only on material change). 3×/day passes in the daemon.
- Every agent write → `agent-note` event with prompt context + reasoning; cost/tokens logged to a `streams.meta` stream.
- **Conservative prompt ("surface, don't decide"); measure noise for 7 days before adding autonomy.**
- **Deliverable:** scheduled note refresh with agent synthesis + suggestions; daily digest; cost instrumented.

### Phase 4 — Reminders (push + completion-back)
- EventKit bridge: push select todos (due-dated / agent-prioritized) as nudges; poll completion → mark todo done (reconcile); todo↔reminder mapping + de-dup.
- Health check: Reminders access failures surfaced into the digest.
- **Deliverable:** nudges on your phone; checking off a reminder completes the todo.

### Phase 5 — iMessage two-way
- Outbound: agent sends clarifying questions/nudges via AppleScript.
- Inbound: poll `chat.db` for replies; route to the agent with a **pending-question state machine** so a reply maps to the question asked.
- Fallback to outbound-only / in-note questions if `chat.db` is unreadable.
- **Deliverable:** the agent can ask and you can answer by text.

### Phase 6 — Hardening & ops
- Daemon under `launchd` (keepalive/restart); structured logs; sync-health digest section.
- Backup: git push to a private remote + restore doc.
- Weekly cost/noise report from `streams.meta`.
- **Multi-tenancy boundary audit:** your number, Notes account, and repo path confined to `config.yaml`.

## Key tech decisions
- **All-Python Apple access:** pyobjc for EventKit (Reminders); osascript/JXA (or ScriptingBridge) for Notes; direct `chat.db` SQLite read for inbound iMessage + AppleScript send. Permissions: Automation, Reminders, **Full Disk Access**.
- **uv** for env/deps; **git via subprocess**; **SQLite** stdlib.
- **anthropic SDK** with prompt caching; model selectable per pass type (cheaper for routine refresh, stronger for synthesis); kept swappable for a future local model.
- Apple bridges behind interfaces → core/agent fully testable without a Mac in CI.
- No MCP server in v1; core API kept clean so MCP is a thin later add.

## Remaining choices (decide at the relevant phase, not blocking)
- Exact 3 pass times + poll cadence (responsiveness vs. cost).
- Token budget number + model-per-pass.
- Stream creation/linking flow (create a fresh note vs. adopt an existing one).
- Which todos get pushed to Reminders (due-dated? agent-prioritized? user-flagged?).
- Which iMessage thread is "you" (self-chat vs. dedicated thread).
- Free-form edits routing: short thoughts → event log, longer prose → `notes.md` (default; tune in Phase 2/3).
