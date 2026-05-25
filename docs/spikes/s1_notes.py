#!/usr/bin/env python3
"""S1 — Apple Notes round-trip spike (go/no-go for the whole UI model).

Validates that we can, from Python via ``osascript``:
  1. create a note in a chosen account and get a stable id back,
  2. read its body (HTML) and modification date,
  3. detect an *external* edit the user makes in the Notes app, and
  4. recover the user's edited text and write the note back.

This is the make-or-break question for the product: Apple Notes is both the
rendered output and the editable input, so if we can't reliably detect and read
back human edits, the whole UI model needs rethinking.

Run interactively:

    uv run python docs/spikes/s1_notes.py --account iCloud

Requires the macOS **Automation** permission (your terminal app -> Notes); the
first run pops the prompt. Notes must be signed into the chosen account.

NOTE: this is a throwaway spike. Notes' AppleScript dialect has quirks across
macOS versions (esp. HTML body handling and `note id` addressing); expect to
tweak the AppleScript below. Findings go in RESULTS.md.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import textwrap

TITLE = "Streams Spike — S1 (safe to delete)"

INITIAL_BODY = (
    "<div><h1>{title}</h1></div>"
    "<div><b>Agent zone</b> (Streams owns this)</div>"
    "<div>current state: spike baseline</div>"
    "<div><br></div>"
    "<div><b>Your notes</b> (you own this — edit the line below in Notes)</div>"
    "<div>edit me: ____</div>"
).format(title=TITLE)


def osa(script: str, *args: str) -> str:
    """Run an AppleScript (read from stdin) with positional argv, return stdout."""
    proc = subprocess.run(
        ["osascript", "-", *args],
        input=script,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "osascript failed")
    return proc.stdout.strip()


def create_note(account: str, body: str) -> str:
    script = textwrap.dedent(
        """
        on run argv
            set acctName to item 1 of argv
            set noteBody to item 2 of argv
            tell application "Notes"
                tell account acctName
                    set newNote to make new note with properties {body:noteBody}
                    return id of newNote
                end tell
            end tell
        end run
        """
    )
    return osa(script, account, body)


def get_body(note_id: str) -> str:
    script = textwrap.dedent(
        """
        on run argv
            set theID to item 1 of argv
            tell application "Notes" to return body of note id theID
        end run
        """
    )
    return osa(script, note_id)


def get_modified(note_id: str) -> str:
    script = textwrap.dedent(
        """
        on run argv
            set theID to item 1 of argv
            tell application "Notes" to return (modification date of note id theID) as string
        end run
        """
    )
    return osa(script, note_id)


def set_body(note_id: str, body: str) -> None:
    script = textwrap.dedent(
        """
        on run argv
            set theID to item 1 of argv
            set newBody to item 2 of argv
            tell application "Notes" to set body of note id theID to newBody
        end run
        """
    )
    osa(script, note_id, body)


def _digest(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


def main() -> int:
    ap = argparse.ArgumentParser(description="Apple Notes round-trip spike")
    ap.add_argument("--account", default="iCloud", help="Notes account name")
    args = ap.parse_args()

    print(f"Creating note in account {args.account!r} ...")
    note_id = create_note(args.account, INITIAL_BODY)
    print(f"  created: {note_id}")

    base_body = get_body(note_id)
    base_mod = get_modified(note_id)
    print(f"  modification date: {base_mod}")
    print(f"  body sha: {_digest(base_body)}")

    print(
        "\n>>> In the Notes app, open the note titled:\n"
        f"      {TITLE}\n"
        "    Edit the 'edit me: ____' line (and/or check a box), then save.\n"
    )
    input("Press Enter once you've edited it... ")

    new_body = get_body(note_id)
    new_mod = get_modified(note_id)
    changed_mod = new_mod != base_mod
    changed_body = _digest(new_body) != _digest(base_body)
    print(f"\n  modification date changed: {changed_mod}  ({new_mod})")
    print(f"  body changed: {changed_body}  (sha {_digest(new_body)})")
    print("\n  --- recovered body (what we'd parse to reconcile) ---")
    print(textwrap.indent(new_body, "  "))

    print("\nWriting an agent-zone update back (leaving your text intact ideally)...")
    set_body(note_id, new_body.replace("spike baseline", "spike round-trip OK"))
    print("  wrote back. Re-open the note to confirm your edit survived.")

    print(
        "\nGO if: mod-date and/or body change was detected, your edited text was "
        "recoverable, and the write-back didn't clobber it. Record in RESULTS.md."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
