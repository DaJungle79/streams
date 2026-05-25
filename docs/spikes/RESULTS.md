# Spike results

Fill in after running each spike. Verdict: **GO** / **NO-GO** / **PARTIAL**.
These outcomes gate and shape the Phase 2/4/5 bridge work.

## S1 — Apple Notes round-trip

- Date / macOS version:
- Ran by:
- Verdict:
- Could we create + read + get a stable id?
- Was an external user edit detectable (mod-date / body hash)?
- Was the user's edited text recoverable from the body HTML?
- Did write-back preserve the user's text?
- Gotchas (HTML body quirks, `note id` addressing, checklist handling):
- Decision / implication for Phase 2:

## S2 — iMessage two-way

- Date / macOS version:
- Ran by:
- Verdict:
- Inbound: did `chat.db` read work (after Full Disk Access)?
- What fraction of recent rows had NULL `text` (need `attributedBody` decoder)?
- Outbound: did the AppleScript send deliver?
- Gotchas (handle matching, group threads, FDA quirks):
- Decision / implication for Phase 5 (incl. outbound-only fallback?):

## S3 — Apple Reminders

- Date / macOS version:
- Ran by:
- Verdict:
- Access granted via EventKit?
- Reminder created + saved in the default list?
- Completion status readable after checking one off?
- Gotchas (full vs. legacy access API, default list availability):
- Decision / implication for Phase 4:
