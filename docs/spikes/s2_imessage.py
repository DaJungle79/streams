#!/usr/bin/env python3
"""S2 — iMessage two-way spike (go/no-go for the chat channel).

Validates the two halves of the iMessage channel:
  - INBOUND: read recent messages from the Messages SQLite store (chat.db),
    including sender handle, direction, timestamp, and text.
  - OUTBOUND: send a message via ``osascript`` (AppleScript).

Inbound is the fragile half: ``chat.db`` requires **Full Disk Access** for the
terminal app running this script (System Settings -> Privacy & Security -> Full
Disk Access). Newer macOS often stores message text in the ``attributedBody``
blob rather than ``message.text``; this spike reports when ``text`` is NULL so we
know whether a blob decoder is needed.

Outbound requires the **Automation** permission (terminal -> Messages) and a
signed-in iMessage account.

Run interactively:

    uv run python docs/spikes/s2_imessage.py --read 10
    uv run python docs/spikes/s2_imessage.py --send "+15555550123" --text "hi from streams"

Throwaway spike — findings go in RESULTS.md.
"""

from __future__ import annotations

import argparse
import sqlite3
import subprocess
import sys
import textwrap
from pathlib import Path

CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"

# Apple stores message.date as nanoseconds since 2001-01-01 (Mac absolute time).
RECENT_SQL = """
SELECT
    message.ROWID                              AS rowid,
    datetime(message.date / 1000000000 + strftime('%s', '2001-01-01'),
             'unixepoch', 'localtime')          AS ts,
    message.is_from_me                          AS is_from_me,
    handle.id                                   AS handle,
    message.text                                AS text,
    (message.attributedBody IS NOT NULL)        AS has_attributed_body
FROM message
LEFT JOIN handle ON message.handle_id = handle.ROWID
ORDER BY message.date DESC
LIMIT ?;
"""


def read_recent(limit: int) -> list[sqlite3.Row]:
    if not CHAT_DB.exists():
        raise FileNotFoundError(f"chat.db not found at {CHAT_DB}")
    # Read-only; immutable avoids lock contention with the live Messages app.
    uri = f"file:{CHAT_DB}?mode=ro&immutable=1"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    try:
        return list(con.execute(RECENT_SQL, (limit,)))
    finally:
        con.close()


def send_message(handle: str, text: str) -> None:
    script = textwrap.dedent(
        """
        on run argv
            set theHandle to item 1 of argv
            set theText to item 2 of argv
            tell application "Messages"
                set svc to 1st service whose service type = iMessage
                send theText to buddy theHandle of svc
            end tell
        end run
        """
    )
    proc = subprocess.run(
        ["osascript", "-", handle, text],
        input=script,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "osascript failed")


def main() -> int:
    ap = argparse.ArgumentParser(description="iMessage two-way spike")
    ap.add_argument("--read", type=int, metavar="N", help="read the last N messages")
    ap.add_argument("--send", metavar="HANDLE", help="phone/email to send to")
    ap.add_argument("--text", default="hello from the streams spike")
    args = ap.parse_args()

    if not args.read and not args.send:
        ap.error("pass --read N and/or --send HANDLE")

    if args.read:
        try:
            rows = read_recent(args.read)
        except Exception as exc:  # noqa: BLE001 — spike: surface any failure plainly
            print(f"INBOUND FAILED: {exc}")
            print("If this is a permissions error, grant Full Disk Access to your terminal.")
            return 1
        null_text = sum(1 for r in rows if r["text"] is None)
        print(f"Read {len(rows)} messages ({null_text} with NULL text):\n")
        for r in rows:
            who = "me" if r["is_from_me"] else (r["handle"] or "?")
            body = r["text"] if r["text"] is not None else "<in attributedBody blob>"
            print(f"  [{r['ts']}] {who:>20}: {body}")
        if null_text:
            print(
                "\nNOTE: some rows have NULL text -> a blob decoder for "
                "attributedBody is needed for full inbound coverage."
            )

    if args.send:
        try:
            send_message(args.send, args.text)
            print(f"\nSent to {args.send}: {args.text!r}")
        except Exception as exc:  # noqa: BLE001
            print(f"OUTBOUND FAILED: {exc}")
            return 1

    print("\nGO if: inbound rows include your handle/text/direction AND outbound "
          "delivered. Record in RESULTS.md (note attributedBody coverage).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
