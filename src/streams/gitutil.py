"""Thin git wrapper.

Every store mutation commits, so the data repo is the audit trail and any change
is revertable (the brief's NFR). Commits are scoped to the paths that changed and
carry a fixed Streams committer identity, so they work regardless of the user's
global git config.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

def run_git(repo: Path, *args: str, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout.strip()


def ensure_repo(repo: Path) -> None:
    if not (repo / ".git").exists():
        run_git(repo, "init", "-q")


def commit(
    repo: Path,
    message: str,
    paths: list[Path],
    name: str = "Streams",
    email: str = "streams@localhost",
) -> bool:
    """Stage and commit exactly ``paths`` as ``name``. False if nothing changed.

    The committer identity is applied per-commit so it works regardless of the
    user's global git config, and ``name`` lets the configured agent sign edits.
    """
    rel = [str(p) for p in paths]
    run_git(repo, "add", "--", *rel)
    staged = run_git(repo, "diff", "--cached", "--name-only", "--", *rel)
    if not staged:
        return False
    identity = ["-c", f"user.name={name}", "-c", f"user.email={email}"]
    run_git(repo, *identity, "commit", "-q", "-m", message, "--", *rel)
    return True


def commit_count(repo: Path) -> int:
    out = run_git(repo, "rev-list", "--count", "HEAD", check=False)
    return int(out) if out.isdigit() else 0
