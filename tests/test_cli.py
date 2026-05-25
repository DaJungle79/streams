from streams.cli import main
from streams.store import Store


def run(capsys, *argv):
    """Invoke the CLI and return (exit_code, stdout)."""
    code = main(list(argv))
    return code, capsys.readouterr().out


def test_create_and_list(tmp_path, capsys):
    repo = str(tmp_path / "data")
    code, out = run(capsys, "stream", "create", "Bali Trip", "--repo", repo, "--weight", "2")
    assert code == 0
    assert out.strip() == "bali-trip"

    code, out = run(capsys, "stream", "list", "--repo", repo)
    assert "bali-trip" in out and "Bali Trip" in out


def test_todo_flow_and_query(tmp_path, capsys):
    repo = str(tmp_path / "data")
    run(capsys, "stream", "create", "Work", "--repo", repo)
    _, tid = run(capsys, "todo", "add", "work", "Ship the thing", "--repo", repo, "--due", "2026-06-01")
    tid = tid.strip()

    _, out = run(capsys, "query", "open-todos", "--repo", repo)
    assert "Ship the thing" in out

    code, _ = run(capsys, "todo", "done", "work", tid, "--repo", repo)
    assert code == 0
    _, out = run(capsys, "query", "open-todos", "--repo", repo)
    assert "Ship the thing" not in out  # completed drops out


def test_show_includes_collections(tmp_path, capsys):
    repo = str(tmp_path / "data")
    run(capsys, "stream", "create", "Proj", "--repo", repo)
    run(capsys, "goal", "add", "proj", "Win", "--repo", repo)
    run(capsys, "event", "add", "proj", "kicked off", "--type", "decision", "--repo", repo)
    run(capsys, "note", "set", "proj", "scratchpad", "--repo", repo)

    _, out = run(capsys, "stream", "show", "proj", "--repo", repo)
    assert "Win" in out
    assert "kicked off" in out
    assert "scratchpad" in out


def test_env_repo_fallback(tmp_path, capsys, monkeypatch):
    repo = str(tmp_path / "data")
    monkeypatch.setenv("STREAMS_REPO", repo)
    code, out = run(capsys, "stream", "create", "EnvProj")
    assert code == 0
    assert Store(repo).read_stream("envproj").title == "EnvProj"


def test_create_does_not_make_a_note_by_default(tmp_path, capsys):
    # The note is created lazily by sync, not by stream creation (store stays
    # Apple-free). Without --note, note_id remains unset.
    repo = str(tmp_path / "data")
    run(capsys, "stream", "create", "Solo", "--repo", repo)
    assert Store(repo).read_stream("solo").note_id is None


def test_missing_stream_exit_code(tmp_path, capsys):
    repo = str(tmp_path / "data")
    code = main(["stream", "show", "ghost", "--repo", repo])
    assert code == 2
