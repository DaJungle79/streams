# Streams — Implementation Plan

Companion to `SPEC.md`. Defines project structure, build order, and what "done" means per milestone.

## Prerequisites (before M1)

- [x] **Xcode Command Line Tools** — already present at `/Library/Developer/CommandLineTools`. The only Apple dependency; no App Store, no account.
- [x] **Rust toolchain** — rustup 1.29.0, Rust 1.97.1. Installed with `--no-modify-path`, so **cargo is not on your PATH**: add `. "$HOME/.cargo/env"` to your shell profile, or source it per-shell. (An orphaned `~/.rustup` from June 2025 was left behind by an earlier install whose `~/.cargo` had been deleted; rustup adopted and updated it, 1.87 → 1.97.1.)
- [x] **Node** — v24.7.0, npm 11.5.1.
- [ ] **A sync folder**, decided before M1 because the storage path is configuration, not code. Syncthing is the recommendation: it syncs on file close, has no eviction behaviour, and keeps conflicted copies with a clear naming pattern. iCloud Drive is the riskiest of the three (eviction + partial materialization) — supported, not advised.
- [ ] `git init` in this directory at M1.

**No longer needed:** Xcode itself, an Apple Developer account ($99/yr), notarization, CloudKit dev/prod schema deployment.

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

### M3 — Oversight mechanics
Waiting view grouped by person with "nudge sent". Log timeline with automatic entries for structural events. Check-in actions and cadence editing. Archive with reactivation. Priority pinning everywhere.
**Done when:** SPEC §3.1–3.3 and §5.2–5.3 fully behave; any touch counts as a check-in.
**Size:** ~20%.

### M4 — Weekly review mode
Guided full-screen flow (relevant? → step right? → owner right?), progress, skip/resume, review-counts-as-check-in, and the ">25% overdue" nudge.
**Done when:** a 25-stream review runs end-to-end without touching any other screen.
**Size:** ~10%.

### M5 — macOS surface
Tray icon with attention count via `set_title` and top-5 dropdown. Accessory activation policy + hide-on-close. Global hotkey quick capture with `>area` syntax. Notification scheduling per M0's outcome: milestone/window/wake-up alerts + the single daily digest. Launch-at-login via autostart plugin.
**Done when:** the app is useful without ever opening the main window.
**Size:** ~20%.

### M6 — Sync + ship
Point the storage path at the sync folder. Conflict detection and merge (SPEC §6) with tests covering: concurrent scalar edits, concurrent log appends, and an edit-vs-delete race. Verify on two Macs. App icon, Settings polish, `tauri build`, drag to `/Applications`.
**Done when:** two Macs converge on the same state after concurrent offline edits, with no log entry lost.
**Size:** ~10%. Far cheaper than the CloudKit version of this milestone — no schema deployment, no notarization, no Apple admin.

### M7 — Apple Reminders mirror
`mirrorSet.ts` as a pure, tested projection (active + owner-is-me). Reconciler diffing it against the local ID map. `reminders.rs` osascript layer: create/update/delete in a dedicated `Streams` list. `mirrorToReminders` setting (default off, machine-local). Due dates from milestone dates only — never from fuzzy `earliest` (SPEC §4.5).
**Done when:** completing a step removes its reminder; reassigning a step to someone else removes it; parking a stream removes it; enabling the setting on a second Mac is impossible/warned (single-writer rule); and no duplicate reminders exist after a full startup reconcile.
**Size:** ~8%.

**Placement is flexible.** M7 depends only on §3.1's owner semantics (M3), not on the AttentionEngine — so it can slot in right after M3 if the iPhone glance is what you want soonest. It's last here because it's strictly additive: one-way, isolated behind one module, and nothing else reads from it. It's also the milestone most likely to be deferred indefinitely once the tray badge turns out to be enough.

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
