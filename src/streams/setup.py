"""Interactive `streams setup` — write config.yaml by prompting the operator.

Confines all single-user identity (agent name, API key, iMessage handle, Notes
account) to the config file, which is the multi-tenancy boundary.
"""

from __future__ import annotations

from pathlib import Path

import yaml

# (key, prompt, default)
FIELDS: list[tuple[str, str, str]] = [
    ("agent_name", "Agent name", "Streams"),
    ("anthropic_api_key", "Claude API key (sk-ant-...)", ""),
    ("repo_path", "Data repo path", "~/streams-data"),
    ("imessage_handle", "Your iMessage handle (phone/email)", ""),
    ("notes_account", "Apple Notes account", "iCloud"),
    ("reminders_list", "Reminders list (blank = default)", ""),
    ("note_tag", "Stream hashtag", "#stream"),
]


def write_config(path: str | Path, values: dict) -> None:
    Path(path).write_text(yaml.safe_dump(values, sort_keys=False, allow_unicode=True), encoding="utf-8")


def run_setup(path: str | Path, input_fn=input) -> dict:
    values: dict = {}
    for key, prompt, default in FIELDS:
        answer = input_fn(f"{prompt} [{default}]: ").strip()
        values[key] = answer or default
    write_config(path, values)
    return values
