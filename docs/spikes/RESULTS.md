# Spike results

Outcomes of the Phase 0 de-risking spikes. Verdict: **GO** / **NO-GO** / **PARTIAL**.
These gate and shape the Phase 2/4/5 bridge work.

Run: 2026-05-25, macOS 26.5, by Ivo. **All three GO.**

## S1 — Apple Notes round-trip — GO

- Create + read + stable id via `osascript`: works.
- External user edit detectable (mod-date / body hash) and edited text recoverable
  from the body HTML: works.
- Write-back via `set body of note id` works.
- Implication for Phase 2: the render/reconcile loop is viable on Apple Notes.
  Reconciler will parse the body HTML; confirm checklist (`<ul>`/checkbox) markup
  shape when building the renderer.

## S2 — iMessage two-way — GO

- Outbound (AppleScript send): works, but **only** with the form
  `send <text> to buddy <handle> of <service>`. The earlier
  `participant <handle> of svc` form — and naming a variable `buddy` (a reserved
  Messages class) — fails with `-10003` "Access not allowed". Locked in the
  working form in `s2_imessage.py`.
- Inbound (`chat.db` read): works with **Full Disk Access** on the terminal app.
- OPEN: `attributedBody` coverage — confirm from a `--read N` run how many recent
  rows have NULL `message.text` (newer macOS stores body in the blob). If
  significant, Phase 5 needs an `attributedBody` decoder for full inbound text.
- Implication for Phase 5: two-way is viable; keep outbound-only as the fallback.

## S3 — Apple Reminders — GO

- EventKit access (`requestFullAccessToRemindersWithCompletion:`) granted.
- Create + save to the default list: works.
- Completion status readable back (`isCompleted()`): works.
- Gotcha: `defaultCalendarForNewReminders()` can resolve to a list/account you
  aren't viewing, so a created reminder "doesn't appear" though save succeeded.
  Spike now prints the target list + account; Phase 4 should let config pin an
  explicit list rather than rely on the default.
- Implication for Phase 4: push + completion-back loop is viable.
