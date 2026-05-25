from streams.config import Config
from streams.setup import run_setup


def test_run_setup_writes_loadable_config(tmp_path):
    path = tmp_path / "config.yaml"
    answers = iter([
        "Jarvis",            # agent_name
        "sk-ant-test",       # api key
        "~/my-streams",      # repo_path
        "+15555550123",      # imessage handle
        "",                  # notes_account -> default iCloud
        "Work",              # reminders_list
        "",                  # note_folder -> default Streams
    ])
    values = run_setup(path, input_fn=lambda _prompt: next(answers))

    assert values["agent_name"] == "Jarvis"
    assert values["notes_account"] == "iCloud"   # default applied on blank
    assert values["note_folder"] == "Streams"

    cfg = Config.load(path)                       # round-trips through the real loader
    assert cfg.agent_name == "Jarvis"
    assert cfg.anthropic_api_key == "sk-ant-test"
    assert cfg.reminders_list == "Work"
