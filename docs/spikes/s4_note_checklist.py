#!/usr/bin/env python3
"""S4 — Apple Notes checklist HTML probe.

Settles the open question from S1: what HTML does Apple Notes use for native
checklists, and can we create/read checked state via AppleScript? The Phase 2
note model uses robust plain-text ``[ ] / [x]`` checkboxes; native tap-to-check
checkboxes would be a UX upgrade *if* this probe shows they round-trip.

What it does:
  1. Creates a note whose body HTML tries a native checklist
     (``<ul class="checklist">``) plus a plain ``[ ]`` line.
  2. Prints the body back so you can see how Notes stored it.
  3. Asks you to tick the checkbox in the Notes app, then re-reads and prints the
     body so we can see how checked state is represented.

    uv run python docs/spikes/s4_note_checklist.py --account iCloud

Requires the Automation permission (terminal -> Notes). Paste both body dumps
into RESULTS.md so we can decide whether to adopt native checklists.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import textwrap

TITLE = "Streams Spike — S4 checklist (safe to delete)"
BODY = (
    f"<div><h1>{TITLE}</h1></div>"
    '<ul class="checklist"><li>native item A</li><li>native item B</li></ul>'
    "<div>- [ ] plain text item</div>"
)


def osa(script: str, *args: str) -> str:
    proc = subprocess.run(
        ["osascript", "-", *args], input=script, capture_output=True, text=True
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "osascript failed")
    return proc.stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="Apple Notes checklist probe")
    ap.add_argument("--account", default="iCloud")
    args = ap.parse_args()

    note_id = osa(
        textwrap.dedent(
            """
            on run argv
                tell application "Notes" to tell account (item 1 of argv)
                    return id of (make new note with properties {body:(item 2 of argv)})
                end tell
            end run
            """
        ),
        args.account,
        BODY,
    )
    print(f"Created note {note_id}\n")

    get_body = textwrap.dedent(
        """
        on run argv
            tell application "Notes" to return body of note id (item 1 of argv)
        end run
        """
    )
    print("--- body as stored by Notes (note how the checklist was kept) ---")
    print(osa(get_body, note_id))

    input("\nNow tick a checkbox in the Notes app, then press Enter... ")
    print("\n--- body after you ticked it (look for the checked representation) ---")
    print(osa(get_body, note_id))

    print(
        "\nDecision: if native checklist markup is present AND checked state is "
        "distinguishable in the body, native checkboxes are viable. Paste both "
        "dumps into RESULTS.md."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
