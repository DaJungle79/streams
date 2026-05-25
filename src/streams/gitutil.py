"""Thin git wrapper.

Every store mutation commits, so the data repo is the audit trail and any change
is revertable (the brief's NFR). Commits are scoped to the paths that changed and
carry a fixed Streams committer identity, so they work regardless of the user's
global git config.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

# Applied per-commit so commits succeed even with no global user.name/email set.
_IDENTITY = [
    "-c",
    "user.name=Streams",
    "-c",
    "user.email=streams@localhost",
]


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


def commit(repo: Path, message: str, paths: list[Path]) -> bool:
    """Stage and commit exactly ``paths``. Returns False if nothing changed."""
    rel = [str(p) for p in paths]
    run_git(repo, "add", "--", *rel)
    staged = run_git(repo, "diff", "--cached", "--name-only", "--", *rel)
    if not staged:
        return False
    run_git(repo, *_IDENTITY, "commit", "-q", "-m", message, "--", *rel)
    return True


def commit_count(repo: Path) -> int:
    out = run_git(repo, "rev-list", "--count", "HEAD", check=False)
    return int(out) if out.isdigit() else 0
