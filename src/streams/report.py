"""Weekly cost / noise report from the `meta` ledger and agent-note events.

Cost comes from the `meta` stream's usage events (logged as ``cost=$X``); noise
is the count of agent-added suggestions across streams. Run it weekly to keep the
agent honest about spend and noise before increasing its autonomy.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from .core import EventSource
from .store import Store, StreamNotFound

_COST_RE = re.compile(r"cost=\$([0-9.]+)")
_SUGGEST_RE = re.compile(r"added (\d+) suggestion")


def weekly_report(store: Store, days: int = 7) -> str:
    since = datetime.now() - timedelta(days=days)

    total_cost = 0.0
    calls = 0
    try:
        for event in store.list_events("meta"):
            if event.timestamp < since:
                continue
            m = _COST_RE.search(event.content)
            if m:
                total_cost += float(m.group(1))
                calls += 1
    except StreamNotFound:
        pass

    suggestions = 0
    for stream in store.list_streams():
        if stream.id == "meta":
            continue
        for event in store.list_events(stream.id):
            if event.timestamp >= since and event.source is EventSource.agent:
                m = _SUGGEST_RE.search(event.content)
                if m:
                    suggestions += int(m.group(1))

    return "\n".join(
        [
            f"Streams report — last {days} days",
            f"  agent calls logged: {calls}",
            f"  estimated cost:     ${total_cost:.4f}",
            f"  suggestions added:  {suggestions}",
        ]
    )
