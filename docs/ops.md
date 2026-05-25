# Operations

How to install, run, back up, and monitor the Streams daemon on the Mac mini.

## First-time setup

```sh
uv sync --group apple          # base + dev + the Apple integration deps (pyobjc)
uv run streams setup           # prompts for agent name, API key, handle, etc. -> config.yaml
```

`config.yaml` is git-ignored and holds all single-user identity (agent name,
Claude API key, iMessage handle, Notes account, data-repo path). This is the only
place that identity lives — keeping multi-tenancy a deployment concern, not a
refactor.

Grant the macOS permissions the bridges need (see `docs/spikes/README.md`):
Automation (Notes + Messages), Reminders access, and **Full Disk Access** for
the terminal app (to read `chat.db` for inbound iMessage).

## Running the daemon

```sh
uv run streams daemon run        # foreground: scheduled passes + poll loop
uv run streams daemon pass       # run one scheduled pass now (ingest -> think -> project)
uv run streams daemon tick       # run one poll tick now (reconcile edits, completions, replies)
```

The daemon runs a poll tick every `poll_interval_seconds` and a full scheduled
pass at each of `pass_times` (once per day per time). A failing tick is logged and
the loop continues — one failure never kills the daemon.

### launchd (keep it alive)

```sh
uv run streams daemon install    # writes ~/Library/LaunchAgents/com.streams.daemon.plist
launchctl load ~/Library/LaunchAgents/com.streams.daemon.plist
```

The plist sets `RunAtLoad` + `KeepAlive`, so launchd starts the daemon at login
and restarts it if it exits. Logs go to `~/Library/Logs/streams.daemon.log`.
To stop: `launchctl unload ~/Library/LaunchAgents/com.streams.daemon.plist`.

## Health & cost

```sh
uv run streams health            # probe Notes / Reminders / iMessage; nonzero exit on failure
uv run streams report --days 7   # weekly cost + agent-suggestion (noise) summary from the meta ledger
```

Each scheduled pass also records a health line and token/cost usage to the
dormant `meta` stream, which `report` aggregates. Review weekly before increasing
agent autonomy.

## Backup & restore

Markdown-in-git is the source of truth, so backup is a git push and restore is a
git clone.

```sh
# one-time: point the data repo at a private remote
git -C ~/streams-data remote add origin <private-repo-url>
git -C ~/streams-data push -u origin main

# thereafter
uv run streams backup            # git push

# restore on a new machine
git clone <private-repo-url> ~/streams-data
```

`.index.sqlite` and `.render/` are git-ignored (disposable — rebuilt from
markdown). `config.yaml` is git-ignored too, so the API key is never pushed;
re-run `streams setup` (or copy `config.yaml` over a secure channel) on restore.
