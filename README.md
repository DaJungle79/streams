# Streams

A headless personal operating system for running parallel ventures, accessed
through Apple Notes, Apple Reminders, and iMessage — with a terminal CLI for
power use. Markdown-in-git is the source of truth; a single always-on daemon on
a Mac mini renders each stream into an Apple Note, reconciles your edits back,
and runs scheduled agent passes for synthesis.

- **Scope & requirements:** [`streams-brief.md`](streams-brief.md)
- **Architecture & build plan:** [`docs/plan.md`](docs/plan.md)
- **Guidance for Claude Code:** [`CLAUDE.md`](CLAUDE.md)

## Status

Phase 0 — foundations and de-risking spikes. No daemon yet.

## Development

```sh
uv sync                 # base deps + dev (pytest)
uv run pytest           # run the test suite
```

The Apple integration spikes live in [`docs/spikes/`](docs/spikes/) and are run
manually (they need macOS permissions). See that directory's README.

Requires Python 3.12+. Targets macOS only.
