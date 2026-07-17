# Streams — Product Spec (v1)

A sleek, native macOS app for tracking **streams**: ongoing initiatives, projects, ideas, and cases — from a whole small company under governance down to a single topic worth watching. The app exists to answer one question per stream, at all times: **"What's next?"**

## Guiding principle

The attention view is the app; the list is just the database. The product is built around *"what needs my attention today"* — not around browsing. A stream silently going stale is the failure mode the app is designed to prevent.

---

## 1. Core model

### Stream

The single primary entity.

| Field | Description |
|---|---|
| Title | Short name of the stream |
| Area | The company/domain it belongs to (see §5) |
| State | `active` / `waiting` / `parked` / `done` |
| Outcome | The final result this stream is driving toward (free text) |
| Target deadline | Fuzzy date (see §2) |
| Next step | Free text + **owner** (me / named person) + date it was set |
| Next milestone | Free text + concrete date (optional) |
| Check-in cadence | "Review every N days" (per stream, optional) |
| Priority | `high` / `normal` |
| Last touched | Auto-updated on any edit or log entry |
| Log | Append-only dated notes (see §3.3) |

State semantics:
- **active** — being driven; must have a next step (absence of one is flagged).
- **waiting** — next step is owned by someone else; tracked with "waiting since."
- **parked** — deliberately dormant; must have a **wake-up date**, on which it resurfaces in the attention view.
- **done** — moved to the archive with its full log (see §5.2).

### Fuzzy deadlines

Deadlines are stored as a triple:

```
{ label: "end of Q3 2026", earliest: 2026-09-01, latest: 2026-09-30 }
```

- The **label** preserves the human phrasing and is what's displayed.
- **earliest/latest** make streams sortable by urgency and let the app detect "deadline window has opened."
- Input is a single text field with a lightweight parser covering: exact dates, `Q3 2026`, `beginning/mid/end of Q3`, month names, `early/mid/late September`, `last week of September`. Parser shows its interpretation inline for confirmation; unparseable input falls back to manual earliest/latest pickers.

---

## 2. Attention view (main screen)

The default screen. Shows only streams that need attention, grouped by reason:

1. **No next step** — active streams whose next step is empty or was completed without a replacement.
2. **Check-in overdue** — streams whose cadence timer has elapsed since last touch.
3. **Deadline window open / approaching** — target `earliest` date reached, or milestone date within 7 days.
4. **Waiting too long** — waiting-on-others items older than a threshold (default 7 days, configurable).
5. **Waking up today** — parked streams whose wake-up date arrived.

High-priority streams pin to the top of their group. When the view is empty, it says so — an explicit "nothing needs you" state is the reward.

Each row shows: title, area, the reason it's here, the next step + owner, and one-click actions (mark step done → prompt for new step; log a note; snooze check-in; open stream).

## 3. Oversight features

### 3.1 Waiting-on tracking

- Every next step has an owner: **me** or a **named person** (simple free-text name with autocomplete from previously used names — no contacts integration in v1).
- Dedicated **Waiting** view: everything currently waiting on someone else, grouped by person, sorted by how long it's been waiting.
- "Nudge sent" action stamps the log and resets the waiting timer.

### 3.2 Check-in cadence

- Per-stream `review every N days` (e.g. 7 for a company under governance, 30 for an idea).
- A check-in is satisfied by any touch (edit, log entry, step completion) or an explicit "checked in" action.
- Overdue check-ins surface in the attention view and count toward the menu-bar badge.

### 3.3 Decision/activity log

- Append-only, dated entries per stream. One text field, newest first.
- Automatic entries for structural events: step completed, step changed, owner changed, state changed, deadline changed.
- The stream detail screen shows the log alongside the current state — returning to a stream after six weeks should take under a minute to reload context.

### 3.4 Weekly review mode

- A guided, full-screen flow walking through every non-done stream, one at a time.
- Per stream, three prompts: *Still relevant?* (park/done/keep) → *Is the next step right?* (edit inline) → *Is the owner right?*
- Progress indicator ("7 of 23"), skippable, resumable. Reviewing a stream counts as a check-in.
- App suggests a review when >25% of active streams are overdue for check-in, or weekly — whichever comes first.

## 4. macOS-native UX

### 4.1 Menu-bar glance

- Menu-bar icon with a badge count = number of streams currently in the attention view.
- Click → dropdown with the top 5 attention items; clicking one opens the app to that stream.
- The menu-bar extra runs independently of the main window.

### 4.2 Global quick-capture

- System-wide hotkey (default ⌥⌘S, configurable) opens a floating one-field window.
- Text becomes a new **parked** stream (title only, wake-up in 7 days by default) — triage happens later, capture is instant.
- Optional inline syntax: `>area` to assign an area at capture time.

### 4.3 Notifications

Native macOS notifications for:
- Milestone date arrived.
- Deadline window opened (`earliest` reached).
- Check-in became overdue (batched into one daily digest at a configurable time, default 08:30 — not one notification per stream).
- Parked stream woke up.

### 4.4 Launch at login

- App registers as a login item (`tauri-plugin-autostart`); main window stays closed, tray icon active. Toggleable in Settings.
- The app runs as an accessory (no Dock icon) with a hidden webview kept alive, so the tray count and the daily digest work with no window open.

### 4.5 Apple Reminders mirror

Next steps owned by **me** (§3.1) are mirrored one-way into a dedicated Reminders list. This is the app's only ecosystem integration, and it exists for one reason: Reminders syncs to the iPhone, so it buys back a mobile glance at "what's next" without an iOS app (§7).

**One-way, always.** Streams is the source of truth. Reminders is a projection of it — never an input. Completing a reminder does not touch the stream.

- **What mirrors:** active streams whose next-step owner is *me*. Waiting-on-others steps (§3.1) stay out — they aren't actionable by you, and a to-do list full of things you can't do is a list you stop reading. Parked, done, and next-step-less streams have nothing to mirror.
- **Reminder shape:** title = the next step text. Notes = stream title, area, outcome, and the fuzzy deadline **label**. List = a dedicated `Streams` list, never the user's default list.
- **Due dates:** set only from the **next milestone** date (§1), which is already concrete. A fuzzy target deadline never becomes a due date — `earliest` is the start of a window, and treating it as a deadline fabricates precision the user deliberately didn't give. The label lives in the notes as text instead.
- **Reconciliation** runs on stream change and at startup: create missing reminders, update changed ones, and delete reminders whose stream left the mirror set (step completed, owner reassigned, stream parked/done).

#### Single-writer rule

Reminders syncs across the user's devices via iCloud on its own. Mirroring from more than one Mac would therefore produce duplicates, and would force the reminder↔stream ID map into the synced stream files — dragging §6's conflict policy into a third-party writer.

So: **exactly one Mac mirrors.** A local setting (`mirrorToReminders`, default off) designates it. The ID map lives in `~/Library/Application Support/Streams/reminder-map.json`, **outside the sync folder**, because it is machine-local state. Sync surface is unchanged by this feature.

#### Known limitation (accepted for v1)

Ticking a mirrored reminder on your phone does nothing. The step stays open, Streams keeps surfacing it in the attention view, and the two lists diverge until the step text changes and the reminder is rewritten. The app does **not** resurrect or un-complete the reminder — silently undoing a user's deliberate tick is worse than the divergence.

If this becomes a habit rather than an occasional slip, that's the signal to build two-way completion — not to patch around it.

## 5. Organization

### 5.1 Areas

- Flat list of areas (e.g. one per company, plus "Personal", "Ideas"). Each stream belongs to exactly one.
- Sidebar filters all views by area; "All" is the default.
- Areas have a color used as a subtle accent on stream rows.

### 5.2 Archive

- `done` streams disappear from working views into a browsable Archive, filterable by area, retaining the full log — an outcomes history per company.
- Streams can be reactivated from the archive.

### 5.3 Priority flag

- Binary `high`/`normal`. High-priority streams pin to the top within every view and use a stronger visual accent. No multi-level priority ladders.

## 6. Technical

| Decision | Choice |
|---|---|
| UI | Tauri v2 + React + TypeScript. Single main window + tray (menu-bar) icon + floating capture panel |
| Language split | All product logic in TypeScript. Rust is glue only: tray, hotkey, autostart, file I/O |
| Persistence | Plain JSON files on disk, one per stream (see below). No database |
| Sync | A user-chosen sync folder (Syncthing recommended; Dropbox/iCloud Drive supported). The app never talks to a network itself |
| Notifications | `tauri-plugin-notification` |
| Quick capture hotkey | `tauri-plugin-global-shortcut` (Carbon `RegisterEventHotKey` underneath — no accessibility permission) |
| Login item | `tauri-plugin-autostart` |
| Reminders mirror (§4.5) | AppleScript via `osascript`, invoked from Rust. See below |
| Distribution | Local `tauri build`, ad-hoc signed `.app`. Not notarized, not distributed |
| Requires | Node, Rust toolchain, Xcode **Command Line Tools** only. No Xcode app, no Apple Developer account |

### Why AppleScript and not EventKit

EventKit is the "proper" Reminders API — faster, no app launch, no Apple Events. But it is an Objective-C framework, so reaching it from Rust means `objc2` bindings plus an async authorization flow, and it would put real Apple-framework surface back into a codebase whose Rust layer is deliberately thin glue (§ Architecture, `PLAN.md`).

AppleScript via `osascript` is a subprocess that takes text and returns text. It needs no FFI, no bindings, and no Rust knowledge beyond `Command::new`. The cost is latency (~100–300ms per call, and Reminders' AppleScript dictionary is not fast), which is irrelevant here: the mirror set is a handful of items, reconciliation is not user-blocking, and it runs on change rather than on a poll.

If it proves too slow in practice, EventKit is the escape hatch — the mirror is one isolated module behind one interface.

Neither route needs Xcode or an Apple Developer account. AppleScript does require an `NSAppleEventsUsageDescription` key in `Info.plist` and a one-time TCC "Streams wants to control Reminders" approval.

React is not load-bearing — Svelte or Solid would serve equally well. It's chosen for familiarity and ecosystem size.

### Why no database

Persistence has one hard constraint: the files must survive living inside a folder that a sync daemon rewrites underneath the app. SQLite fails this. Its `-wal` and `-shm` sidecars are synced as independent files with no atomicity across the set, and iCloud Drive additionally evicts and partially materializes file contents. The realistic failure is a corrupt database, not a conflict.

JSON files sidestep this: a sync collision produces a *duplicate file* (`stream-x (conflicted copy).json`), which is recoverable. At the ~25–100 streams this app targets (§8), reading every file at startup and holding all state in memory costs single-digit milliseconds. It also makes §7's deferred export a non-feature — the format is already the export.

### Storage layout

```
<sync folder>/Streams/
  streams/<uuid>.json     // one file per stream, including its log
  areas.json              // flat area list + colors
  settings.json           // cadence defaults, digest time, hotkey — NOT synced-critical
  .tmp/                   // scratch for atomic writes; never synced, never watched
```

- **Atomic writes.** Every save writes a scratch file, `fsync`s it, then `rename`s it over the target. A crash or a mid-write sync grab can never observe a half-written stream.
  - Scratch lives in **`.tmp/`, not beside the target.** It only needs to share a *filesystem* with the target for `rename` to be atomic, which `<root>` does — and keeping it out of `streams/` means neither the sync daemon nor our own directory watcher ever sees scratch files appear and vanish. **Add `/.tmp` to `.stignore`** (or the equivalent) so the sync tool skips it outright.
  - The `fsync` before `rename` is not optional: without it a crash can make the rename durable while the contents are not, producing exactly the truncated file the scheme exists to prevent.
  - Verified under concurrent load, not assumed — see `storage.rs`'s `concurrent_readers_never_observe_a_torn_file`, which fails against a naive in-place write (readers catch it at 0 bytes) and passes against this one.
- **Write on change, debounced.** Only the touched stream's file is rewritten, keeping the sync daemon's diff to one small file per edit.
- **Read on start + watch.** Load all files at launch; watch the directory to pick up changes another Mac synced in.

### Conflict policy

Assumed rare (single user, two Macs, rarely both open), but never silent — a tool whose purpose is to prevent silent rot must not silently lose an edit.

- **Scalar fields** (title, state, outcome, deadline, next step, priority): last-write-wins on `lastTouched`.
- **Log entries** (§3.3): union by entry `id`. Append-only with stable IDs means both sides' entries survive — no merge logic can lose one.
- **Conflicted-copy files**: detected by filename pattern at startup and on watch. The app merges by the two rules above, writes the result, logs an automatic entry recording that it happened, and deletes the duplicate. The stream surfaces in the attention view so the merge gets human eyes.

### Data-model notes

- Every entity is UUID-identified. IDs are generated client-side and never reused.
- Fuzzy deadline stored as three fields (`label`, `earliest`, `latest`) on the stream object; the parser is pure TypeScript, unit-testable, and isolated from the UI.
- Log entries are an array on the stream (no cascade-delete concern — they live in the same file). Automatic events and manual notes share a shape with a `kind` discriminator.
- Every stream file carries a `schemaVersion` for forward migrations.

## 7. Out of scope for v1 (explicitly deferred)

- Markdown export and automatic backup snapshots. (JSON export is no longer a feature — §6's storage format is already plain JSON on disk, and the sync folder is a second copy.)
- Full-text search.
- Multi-user / shared streams, contacts integration, task-manager integrations.
- iPhone/iPad app. A Tauri desktop app gives no path to an iOS companion, where SwiftData + CloudKit did. The §4.5 Reminders mirror softens this — the phone gets a read-only glance at every next step owned by me, via Apple's own app — but it is a glance, not the product: no attention view, no log, no review flow, and completion doesn't flow back.
- Two-way Reminders sync (completing on the phone marks the step done in Streams). Deferred deliberately; §4.5's known limitation names the trigger for revisiting it.
- Reminders as a capture inbox (adding to a list creates a parked stream, incl. via Siri). Orthogonal to §4.5's mirror and additive later — the mirror writes, this would read.
- Windows/Linux builds. Tauri makes these cheap later, but §4's UX is designed around the macOS menu bar and is not portable as-designed.
- Attachments, subtasks, recurring steps.

## 8. Success criteria

- Opening the app answers "what needs me today" in under 5 seconds, zero clicks.
- Any stream can answer "what's next, who owns it, by when, toward what outcome" on one screen.
- A returning-after-weeks context reload (via the log) takes under a minute.
- Weekly review of ~25 streams completes in under 15 minutes.
- No stream can silently rot: every stream is always covered by at least one attention trigger (next-step presence, cadence, deadline, wake-up date).
