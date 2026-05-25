"""Runtime configuration for the Streams daemon.

Single-user identity (``imessage_handle``, ``notes_account``, ``repo_path``)
lives here and nowhere else. Keeping it confined to this one layer is what makes
multi-tenancy a later deployment concern rather than a refactor — do not read
these values from anywhere but a :class:`Config` instance.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path

import yaml

DEFAULT_PASS_TIMES: tuple[str, ...] = ("07:00", "13:00", "19:00")


def _default_repo_path() -> Path:
    return Path.home() / "streams-data"


@dataclass(frozen=True)
class Config:
    """Validated configuration, loaded from a YAML file (or defaults)."""

    # Path to the markdown data repo (where ``streams/<slug>/`` live).
    repo_path: Path = field(default_factory=_default_repo_path)
    # Daemon scheduled-pass times, local 24h "HH:MM". Three passes/day per the plan.
    pass_times: tuple[str, ...] = DEFAULT_PASS_TIMES
    # How often the daemon polls Notes / Reminders / iMessage for changes.
    poll_interval_seconds: int = 60
    # Run one full pass (synthesis + overseer) immediately on daemon startup,
    # regardless of pass_times — so a restart/reboot refreshes the overseer report
    # without waiting for the next scheduled slot. The digest dedup avoids re-sending
    # an unchanged summary, so this is quiet when nothing changed.
    pass_on_start: bool = True
    # Hard token budget per agent call.
    token_budget: int = 30_000
    # Claude models, selectable per pass type.
    model_routine: str = "claude-haiku-4-5"
    model_synthesis: str = "claude-opus-4-7"
    # The agent's name. Signs outbound iMessages and authors git commits, so the
    # history shows who made each edit. (Setup will prompt for this later.)
    agent_name: str = "Streams"
    # Apple Notes account that holds the stream notes.
    notes_account: str = "iCloud"
    # Apple Notes folder that holds stream notes. Managed notes live here, and any
    # note you create in this folder is auto-captured into a new stream (see
    # streams.sync.capture_folder). Folder membership is reliable via AppleScript,
    # unlike native #hashtags, which aren't part of a note's searchable body.
    note_folder: str = "Streams"
    # Apple Reminders list to push todos into. Empty = the default list. Pinning an
    # explicit list avoids the "default list is in an account you aren't viewing" gotcha.
    reminders_list: str = ""
    # The phone number / email used to match your inbound iMessage replies.
    imessage_handle: str = ""
    # Claude API key. If empty, the SDK falls back to the ANTHROPIC_API_KEY env var.
    anthropic_api_key: str = ""

    @classmethod
    def from_dict(cls, data: dict | None) -> "Config":
        """Build from a plain dict, rejecting unknown keys (catches typos early)."""
        known = {f.name for f in fields(cls)}
        unknown = set(data or {}) - known
        if unknown:
            raise ValueError(f"Unknown config key(s): {', '.join(sorted(unknown))}")
        kwargs = dict(data or {})
        if "repo_path" in kwargs:
            kwargs["repo_path"] = Path(kwargs["repo_path"]).expanduser()
        if "pass_times" in kwargs:
            kwargs["pass_times"] = tuple(kwargs["pass_times"])
        return cls(**kwargs)

    @classmethod
    def load(cls, path: str | os.PathLike[str] | None = None) -> "Config":
        """Load config from ``path``; with no path, return defaults.

        Raises ``FileNotFoundError`` if a path is given but missing, so a
        mistyped ``--config`` fails loudly rather than silently using defaults.
        """
        if path is None:
            return cls()
        p = Path(path).expanduser()
        if not p.exists():
            raise FileNotFoundError(f"Config file not found: {p}")
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
        if data is not None and not isinstance(data, dict):
            raise ValueError(
                f"Config root must be a mapping, got {type(data).__name__}"
            )
        return cls.from_dict(data)
