# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield. The only content so far is `streams-brief.md` (the validated project brief). There is no code, no git repo, no build tooling, and no tests yet. When implementation begins, update this file with real commands. Until then, the brief is the source of truth for architecture and scope — read it before making structural decisions.

## What Streams is

A headless personal operating system for running 10–20 parallel ventures, accessed entirely through existing surfaces (Claude desktop/mobile, terminal, Apple Reminders, Apple Notes) with **zero dedicated UI**. An AI agent autonomously organizes commitments, surfaces priorities, and maintains an auditable timeline across streams. Single-user (v1), runs as one always-on process on a Mac mini.

## Architecture (intended)

The system is one MCP server plus a sync layer. Key structural decisions, all load-bearing:

- **Markdown-in-git is the source of truth.** Each Stream is a markdown file/folder holding: goal(s), TODO list, append-only event log, free-form notes, and weight/state (`active` / `maintenance` / `dormant`). Every change is committed; revert = git revert, restore = git clone. The repo must stay portable.
- **Event logs are append-only and sharded by month** at `streams/<name>/events/YYYY-MM.md` to keep individual files small. Design this on day one — do not defer it until data accumulates (explicit Go condition in the brief).
- **SQLite is a disposable index, not storage.** Rebuilt nightly from markdown to power fast cross-stream queries. Never treat it as authoritative.
- **Three access surfaces over one internal API:** (1) MCP server exposing tools for stream CRUD, event append, TODO management, agent invocation, and cross-stream queries; (2) a thin CLI wrapper over the *same* internal API; (3) the agent itself. The CLI and MCP server must not duplicate logic — both call the shared core.
- **Agent passes** run scheduled (morning + evening, via `launchd`) and on-demand. Every agent write produces an `agent-note` event capturing prompt context, action taken, and reasoning — this is the audit trail.
- **Apple sync bridges:** Reminders via EventKit (Swift/AppleScript), two-way, for TODOs. Notes via AppleScript/JXA, two-way for synthesis notes and ingestion. Notes sync is known-fragile — it **must** ship with a one-way (write-only) fallback and a health check that surfaces failures into the morning digest.
- **LLM:** Claude API for all agent reasoning in v1. Keep the agent decoupled from the model so a local model can take over routine passes later without rewiring.

## Non-negotiable constraints

These come straight from the brief's risk analysis and Go conditions — respect them even under time pressure:

- **FR-11 — agent-item markers are not optional.** Agent-created TODOs/events must be visually distinguishable from user-created ones (flag/marker). This is the primary control for the #1 risk (agent noise → trust collapse). Do not drop it to save time.
- **Token budget per agent call is hard-capped** (configurable). Assemble context via recency-weighted *retrieval*, never bulk-load. Plan for monthly event-log compaction and semantic search over notes.
- **Stream weight/state drives prioritization:** `dormant` streams are excluded from the daily digest; `maintenance` streams surface only on material change.
- **Provenance is tracked everywhere.** Events carry source (`manual` / `agent` / `sync`) and type (`event` / `decision` / `agent-note`). TODOs carry provenance (`user` / `agent` / `reminders-sync`). Decisions are events with `type: decision` — there is no separate decision entity in v1.
- **Multi-tenancy boundary discipline.** v1 is single-user, but auth/identity assumptions must live in one thin layer. Keep the data model and agent logic stream-scoped; never bake single-user assumptions into file paths or agent prompts.

## Stack

- Python 3.12+.
- macOS-only host (Mac mini, M1). `launchd` for scheduling; EventKit + AppleScript/JXA for Apple integration.

## Out of scope for v1 (don't build these)

Gmail/Calendar ingestion, generic webhooks, stream nesting/hierarchy, full agent review queue with confidence thresholds, any web UI/dashboard, multi-user/sharing, native mobile app, voice capture, separate decision-log entity, local LLM execution.
