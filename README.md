# Streams

**A macOS app for tracking ongoing initiatives — built around one question, asked of every stream, at all times: _what's next?_**

A *stream* is anything ongoing worth watching: a company under governance, a project, a case, an idea. Streams exists to prevent one specific failure — **a stream going quietly stale**. Every stream is always covered by at least one attention trigger, so none can rot unnoticed.

> The attention view is the app; the list is just the database.

Status: **early**. See [`SPEC.md`](SPEC.md) for the product and [`PLAN.md`](PLAN.md) for build order and milestone state.

## What it does

- **Attention view** — the default screen. Not a browsable list: only streams that need you today, grouped by *why* (no next step, check-in overdue, deadline window open, waiting too long, waking up today). When it's empty, it says so — that's the reward.
- **Fuzzy deadlines** — real deadlines are "end of Q3", not `2026-09-30`. Stored as `{label, earliest, latest}`: the label is what you meant and what you see; the window is what makes streams sortable and lets the app notice a deadline opening. The app never invents precision you didn't give it.
- **Waiting-on tracking** — every next step has an owner. Steps owned by other people are tracked by how long they've been waiting, not mixed in with your own work.
- **Append-only log** — returning to a stream after six weeks should take under a minute to reload context.
- **Weekly review** — a guided pass over every live stream: still relevant? next step right? owner right?
- **Ambient by default** — a menu-bar count, a global capture hotkey, and one batched daily digest. Useful without ever opening the main window.

## Stack

Tauri v2 · React · TypeScript · plain JSON files on disk.

Two deliberate choices worth stating:

**No database.** Storage has one hard constraint: files must survive living in a folder a sync daemon rewrites underneath the app. SQLite fails this — its `-wal`/`-shm` sidecars sync as independent files with no atomicity across the set, and the realistic failure is a corrupt database rather than a conflict. JSON files degrade to a *duplicate file* instead, which is recoverable. One file per stream keeps a conflict's blast radius at one stream, and makes "export" a non-feature.

**All product logic in TypeScript; Rust is glue only** — tray, hotkey, autostart, atomic file writes. The two pure cores (a fuzzy-date parser and the attention engine) are plain modules with no Tauri imports, so they test in milliseconds with no app running.

## Build

Needs Node, a Rust toolchain, and Xcode **Command Line Tools** (`xcode-select --install`) — not Xcode itself, and no Apple Developer account.

```sh
npm install
npm run tauri dev      # develop
npm run tauri build    # -> src-tauri/target/release/bundle/macos/Streams.app
```

```sh
npm test               # TypeScript: models, transitions, and (later) the cores
cd src-tauri && cargo test   # Rust: the atomic-write guarantees
```

## History

An [earlier incarnation](https://github.com/DaJungle79) took the opposite bet — headless, no app to open, living inside Apple Notes/Reminders/iMessage behind a daemon. This version inverts that: the attention view *is* the product. Apple Reminders survives as a one-way mirror of your own next steps (SPEC §4.5), so your phone still gets a glance at what's next.

## License

Apache-2.0
