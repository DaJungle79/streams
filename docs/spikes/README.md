# Phase 0 spikes

Throwaway scripts that de-risk the three fragile Apple integrations **before** we
build the domain around them. Each answers one go/no-go question. They are not
part of the test suite or CI — they need real apps, real data, and interactive
macOS permission grants, so you run them by hand and record the outcome in
[`RESULTS.md`](RESULTS.md).

| Spike | Question | Needs |
|---|---|---|
| `s1_notes.py` | Can we create a Note, read it, detect a user's edit, and write back without clobbering it? (the whole UI model) | Automation (terminal → Notes) |
| `s2_imessage.py` | Can we read inbound iMessages from `chat.db` and send replies? | Full Disk Access (read `chat.db`) + Automation (terminal → Messages) |
| `s3_reminders.py` | Can we create reminders and read completion back? | Reminders access (TCC prompt) |

## Permissions (grant before running)

These are granted to the **terminal app** you launch the scripts from (Terminal,
iTerm, VS Code, etc.), not to Python itself — TCC attributes the access to the
parent app.

- **Automation** — first run of `s1`/`s2` pops "<terminal> wants to control
  Notes/Messages". Allow it. Manage later in System Settings → Privacy &
  Security → Automation.
- **Full Disk Access** — required to read `~/Library/Messages/chat.db` for `s2`
  inbound. Add your terminal app in System Settings → Privacy & Security → Full
  Disk Access, then fully quit and reopen the terminal.
- **Reminders** — `s3` triggers the access prompt via EventKit on first run.

## Running

```sh
# s1 — Apple Notes round-trip (interactive)
uv run python docs/spikes/s1_notes.py --account iCloud

# s2 — iMessage (read inbound; send outbound)
uv run python docs/spikes/s2_imessage.py --read 10
uv run python docs/spikes/s2_imessage.py --send "+15555550123" --text "hi"

# s3 — Reminders (needs the apple dependency group)
uv sync --group apple
uv run python docs/spikes/s3_reminders.py --create
uv run python docs/spikes/s3_reminders.py --list
```

Each script creates clearly-labelled "safe to delete" test data. Clean it up
after. When done, fill in [`RESULTS.md`](RESULTS.md) with GO / NO-GO / PARTIAL
and any gotchas (e.g. `attributedBody` coverage for iMessage), which feed the
Phase 2/4/5 bridge design.
