# Streams

**A headless personal operating system for running 10–20 parallel ventures — with no app to open.**

Streams lives entirely inside tools you already use: **Apple Notes**, **Apple Reminders**, and **iMessage**, plus a terminal CLI for power use. A single always-on daemon on a Mac mini turns each venture into a living Apple Note, folds your edits back in, and runs scheduled AI passes that synthesize state and surface what needs your attention — all on top of a plain **markdown-in-git** store you fully own.

<p>
  <img alt="Python 3.12+" src="https://img.shields.io/badge/python-3.12%2B-blue">
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-lightgrey">
  <img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-green">
  <img alt="Built with uv" src="https://img.shields.io/badge/built%20with-uv-de5fe9">
</p>

---

## Why

Running many ventures at once is a context-switching problem, not a note-taking one. Every dedicated "second brain" app becomes one more place to check — and the one you stop checking. Streams inverts that: **there is no app to open.** Each venture is an Apple Note you read and edit like any other; the agent works in the background and reaches you through iMessage and Reminders. Your data is markdown in a git repo — auditable, portable, and yours.

## How it works

```
                ┌──────────── Apple surfaces (your phone & Mac) ────────────┐
                │                                                            │
   Apple Notes  │   Reminders          iMessage                             │
   (one note    │   (due nudges +      (digest out,                         │
    per stream, │    completion-back)   replies routed back)                │
    read+edit)  │                                                           │
                └──────▲───────────────────▲─────────────────▲─────────────┘
                       │ render / reconcile │ push / poll     │ ask / poll
                ┌──────┴────────────────────┴─────────────────┴─────────────┐
                │                  always-on daemon (launchd)                │
                │   poll tick (frequent)  ·  scheduled passes (3×/day)       │
                │   two-layer agent: per-stream synthesis → overseer         │
                └───────────────────────────▲────────────────────────────────┘
                                             │ commit every change
                ┌────────────────────────────┴───────────────────────────────┐
                │   markdown-in-git  ·  the source of truth  ·  you own it     │
                │   streams/<slug>/{stream,goals,todos,notes}.md + events/     │
                └─────────────────────────────────────────────────────────────┘
                       (SQLite index is disposable, rebuilt from markdown)
```

**The note round-trip is the heart of it.** A stream's note is both rendered output *and* editable input, split into delimited zones:

- **user-owned** — goals, the todo checklist, your free-form *Notes / Thoughts*
- **agent-owned** — current state, what's next, suggestions (marked 🤖 so agent items are always distinguishable)
- **read-only** — recent events

The reconcile rule is simple and safe: **your edits always win and reconcile first; the agent only ever rewrites its own zones.** Check a box, add a todo, jot a thought — the daemon folds it into the store on the next poll and re-renders the note to match.

## Features

- 📝 **Apple Notes as the UI** — one note per stream, two-way. Falls back to write-only without data loss if reconcile can't run.
- 📁 **Capture by folder** — create a note in your `Streams` folder and it's auto-adopted into a new stream.
- ✅ **Reminders, two-way** — open, due-dated todos become nudges; checking one off completes the todo, and vice-versa.
- 💬 **iMessage, two-way** — the agent texts you a digest and questions; your replies route back into the right stream.
- 🤖 **Conservative two-layer agent** — per-stream synthesis under an overseer that prioritizes across everything. "Surface, don't decide."
- 🧾 **Markdown-in-git source of truth** — every change committed and signed by the agent; revert with git, restore with clone.
- 🔒 **Single-user by design, multi-tenant-ready** — all identity confined to `config.yaml`; the data model stays stream-scoped.
- 💸 **Budget-aware** — hard token cap per call, recency-weighted retrieval (never bulk-load), and a cost/noise ledger you can review weekly.
- 🧪 **Fully fakeable** — every external surface (LLM, Notes, Reminders, iMessage) has a fake, so the whole suite runs with no Mac, no permissions, and no API key.

## Quick start

> Requires **Python 3.12+**, [`uv`](https://docs.astral.sh/uv/), and **macOS** for the live Apple integrations. The test suite needs none of those beyond Python + uv.

```sh
git clone https://github.com/DaJungle79/streams
cd streams

uv sync                 # base + dev deps (pytest)
uv run pytest           # 119 tests, all green, no Mac/API key required

uv run streams --help   # explore the CLI
```

To run it for real on a Mac mini, install the Apple deps and walk through setup:

```sh
uv sync --group apple        # adds the pyobjc/EventKit bridges
uv run streams setup         # prompts for agent name, API key, iMessage handle… → config.yaml
```

Grant the macOS permissions the bridges need: **Automation** (Notes + Messages), **Reminders** access, and **Full Disk Access** (to read `chat.db` for inbound iMessage). See [`docs/ops.md`](docs/ops.md) for the full runbook.

## Using the CLI

The CLI and the daemon both call the same shared core. A tour:

```sh
# streams & sub-objects
streams stream create "Acme launch" --note   # create a stream (and its note now)
streams stream list                          # all streams with state/weight
streams goal add acme-launch "Ship v1 by Q3"
streams todo add acme-launch "Draft pricing" --due 2026-06-01
streams event add acme-launch "Signed first design partner" --type decision

# the note round-trip
streams note preview acme-launch             # see the rendered note
streams sync                                 # reconcile edits ↔ re-render all notes
streams capture                              # adopt any new notes in the Streams folder

# the agent
streams agent cycle                          # per-stream synthesis → overseer (one full pass)
streams agent oversee                        # just the cross-stream overseer
streams query recent                         # recency view across streams

# bridges
streams reminders sync                        # push due todos / pull completions
streams imessage ask "Which launch is top priority this week?"

# operations
streams daemon run                            # foreground: scheduled passes + poll loop
streams daemon install                        # write the launchd plist (keep it alive)
streams health                                # probe Notes / Reminders / iMessage
streams report --days 7                        # weekly cost + agent-noise summary
streams backup                                 # git push the data repo
```

## The daemon

A single always-on process, supervised by `launchd`:

- **Poll tick** (frequent) — capture new tagged notes, reconcile note edits, pull reminder completions, route inbound iMessage replies. A stream whose note just changed is synthesized immediately, so new info is acted on without waiting for a scheduled pass.
- **Scheduled passes** (3×/day) — ingest → two-layer agent → project synthesis back to notes → nudge the digest → record health.
- **Resilient** — one failing tick is logged and the loop continues; a restart runs one overseer pass on startup but never re-fires the day's past passes, and the digest is only sent when it actually changed.

```sh
uv run streams daemon run     # or: install the launchd agent and let it run at login
```

## The agent

Two conservative layers, both read-mostly:

- **Stream level** keeps each stream's `agent.md` synthesis (current state, what's next) and proposes a few clearly-marked suggestions.
- **Overseer level** sits above all streams for prioritization and juggling, carrying durable status + memory forward between runs.

Stream `weight`/`state` drive attention: `dormant` streams are excluded from the daily digest, and `maintenance` streams surface only on material change. The agent is decoupled from the model behind an `LLM` protocol (Claude API today, with prompt caching; a local model could take over routine passes later).

## Documentation

| Doc | What's in it |
|---|---|
| [`streams-brief.md`](streams-brief.md) | The product brief — scope, requirements, risk analysis, go-conditions |
| [`docs/plan.md`](docs/plan.md) | Architecture and phased build plan |
| [`docs/ops.md`](docs/ops.md) | Install, run, permissions, health, backup/restore |
| [`CLAUDE.md`](CLAUDE.md) | Architecture guide & conventions (for contributors and Claude Code) |

## Status

Phases 0–6 are implemented — the full pipeline exists: core store, note render/reconcile, capture, the two-layer agent, Reminders, iMessage, and the daemon (**119 tests**, all green in CI-free mode). The real Apple/Claude bridges are validated on-device; anything touching `osascript`, EventKit, `chat.db`, or the Claude API is by nature untested in CI and exercised through fakes.

## Stack

Python 3.12+ · `uv` for env/deps · macOS host (Mac mini, M1) · `launchd` supervision · Anthropic SDK with prompt caching · git via subprocess · SQLite (stdlib) for the disposable index.

## Out of scope (v1)

MCP / Claude-desktop surface (deferred — the core is kept surface-agnostic so it's a thin add later), Gmail/Calendar ingestion, generic webhooks, stream nesting, a full agent review queue, a web UI, general capture of arbitrary new Reminders, multi-user/sharing, a native mobile app, voice capture, and local LLM execution.

## License

[Apache License 2.0](LICENSE).
