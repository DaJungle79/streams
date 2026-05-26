"""iMessage two-way channel: ask questions out, route replies back.

Outbound is reliable (AppleScript). Inbound is the fragile half — reading
``chat.db`` needs Full Disk Access — so callers degrade to outbound-only if the
read fails.

A reply carries no reference to what it answers, so we use a pending-question
state machine: when the agent asks, we record the question (and which stream it's
about) and anchor a chat.db cursor; the next inbound reply answers the oldest open
question (FIFO), gets logged to that stream as an event, and clears the question.
Inbound with no open question is captured to the ``meta`` stream so it's not lost.

State (cursor + pending queue) lives in ``messages/state.json``, committed for
audit. The cursor is anchored at ask time so a reply that arrives before the
first poll is never skipped.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from ..core import EventSource, EventType, StreamState, new_id
from ..store import Store, StreamNotFound


@dataclass
class InboundMessage:
    rowid: int
    text: str


class MessagesBridge(Protocol):
    def send(self, text: str) -> None: ...
    def read_inbound(self, after_rowid: int) -> list[InboundMessage]: ...
    def latest_rowid(self) -> int: ...  # for anchoring the cursor (skip backlog)


@dataclass
class PollResult:
    processed: int = 0  # inbound messages handled
    answered: int = 0   # mapped to a pending question
    unrouted: int = 0   # captured to meta (no open question)


# --- state persistence (messages/state.json, committed) --------------------


def _state_path(store: Store):
    return store.repo / "messages" / "state.json"


def _load_state(store: Store) -> dict:
    path = _state_path(store)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"cursor": None, "pending": []}


def _save_state(store: Store, state: dict) -> None:
    path = _state_path(store)
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    store.commit("update messages state", [path])


def _ensure_meta(store: Store) -> None:
    try:
        store.read_stream("meta")
    except StreamNotFound:
        store.create_stream("meta", state=StreamState.dormant)


# --- the flow ---------------------------------------------------------------


def _sign(text: str, signature: str | None) -> str:
    return f"{text}\n\n— {signature}" if signature else text


def ask(
    store: Store,
    bridge: MessagesBridge,
    question: str,
    stream: str | None = None,
    signature: str | None = None,
) -> str:
    """Send a (optionally signed) question over iMessage and record it pending."""
    bridge.send(_sign(question, signature))  # store the unsigned question for the Q/A log
    state = _load_state(store)
    if state.get("cursor") is None:
        # anchor now so the reply (which will have a higher rowid) is caught
        state["cursor"] = bridge.latest_rowid()
    qid = new_id("q")
    state["pending"].append(
        {
            "id": qid,
            "stream": stream,
            "question": question,
            "asked_at": datetime.now().replace(microsecond=0).isoformat(),
        }
    )
    _save_state(store, state)
    return qid


def send(store: Store, bridge: MessagesBridge, text: str, signature: str | None = None) -> None:
    """A plain outbound nudge — no pending question recorded."""
    bridge.send(_sign(text, signature))


def poll_inbound(store: Store, bridge: MessagesBridge) -> PollResult:
    """Process new inbound replies, routing each to the oldest open question."""
    state = _load_state(store)
    if state.get("cursor") is None:
        # first ever poll with no prior ask: skip the backlog, anchor at latest
        state["cursor"] = bridge.latest_rowid()
        _save_state(store, state)
        return PollResult()

    messages = bridge.read_inbound(state["cursor"])
    result = PollResult(processed=len(messages))
    for msg in messages:
        if state["pending"]:
            question = state["pending"].pop(0)  # FIFO: answer in the order asked
            content = f"Q: {question['question']}\nA: {msg.text}"
            target = question.get("stream")
            if target:
                store.append_event(target, content, type=EventType.event, source=EventSource.sync)
            else:
                _capture_unrouted(store, content)
            result.answered += 1
        else:
            _capture_unrouted(store, f"inbound (no open question): {msg.text}")
            result.unrouted += 1
        state["cursor"] = msg.rowid

    _save_state(store, state)
    return result


def _capture_unrouted(store: Store, content: str) -> None:
    _ensure_meta(store)
    store.append_event("meta", content, type=EventType.event, source=EventSource.sync)


# --- in-memory bridge for tests --------------------------------------------


class FakeMessages:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.inbox: list[InboundMessage] = []
        self._seq = 0

    def send(self, text: str) -> None:
        self.sent.append(text)

    def read_inbound(self, after_rowid: int) -> list[InboundMessage]:
        return [m for m in self.inbox if m.rowid > after_rowid]

    def latest_rowid(self) -> int:
        return max((m.rowid for m in self.inbox), default=0)

    # test helper: simulate the user texting back
    def user_reply(self, text: str) -> int:
        self._seq += 1
        self.inbox.append(InboundMessage(self._seq, text))
        return self._seq


# --- real iMessage bridge (osascript send + chat.db read) ------------------


class AppleMessages:
    """iMessage via AppleScript (send) and chat.db (read). Validated by spike s2.

    Reading chat.db needs Full Disk Access for the terminal app. Newer macOS may
    store body text in ``attributedBody`` rather than ``message.text``; we read
    ``text`` first and fall back to a best-effort blob decode.
    """

    def __init__(self, handle: str) -> None:
        if not handle:
            raise ValueError("imessage_handle is not set in config")
        self.handle = handle

    # outbound -------------------------------------------------------------

    def send(self, text: str) -> None:
        import subprocess
        import textwrap

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
            ["osascript", "-", self.handle, text], input=script, capture_output=True, text=True
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "osascript send failed")

    # inbound --------------------------------------------------------------

    def _connect(self):
        import sqlite3
        from pathlib import Path

        db = Path.home() / "Library" / "Messages" / "chat.db"
        if not db.exists():
            raise FileNotFoundError(f"chat.db not found at {db}")
        con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
        con.row_factory = sqlite3.Row
        return con

    def latest_rowid(self) -> int:
        con = self._connect()
        try:
            row = con.execute("SELECT MAX(ROWID) AS m FROM message").fetchone()
            return int(row["m"]) if row and row["m"] is not None else 0
        finally:
            con.close()

    def read_inbound(self, after_rowid: int) -> list[InboundMessage]:
        con = self._connect()
        try:
            rows = con.execute(
                """
                SELECT message.ROWID AS rowid, message.text AS text,
                       message.attributedBody AS body
                FROM message
                LEFT JOIN handle ON message.handle_id = handle.ROWID
                WHERE message.ROWID > ? AND message.is_from_me = 0 AND handle.id = ?
                ORDER BY message.ROWID ASC
                """,
                (after_rowid, self.handle),
            ).fetchall()
        finally:
            con.close()
        out: list[InboundMessage] = []
        for r in rows:
            text = r["text"] or _decode_attributed_body(r["body"])
            if text and text.strip():
                out.append(InboundMessage(int(r["rowid"]), text.strip()))
        return out


def _decode_attributed_body(blob) -> str | None:
    """Best-effort extraction of message text from the attributedBody typedstream."""
    if not blob:
        return None
    try:
        data = bytes(blob)
        after = data.split(b"NSString", 1)[1][5:]  # skip class metadata
        if after[0] == 0x81:  # 2-byte length prefix
            length = int.from_bytes(after[1:3], "little")
            after = after[3:]
        else:
            length = after[0]
            after = after[1:]
        return after[:length].decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 — best-effort; fall back to skipping the row
        return None
