# Streams — Implementation Plan

Companion to `SPEC.md`. Defines project structure, build order, and what "done" means per milestone.

## Prerequisites (before M1)

- [x] **Xcode Command Line Tools** — already present at `/Library/Developer/CommandLineTools`. The only Apple dependency; no App Store, no account.
- [x] **Rust toolchain** — rustup 1.29.0, Rust 1.97.1. Installed with `--no-modify-path`, so **cargo is not on your PATH**: add `. "$HOME/.cargo/env"` to your shell profile, or source it per-shell. (An orphaned `~/.rustup` from June 2025 was left behind by an earlier install whose `~/.cargo` had been deleted; rustup adopted and updated it, 1.87 → 1.97.1.)
- [x] **Node** — v24.7.0, npm 11.5.1.
- [x] **A sync folder** — Syncthing 2.1.2, store at `~/Streams`, folder id `streams`, `/.tmp` ignored. Chosen over iCloud Drive and OneDrive because it never uses placeholders: always full local copies. That matters more than it sounds — see below.
- [x] `git init` — done at M1; remote `DaJungle79/streams`.

**No longer needed:** Xcode itself, an Apple Developer account ($99/yr), notarization, CloudKit dev/prod schema deployment.

### Why not iCloud Drive for the store

Not a preference — a specific failure. When iCloud evicts a file it replaces it with a hidden `.name.icloud` placeholder and **the original filename disappears from the directory listing**. `read_all_streams` would return zero streams and the app would open showing an empty store. `Optimize Mac Storage` is on for this user, so the mechanism is armed, not hypothetical. OneDrive's Files On-Demand has the same shape. Syncthing has no placeholder concept at all.

The inversion worth remembering: **eviction is fatal for a live store and harmless for a backup**, because a backup is cold by definition. Same property, opposite conclusions — which is why snapshots go to iCloud (`backup.rs`) and the store does not.

`~/Streams` is deliberately *not* under `~/Documents`: Desktop & Documents iCloud sync is on for this user, and two sync engines fighting over the same files is a corruption story with no upside.

## M0 — Signing & permissions spike ✅ DONE

Both unknowns in this stack were the same question wearing two hats: **macOS grants privileges to a code signature, and an ad-hoc build's signature changes when the binary changes.** Run against a throwaway Tauri app in `/Applications` (Tauri 2.11, Rust 1.97.1, macOS 15/Darwin 25.5).

**Verdict: the stack is viable as specced. No SPEC change needed.** One dev-loop annoyance, one recommended mitigation.

### Findings

**Q1 — Notifications fire from an ad-hoc-signed build. ✅**
Confirmed by observation from `/Applications`. `tauri-plugin-notification` pulls in `notify-rust` → `mac-notification-sys`. The `terminal-notifier` fallback in §4.3 is **not needed** — drop it from the risk register.

**Q2 — Reminders via `osascript` works. ✅**
TCC prompt appeared on first Apple Event and granted (`kTCCServiceReminders`, `auth_value=2` for `com.ivailoivanov.m0-spike`). `NSAppleEventsUsageDescription` placed in `src-tauri/Info.plist` is **merged into the bundle automatically** — no bundler config required. All of M7's verbs compile against Reminders' real dictionary (`list`, `reminder`, `id`, `completed`, `delete list`), so create/update/delete-by-id is sound.

**Q3 — Ad-hoc builds re-prompt TCC whenever the binary changes. ⚠️ Confirmed, but narrower than feared.**

The mechanism, read directly out of `TCC.db` rather than inferred:

| App | Requirement TCC stored |
|---|---|
| `m0-spike` (ad-hoc) | `cdhash H"499bcf…"` |
| `Terminal` (properly signed) | `identifier "com.apple.Terminal" and anchor apple` |

An ad-hoc signature's designated requirement is *only* a cdhash — no identifier clause, no anchor. TCC pins the grant to that exact binary hash, so a changed binary is, to TCC, a different app.

Measured: a real code change moved the cdhash `499bcf…` → `9fdb83…`. **But Rust's release builds are deterministic** — reverting the change restored `499bcf…` exactly, and a comment-only edit produced a byte-identical binary and an unchanged hash. So the hash is content-addressed, not random-per-build. Two consequences:

- **Dev loop:** every *meaningful* edit invalidates the grant → re-prompt. Cosmetic edits don't.
- **Shipped build:** the hash freezes. The grant sticks forever. **End users are never affected.**

### Decision

Dev-time friction only, so §4.5 and §4.3 stand as written. Recommended fix when M7 work starts: **a self-signed code-signing certificate**, which is exactly what the table above shows working for Terminal — it swaps the cdhash-pinned requirement for an identifier-based one that survives rebuilds. Deferred until M7 rather than done now, because it writes to the login keychain and nothing before M7 needs it.

Fallbacks that turned out to be unnecessary: `terminal-notifier` (Q1 passed), tray-title-only alerting (Q1 passed).

## Architecture at a glance

Two pure, heavily-tested cores with a React UI around them — unchanged in intent from the Swift plan, just relocated:

- **FuzzyDateParser** — text → `{label, earliest, latest}`. Pure TypeScript, no dependencies.
- **AttentionEngine** — `Stream[] + today's date → AttentionItem[]` (the five trigger groups from SPEC §2). Pure function; the entire product promise lives here, so it gets the densest tests.

Both are plain TS modules with no Tauri imports, so they run under Vitest in milliseconds with no app, no window, and no mocking.

**The Rust side stays deliberately thin.** It owns only what the webview cannot: tray icon and title, global hotkey registration, autostart, and atomic file writes. It holds no product logic and no domain types beyond a path and a string. This keeps the Rust learning curve to roughly four plugin registrations and one file-write command, and it means the parser and engine are testable without touching Rust at all.

The trade: the tray count is computed in TS and pushed to Rust via a command, so a webview must stay alive — hence SPEC §4.4's hidden window. `close` is intercepted and hides instead of quitting; quitting is a tray menu item.

## Project structure

```
src-tauri/
  src/
    main.rs                 // plugin registration, tray, ActivationPolicy::Accessory
    tray.rs                 // icon + set_title(count), top-5 menu
    storage.rs              // atomic write (temp + rename), dir read, dir watch
    hotkey.rs               // global shortcut → show capture window
    reminders.rs            // osascript subprocess: create/update/delete in the Streams list
  tauri.conf.json           // windows: main (hidden-on-close), capture (floating, undecorated)
                            // + Info.plist: NSAppleEventsUsageDescription
src/
  main.tsx
  core/                     // NO Tauri imports — pure, fully unit-tested
    fuzzyDateParser.ts
    attentionEngine.ts      // + AttentionItem, AttentionReason
    checkInPolicy.ts        // cadence math, waiting-too-long thresholds
    merge.ts                // conflict resolution (SPEC §6): LWW scalars, union logs
    mirrorSet.ts            // Stream[] → MirrorItem[]: the pure §4.5 projection
  models/
    stream.ts               // types + zod schema + schemaVersion
    area.ts
    logEntry.ts
  storage/
    repository.ts           // load all / save one, debounced; wraps the Rust commands
    conflicts.ts            // detect + resolve conflicted-copy files
  services/
    notifications.ts
    digest.ts               // the single daily check-in digest timer
    remindersMirror.ts      // reconcile: diff mirrorSet vs reminder-map, drive reminders.rs
  views/
    Sidebar/                // areas + view switcher
    Attention/              // main screen: grouped attention list + row actions
    StreamList/             // full list per area (the "database" view)
    StreamDetail/           // all fields + log timeline
    Waiting/                // grouped by person
    Review/                 // weekly review flow
    Archive/
    Capture/                // floating quick-capture panel
    Settings/
tests/
  fuzzyDateParser.test.ts
  attentionEngine.test.ts
  checkInPolicy.test.ts
  merge.test.ts
  mirrorSet.test.ts
```

Note `~/Library/Application Support/Streams/reminder-map.json` is machine-local and deliberately outside the sync folder (SPEC §4.5).

The mirror splits the same way everything else does: `mirrorSet.ts` is a pure function (`Stream[] → MirrorItem[]`) that decides *what should exist* and is fully unit-tested; `remindersMirror.ts` diffs that against the ID map and decides *what to change*; `reminders.rs` only shells out. The interesting logic never touches AppleScript, so it's testable without Reminders running.

## Milestones

### M1 — Skeleton (foundation) ✅ DONE
Tauri v2 (React 19, Vite 7, zod 4, vitest 4). Models + schemas, atomic-write storage, debounced repository, sidebar/list/detail with full CRUD. Verified: CRUD across areas works, data survives relaunch, and the torn-file guarantee is tested rather than asserted.
**Size:** ~15% of the work. 33 tests (23 TS, 10 Rust). Binary ~10MB.

Decisions made while building, worth carrying forward:

- **Invariants are enforced only where absence lets a stream rot silently.** `parked ⇒ wakeUpDate` and `waiting ⇒ waitingSince` are schema-enforced, because without them nothing ever resurfaces the stream and §2.4 can't be computed. `active ⇒ nextStep` is deliberately *not* enforced: SPEC §1 says an absent next step is **flagged**, not invalid — it is attention group §2.1. Enforcing it would make the app refuse to load exactly the streams it most needs to shout about.
- **`withState()` is the only sanctioned way to change state.** A naive `{...s, state: 'parked'}` produces a value the schema rejects, so the transition helper supplies the required fields. It also *preserves* an existing `waitingSince` — resetting that clock on an unrelated edit would silently forgive an overdue wait.
- **Scratch moved out of `streams/`** into `<root>/.tmp` — see the SPEC §6 correction. Same filesystem (so `rename` stays atomic), invisible to the sync daemon and our watcher.
- **Invalid files are surfaced in the UI, never dropped.** The repository returns them separately rather than swallowing a parse failure.
- **Directory watcher deferred.** `notify` is a dependency but unwired: nothing writes to the store except this app until M6 points it at a sync folder. Wire it there, where it has a reason to exist.
- **`"targets": ["app"]`** — see the DMG risk row.

### M2 — The brain (parser + attention engine) ✅ DONE
FuzzyDateParser (58 tests) with inline interpretation in the deadline field. AttentionEngine (38 tests) producing the five grouped trigger lists. Attention view is the launch screen, with row actions and the §2 empty state.
**Size:** ~25%. 129 tests total (119 TS, 10 Rust).

Interpretations of SPEC §2 that the code now commits to:

- **One stream, one reason.** §2 groups by reason and each row shows "the reason it's here" — singular — so a stream tripping several appears once, under the most actionable. Precedence: `waking-up > no-next-step > deadline-window > waiting-too-long > check-in-overdue`. Check-in ranks last because it's the weakest claim ("you haven't looked") and *any* touch satisfies it (§3.2), so acting on any other reason clears it anyway. This also makes §4.1's tray count — "number of streams" — just the item count, so the tray can never drift from the view.
- **A parked stream is silent on every trigger but its wake-up.** Dormancy is deliberate; nagging about a deadline you parked past is the noise that gets the whole view tuned out.
- **A missed wake-up or an overdue milestone still fires.** Passing the date must never silence a trigger — that's rot with extra steps.
- **The deadline detail shows the label, never the raw date.** "end of Q3 2026" is what the user meant; `2026-09-01` is an implementation detail they explicitly didn't commit to.
- **"Step done" prompts for the replacement by dropping the stream into §2.1**, not by opening a modal. A dialog you can dismiss lets the stream go quiet; an attention row doesn't.
- **The parser declines rather than guesses.** Ambiguous input (`03/04/2026` — 3 April or 4 March?) returns null and falls back to manual pickers. §1 makes that fallback cheap, which is exactly what buys the right to be strict.

#### ⚠️ Known gap in SPEC §8

§8 claims *"every stream is always covered by at least one attention trigger."* It isn't true as specced, and the engine faithfully reproduces the hole:

> An **active** stream with a next step, **no cadence**, no target deadline and no milestone trips nothing — forever. Its next step can be two years stale and it never surfaces.

Reachable through the M1 UI today (cadence is optional and defaults to none). Pinned by a test in `attentionEngine.test.ts` so it stays a known choice rather than a surprise. Candidate fixes, in rough order of preference:

1. **A default cadence in `settings.json`** — §6's storage layout already anticipates "cadence defaults", so every stream inherits one unless explicitly opted out. Closes the hole with no new concepts.
2. **A stale-next-step trigger** — `nextStep.setAt` is already stored; fire when a step has gone untouched for N days. Catches the real failure (a step nobody's moved) rather than proxying it through "you haven't looked".
3. **Make cadence mandatory** — simplest, but forces a number onto every idea you jot down.

### M3 — Oversight mechanics ✅ DONE
Waiting view grouped by person with "nudge sent". Automatic log entries for structural events. Archive with reactivation. Name autocomplete. Settings file.
**Size:** ~20%. 161 tests (151 TS, 10 Rust).

**§8's gap is closed.** `checkInCadenceDays: null` now means **inherit `settings.defaultCheckInCadenceDays`** (30) rather than "no cadence", so every live stream is covered by something without the user having to remember. Setting the global to null reopens the hole — allowed, but now a deliberate choice rather than an accident. A test sweeps every stream shape reachable through the UI and asserts each one trips a trigger; the one legitimate silence is a parked stream sleeping toward a future wake-up, which is a promise to resurface, not rot.

Decisions:

- **`structuralEvents(before, after)` is a pure diff**, so the log can't drift depending on which screen made the change, and `updateStream` is the single write path that applies it.
- **The log is deliberately narrow.** State, step text, owner, and deadline *label* changes are logged. Renaming the stream, retyping the outcome, or nudging a cadence are not — the log's whole value is that everything in it is worth reading, and §8's one-minute context reload dies under bookkeeping noise.
- **Deadline changes log the label, not the window.** "end of Q3 2026 → mid October" is the decision; `2026-10-11` is the parser's arithmetic. A window that moves under an unchanged label logs nothing — the user decided nothing.
- **Waiting groups by person, not stream**, because chasing Bob about four things is one conversation. People sort by longest wait: the oldest is likeliest to have been quietly dropped.
- **"Nudge sent" resets `waitingSince`.** You've acted, so §2.4's clock restarts; the log keeps the real history.

### M4 — Weekly review mode ✅ DONE
Guided full-screen flow, progress, skip, resume, and the ">25% overdue"/weekly nudge.
**Size:** ~10%. 180 tests (170 TS, 10 Rust).

- **Resumability is one timestamp, not a list.** `settings.activeReviewStartedAt` is the entire persisted state: a stream is reviewed-this-pass when `lastTouched >= startedAt`. Nothing to keep in sync, nothing to merge across two Macs at M6, and it survives a restart for free. It also means an edit made *outside* the review counts — which is §3.2's own rule (any touch satisfies a check-in), not a loophole.
- **Skip is session-local.** "Not now" ≠ "reviewed". Persisting a skip would let a stream dodge an entire pass silently, which is the thing §3.4 exists to break. Skipped streams remain overdue on their own cadence.
- **`lastReviewAt` is stamped even on an abandoned pass.** The weekly nudge asks "when did you last sit down with these", and a half-finished pass counts. What you skipped is still caught by §2.
- **The queue is high-priority-first, then stalest**, so a review abandoned halfway still covered what mattered most.
- **The nudge is dismissed by acting, not by an X.** A banner you can wave away is one you stop seeing.
- **"More than 25%" is literal** — exactly 25% doesn't fire — and 0 active streams is not 100% overdue. An empty app must never nag.

### M5 — macOS surface ✅ DONE (needs on-device confirmation)
Tray with count + top-5, accessory policy, hide-on-close, ⌥⌘S capture, notifications, launch-at-login.
**Size:** ~20%. 205 tests (195 TS, 10 Rust).

- **The tray count comes from the same array the view renders.** `AmbientSync` passes `attentionItems(...)` to both, so §4.1's "number of streams" cannot drift from what's on screen. The old PLAN risk about menu-bar badges is retired: `set_title` puts text beside the icon, which is a first-class API, not a workaround. Zero shows an **empty** title, never a grey "0" — §2's empty state is meant to feel like a reward.
- **Notifications are keyed and remembered**, day-stamped in `localStorage`: one banner per event, ever. A tool that double-notifies gets its notifications switched off, and then §4.3 is worth nothing. Deliberately machine-local — two Macs each notifying you once is correct, since you're sitting at one of them; syncing it would let whichever Mac saw it first silence the other.
- **Close hides, it never quits** (§4.4). The tray count and digest are computed in the webview, so killing it would silently stop the two features that make the app ambient. Quit is in the tray menu.
- **`--autostart` distinguishes a login launch** from one you asked for, so §4.4's "main window stays closed" doesn't suppress the window when you open the app yourself.
- **Capture never truncates a thought.** `>x` is only syntax if `x` resolves to a real area; otherwise the `>` was punctuation and the whole text is the title. Without that rule "revenue > costs" — an ordinary title — becomes "revenue". Since §4.2 defers triage anyway, the worst case is an unfiled stream, never a mangled one.

Build fixes worth remembering: `tauri` needs `features = ["tray-icon"]` (not default), `Shortcut::new` isn't `const`, and `set_activation_policy` needs `&mut app` so it must precede `app.handle()`.

**Not yet confirmed on device** (needs a human): the tray icon rendering and its count, ⌥⌘S summoning the panel, a notification actually appearing from this build, and the login-item round trip. M0 proved notifications *can* fire from an ad-hoc build; it did not prove this app's wiring is right.

### M6 — Sync + merge ✅ DONE (single-machine; two-Mac run still pending)
Configurable store root, conflict detection, merge, folder picker.
**Size:** ~10%. 231 tests (217 TS, 14 Rust). As predicted, far cheaper than the CloudKit version — no schema deployment, no notarization, no Apple admin.

- **Scalars are last-write-wins; the log is union-by-id.** The asymmetry is the point: a lost title edit is annoying and retypable, a lost log entry is unrecoverable and the log is the stream's memory (§3.3, §8). Because entries are append-only with stable ids, union isn't a heuristic — it's exactly correct.
- **State conflicts resolve wholesale, not field-by-field.** Cherry-picking across sides could produce parked-with-no-wake-up: a stream the schema rejects *and* that would rot silently. The winner's state travels with its own supporting fields.
- **Merges are loud.** A `conflict-merged` entry is appended whenever a side actually lost field values — but *not* when the sides differed only by log entries, which is an ordinary sync, not a conflict. A merge you can't see is indistinguishable from data loss you haven't noticed.
- **Merge → write → only then delete.** If the write fails, the conflicted copy stays on disk and we retry next launch. A duplicate file is a nuisance; a deleted one is gone.
- **Conflict filenames are detected by leading uuid, not by vendor pattern.** Dropbox, Syncthing and iCloud all decorate the *end* of the stem, so taking the leading uuid handles three known formats and the fourth we haven't met. `delete_conflict` re-derives that rather than trusting the caller, so a merge bug can't eat a real stream file.
- **The store root is the one setting that can't live in `settings.json`** (which lives inside the store) and **must not sync** (each Mac has its own path to the same folder). It sits alone in `local-config.json` in app-data — same family as M7's reminder-map.
- **The default root stays app-data.** Turning on sync is a choice, never one an upgrade makes for you.

Verified end-to-end against real files: a Dropbox-style conflicted copy was detected, merged (newer side's fields won, **both** sides' log entries survived, merge logged), and deleted. `.tmp` left clean.

**Not yet done:** the actual two-Mac run, and `/.tmp` in a real `.stignore`.

### M7 — Apple Reminders mirror ✅ DONE (needs the TCC round-trip confirmed)
`mirrorSet` projection, planner, osascript layer, machine-local map, Settings toggle.
**Size:** ~8%. 258 tests (242 TS, 16 Rust).

- **The split held.** `mirrorSet.ts` decides *what should exist* (25 tests, no Apple Events); `remindersMirror.ts` diffs it against the map; `reminders.rs` only shells out. The interesting half is testable with Reminders.app closed, which is what PLAN promised.
- **A fuzzy deadline never becomes a due date.** Only a milestone — §1's one concrete date — does. "end of Q3 2026" is a window; turning it into `2026-09-01` would have your phone nagging on a date you never chose. The label rides in the notes instead.
- **The fingerprint covers only what the reminder displays**, so a cadence tweak or a priority flag can't churn Reminders.
- **`date_expr` builds dates field by field.** `date "2026-09-14"` parses against the *user's locale* — same string, different day on en-GB vs en-US, or an outright failure. Setting year/month/day explicitly is the only locale-proof route. 09:00, because a reminder due at midnight is already nine hours overdue by the time you look.
- **`escape()` closes an injection hole.** Notes are multi-line and user-authored; a stream titled `" & (do shell script "…") & "` would otherwise be executable. Tested.
- **The map is written after every operation**, not once at the end: if the app dies mid-reconcile, a map that already records what it created is the difference between resuming and duplicating everything.
- **`healMap` drops entries whose reminder is gone.** Delete a mirrored reminder on your phone and the map would otherwise point at a ghost — never re-created (the map says it exists), never noticed (updates just fail). That would make a stream silently missing from a surface you rely on, which is the one thing the app promises can't happen.
- **Switching off tears down what it created.** A Reminders list that quietly stops tracking reality is worse than none, because it still looks authoritative.
- **Default off, machine-local** (§4.5's single-writer rule). Verified: with the mirror off the app sends no Apple Event at all — no TCC entry, no list, no map.

**Not yet confirmed** (needs a human): the TCC prompt on first enable, a reminder actually appearing in a `Streams` list, and the delete-on-complete round trip. M0 proved `osascript`→Reminders works from an ad-hoc build; it didn't prove this wiring.

### Prior-art note

The archived [predecessor](https://github.com/DaJungle79) (`~/Projects/streams-legacy-2026-05`) implemented this against **EventKit** and got `isCompleted()` read-back working — so two-way sync is proven feasible on this machine if §7's deferral is ever revisited. Its S3 spike also found that `defaultCalendarForNewReminders()` can resolve to a list you aren't viewing, so a reminder saves but "doesn't appear". That's why `LIST_NAME` is a dedicated list here and never the default — the same conclusion §4.5 reached independently.

## Order rationale

- **M0 first** because it holds the only two unknowns that could force a spec change, and it's two hours.
- Parser + engine early (M2) because everything downstream renders their output; UI built before them gets rebuilt.
- Sync last (M6), but for the opposite reason to the old plan. CloudKit was last because it was *irreversible* (additive-only production schema). File sync is last because it's merely *the least interesting* — it's a path change plus merge logic. Nothing about M1's models is constrained by it, so there's no "bake the constraints in early" requirement anymore. This is the single biggest simplification from the stack change.
- Menu bar/notifications (M5) after oversight (M3) because they surface AttentionEngine output; they'd be empty shells earlier.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| ~~Notifications may not fire from an unsigned build~~ | **RETIRED by M0.** They fire from an ad-hoc-signed build in `/Applications`. No fallback needed. |
| ~~TCC re-prompts for Reminders access on every rebuild~~ | **DOWNGRADED by M0** to dev-loop friction. Confirmed real (ad-hoc DR is cdhash-only), but only on binary-changing edits, and never for a shipped build — Rust's deterministic builds freeze the hash. Fix at M7: self-signed cert for an identifier-based requirement. |
| **Duplicate reminders if both Macs mirror** | Single-writer rule (SPEC §4.5): one designated Mac, setting default off, ID map held outside the sync folder. Reminders' own iCloud sync makes a second writer pointless anyway. |
| Reminders AppleScript is slow | Mirror set is a handful of items; reconciliation is off the interaction path and runs on change, not on a poll. EventKit is the escape hatch behind the same one-module interface. |
| One-way mirror diverges when a reminder is ticked on the phone | Accepted and documented (SPEC §4.5). The app does not resurrect the reminder. If it becomes a habit, that's the trigger to build two-way — a known, scoped upgrade, not a surprise. |
| **Sync conflicts lose an edit** | Per-file JSON, so blast radius is one stream, never the whole store. LWW scalars + union-by-id logs. Conflicts are merged loudly (auto log entry + surfaced in attention), never silently. Syncthing over iCloud Drive. |
| **Sync daemon grabs a half-written file** | Never write in place. Temp file in the same directory + atomic `rename`. Tested explicitly at M1. |
| Gatekeeper blocks the unsigned build | `xattr -dr com.apple.quarantine /Applications/Streams.app`, or right-click → Open once. Only affects a self-built app on your own machines. |
| **Tauri's DMG bundler has side effects on the build machine** | Observed at M1, not theorised: with `"targets": "all"`, `tauri build` silently created `/Applications/Streams.app` **and executed it** (it seeded a real store 49s into the build). The DMG step mounts a volume whose root holds an `Applications -> /Applications` symlink and drives Finder across it. The produced DMG itself was well-formed — the pollution is a side effect, not a broken artifact. **Mitigation: `"targets": ["app"]`**, set at M1; verified that the build then touches neither `/Applications` nor the store. Revisit only if M6 ever wants a DMG, which a personal build does not. |
| Hidden webview keeps the app in memory all day | It's the cost of computing the tray count in TS. Tauri's WKWebView idles far lighter than Electron; if it matters, the engine can move to Rust later — it's a pure function with a test suite, which is exactly the thing that ports safely. |
| Fuzzy-date grammar creep | Parser is isolated + test-first; unparseable input falls back to manual pickers, so gaps are inconvenient, not blocking. |
| No iOS path (SPEC §7) | Substantially mitigated by M7's Reminders mirror — the phone gets a glance at every next step you own, through Apple's own app, for ~8% of the work rather than a second codebase. Still not the product (no attention view, no log, no review). The JSON format keeps the data portable if a real iOS app ever becomes worth it. |

## Testing policy

Unit tests are mandatory for `src/core/` (parser, engine, check-in policy, **merge**, **mirrorSet**) — pure functions, cheap to test, and they encode the product's promises. `merge.ts` joins the mandatory list because sync conflicts are the new stack's data-loss surface and are near-impossible to reproduce by hand. `mirrorSet.ts` joins it because the alternative is testing §4.5's rules by hand against a live Reminders.app, which is slow and unrepeatable — as a pure projection it costs nothing to cover exhaustively. Views and services are verified manually per milestone checklist; no UI-test suite in v1.
