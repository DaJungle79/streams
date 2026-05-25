from pathlib import Path

import pytest

from streams.config import Config


def test_defaults():
    cfg = Config()
    assert cfg.poll_interval_seconds == 60
    assert len(cfg.pass_times) == 3
    assert cfg.repo_path == Path.home() / "streams-data"


def test_load_none_returns_defaults():
    assert Config.load(None) == Config()


def test_load_from_file(tmp_path: Path):
    p = tmp_path / "config.yaml"
    p.write_text(
        "repo_path: ~/data\n"
        "poll_interval_seconds: 30\n"
        "imessage_handle: '+15555550123'\n"
        "pass_times: ['06:30', '21:00']\n",
        encoding="utf-8",
    )
    cfg = Config.load(p)
    assert cfg.poll_interval_seconds == 30
    assert cfg.imessage_handle == "+15555550123"
    assert cfg.repo_path == Path("~/data").expanduser()
    assert cfg.pass_times == ("06:30", "21:00")


def test_unknown_key_rejected(tmp_path: Path):
    p = tmp_path / "config.yaml"
    p.write_text("bogus: 1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="Unknown config key"):
        Config.load(p)


def test_non_mapping_root_rejected(tmp_path: Path):
    p = tmp_path / "config.yaml"
    p.write_text("- just\n- a\n- list\n", encoding="utf-8")
    with pytest.raises(ValueError, match="must be a mapping"):
        Config.load(p)


def test_missing_file_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        Config.load(tmp_path / "nope.yaml")
