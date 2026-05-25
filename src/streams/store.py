"""Filesystem + git persistence for streams.

The store owns the data repo at ``repo_path`` and is the single internal API for
reading and mutating streams. Every mutation writes markdown and commits, so the
git history is the audit trail. Layout per stream::

    streams/<slug>/
        stream.md            metadata (frontmatter)
        goals.md             goals collection
        todos.md             todos collection
        notes.md             free-form notes
        events/YYYY-MM.md    append-only monthly event logs

Archived streams move to ``archive/<slug>/`` and drop out of ``list_streams``.
"""

from __future__ import annotations

import shutil
from datetime import date, datetime
from pathlib import Path

from . import gitutil, markdown
from .core import (
    Event,
    EventSource,
    EventType,
    Goal,
    GoalStatus,
    Provenance,
    Stream,
    StreamState,
    Todo,
    TodoStatus,
    new_id,
    slugify,
)

_GITIGNORE = ".index.sqlite\n.render/\n"


class StreamNotFound(Exception):
    pass


class Store:
    def __init__(self, repo_path: str | Path, author: str = "Streams"):
        self.repo = Path(repo_path).expanduser()
        self.author = author  # git commit author — the configured agent signs edits
        self.repo.mkdir(parents=True, exist_ok=True)
        gitutil.ensure_repo(self.repo)
        (self.repo / "streams").mkdir(exist_ok=True)
        self._ensure_gitignore()

    def commit(self, message: str, paths: list[Path]) -> bool:
        """Commit `paths` authored by the configured agent. False if no change."""
        return gitutil.commit(self.repo, message, paths, name=self.author)

    def _ensure_gitignore(self) -> None:
        gi = self.repo / ".gitignore"
        if not gi.exists():
            gi.write_text(_GITIGNORE, encoding="utf-8")
            self.commit("chore: initialize data repo", [gi])

    # --- paths --------------------------------------------------------------

    def _dir(self, slug: str) -> Path:
        return self.repo / "streams" / slug

    def _stream_md(self, slug: str) -> Path:
        return self._dir(slug) / "stream.md"

    def _goals_md(self, slug: str) -> Path:
        return self._dir(slug) / "goals.md"

    def _todos_md(self, slug: str) -> Path:
        return self._dir(slug) / "todos.md"

    def _notes_md(self, slug: str) -> Path:
        return self._dir(slug) / "notes.md"

    def _agent_md(self, slug: str) -> Path:
        return self._dir(slug) / "agent.md"

    def _events_dir(self, slug: str) -> Path:
        return self._dir(slug) / "events"

    def _require(self, slug: str) -> None:
        if not self._stream_md(slug).exists():
            raise StreamNotFound(slug)

    # --- streams ------------------------------------------------------------

    def _unique_slug(self, base: str) -> str:
        slug, i = base, 2
        while self._dir(slug).exists():
            slug, i = f"{base}-{i}", i + 1
        return slug

    def create_stream(
        self,
        title: str,
        state: StreamState = StreamState.active,
        weight: int = 0,
    ) -> Stream:
        slug = self._unique_slug(slugify(title))
        stream = Stream(id=slug, title=title, state=state, weight=weight)
        d = self._dir(slug)
        d.mkdir(parents=True)
        self._events_dir(slug).mkdir()
        self._stream_md(slug).write_text(markdown.format_stream(stream), encoding="utf-8")
        self._goals_md(slug).write_text(markdown.format_goals([]), encoding="utf-8")
        self._todos_md(slug).write_text(markdown.format_todos([]), encoding="utf-8")
        self._notes_md(slug).write_text("", encoding="utf-8")
        self._agent_md(slug).write_text("", encoding="utf-8")
        # keep the empty events dir tracked
        (self._events_dir(slug) / ".gitkeep").write_text("", encoding="utf-8")
        self.commit(f"create stream {slug}: {title}", [d])
        return stream

    def read_stream(self, slug: str) -> Stream:
        self._require(slug)
        return markdown.parse_stream(self._stream_md(slug).read_text(encoding="utf-8"))

    def list_streams(self) -> list[Stream]:
        root = self.repo / "streams"
        slugs = sorted(p.name for p in root.iterdir() if (p / "stream.md").exists())
        return [self.read_stream(s) for s in slugs]

    def update_stream(self, stream: Stream) -> Stream:
        self._require(stream.id)
        self._stream_md(stream.id).write_text(
            markdown.format_stream(stream), encoding="utf-8"
        )
        self.commit(f"update stream {stream.id}", [self._stream_md(stream.id)])
        return stream

    def set_note_id(self, slug: str, note_id: str) -> Stream:
        stream = self.read_stream(slug)
        stream.note_id = note_id
        return self.update_stream(stream)

    def archive_stream(self, slug: str) -> None:
        self._require(slug)
        archive_dir = self.repo / "archive"
        archive_dir.mkdir(exist_ok=True)
        dest = archive_dir / slug
        shutil.move(str(self._dir(slug)), str(dest))
        self.commit(f"archive stream {slug}", [self._dir(slug), dest])

    # --- goals --------------------------------------------------------------

    def list_goals(self, slug: str) -> list[Goal]:
        self._require(slug)
        return markdown.parse_goals(self._goals_md(slug).read_text(encoding="utf-8"))

    def _write_goals(self, slug: str, goals: list[Goal]) -> None:
        self._goals_md(slug).write_text(markdown.format_goals(goals), encoding="utf-8")

    def add_goal(
        self,
        slug: str,
        text: str,
        target: date | None = None,
        src: Provenance = Provenance.user,
    ) -> Goal:
        self._require(slug)
        goals = self.list_goals(slug)
        goal = Goal(id=new_id("g"), text=text, target=target, src=src)
        goals.append(goal)
        self._write_goals(slug, goals)
        self.commit(f"add goal to {slug}: {text}", [self._goals_md(slug)])
        return goal

    def set_goal_status(self, slug: str, goal_id: str, status: GoalStatus) -> Goal:
        goals = self.list_goals(slug)
        goal = _find(goals, goal_id)
        goal.status = status
        self._write_goals(slug, goals)
        self.commit(f"goal {goal_id} -> {status.value} in {slug}", [self._goals_md(slug)])
        return goal

    def set_goal_text(self, slug: str, goal_id: str, text: str) -> Goal:
        goals = self.list_goals(slug)
        goal = _find(goals, goal_id)
        goal.text = text
        self._write_goals(slug, goals)
        self.commit(f"edit goal {goal_id} in {slug}", [self._goals_md(slug)])
        return goal

    # --- todos --------------------------------------------------------------

    def list_todos(self, slug: str) -> list[Todo]:
        self._require(slug)
        return markdown.parse_todos(self._todos_md(slug).read_text(encoding="utf-8"))

    def _write_todos(self, slug: str, todos: list[Todo]) -> None:
        self._todos_md(slug).write_text(markdown.format_todos(todos), encoding="utf-8")

    def add_todo(
        self,
        slug: str,
        text: str,
        due: date | None = None,
        src: Provenance = Provenance.user,
    ) -> Todo:
        self._require(slug)
        todos = self.list_todos(slug)
        todo = Todo(id=new_id("t"), text=text, due=due, src=src)
        todos.append(todo)
        self._write_todos(slug, todos)
        self.commit(f"add todo to {slug}: {text}", [self._todos_md(slug)])
        return todo

    def set_todo_status(
        self,
        slug: str,
        todo_id: str,
        status: TodoStatus,
        completed: date | None = None,
    ) -> Todo:
        todos = self.list_todos(slug)
        todo = _find(todos, todo_id)
        todo.status = status
        todo.completed = completed if status is TodoStatus.done else None
        self._write_todos(slug, todos)
        self.commit(f"todo {todo_id} -> {status.value} in {slug}", [self._todos_md(slug)])
        return todo

    def set_todo_text(self, slug: str, todo_id: str, text: str) -> Todo:
        todos = self.list_todos(slug)
        todo = _find(todos, todo_id)
        todo.text = text
        self._write_todos(slug, todos)
        self.commit(f"edit todo {todo_id} in {slug}", [self._todos_md(slug)])
        return todo

    def set_todo_reminder(self, slug: str, todo_id: str, reminder_id: str | None) -> Todo:
        todos = self.list_todos(slug)
        todo = _find(todos, todo_id)
        todo.reminder_id = reminder_id
        self._write_todos(slug, todos)
        self.commit(f"link todo {todo_id} to reminder in {slug}", [self._todos_md(slug)])
        return todo

    def complete_todo(self, slug: str, todo_id: str) -> Todo:
        return self.set_todo_status(slug, todo_id, TodoStatus.done, completed=date.today())

    def reopen_todo(self, slug: str, todo_id: str) -> Todo:
        return self.set_todo_status(slug, todo_id, TodoStatus.open)

    def defer_todo(self, slug: str, todo_id: str) -> Todo:
        return self.set_todo_status(slug, todo_id, TodoStatus.deferred)

    def archive_todo(self, slug: str, todo_id: str) -> Todo:
        return self.set_todo_status(slug, todo_id, TodoStatus.archived)

    # --- events -------------------------------------------------------------

    def append_event(
        self,
        slug: str,
        content: str,
        type: EventType = EventType.event,
        source: EventSource = EventSource.manual,
        timestamp: datetime | None = None,
    ) -> Event:
        self._require(slug)
        ts = timestamp or datetime.now().replace(microsecond=0)
        event = Event(id=new_id("e"), timestamp=ts, content=content, type=type, source=source)
        month_file = self._events_dir(slug) / f"{ts.strftime('%Y-%m')}.md"
        if month_file.exists():
            body = month_file.read_text(encoding="utf-8").rstrip()
        else:
            body = f"# Events {ts.strftime('%Y-%m')}"
        month_file.write_text(body + "\n\n" + markdown.format_event(event) + "\n", encoding="utf-8")
        self.commit(f"append {type.value} to {slug}", [month_file])
        return event

    def list_events(self, slug: str, month: str | None = None) -> list[Event]:
        """All events for a stream, oldest first (optionally one ``YYYY-MM``)."""
        self._require(slug)
        events_dir = self._events_dir(slug)
        files = (
            [events_dir / f"{month}.md"]
            if month
            else sorted(events_dir.glob("*.md"))
        )
        events: list[Event] = []
        for f in files:
            if f.exists():
                events.extend(markdown.parse_events(f.read_text(encoding="utf-8")))
        events.sort(key=lambda e: e.timestamp)
        return events

    # --- notes --------------------------------------------------------------

    def read_notes(self, slug: str) -> str:
        self._require(slug)
        f = self._notes_md(slug)
        return f.read_text(encoding="utf-8") if f.exists() else ""

    def set_notes(self, slug: str, text: str) -> None:
        self._require(slug)
        body = text if text.endswith("\n") else text + "\n"
        self._notes_md(slug).write_text(body, encoding="utf-8")
        self.commit(f"update notes for {slug}", [self._notes_md(slug)])

    # --- agent synthesis (rendered into the note's agent zone) --------------

    def read_agent(self, slug: str) -> str:
        self._require(slug)
        f = self._agent_md(slug)
        return f.read_text(encoding="utf-8") if f.exists() else ""

    def write_agent(self, slug: str, text: str) -> None:
        self._require(slug)
        body = text if text.endswith("\n") else text + "\n"
        self._agent_md(slug).write_text(body, encoding="utf-8")
        self.commit(f"update agent synthesis for {slug}", [self._agent_md(slug)])

    # --- overseer (high-level cross-stream status + durable memory) ----------
    # Not a stream: lives in overseer/ at the repo root. The overseer reads its
    # own prior status + memory each run for continuity (see streams.agent.overseer).

    def _overseer_file(self, name: str) -> Path:
        return self.repo / "overseer" / name

    def _read_overseer(self, name: str) -> str:
        f = self._overseer_file(name)
        return f.read_text(encoding="utf-8") if f.exists() else ""

    def _write_overseer(self, name: str, text: str, message: str) -> None:
        f = self._overseer_file(name)
        f.parent.mkdir(exist_ok=True)
        f.write_text((text.rstrip() + "\n") if text.strip() else "", encoding="utf-8")
        self.commit(message, [f])

    def read_overseer_status(self) -> str:
        return self._read_overseer("status.md")

    def write_overseer_status(self, text: str) -> None:
        self._write_overseer("status.md", text, "update overseer status")

    def read_overseer_memory(self) -> str:
        return self._read_overseer("memory.md")

    def write_overseer_memory(self, text: str) -> None:
        self._write_overseer("memory.md", text, "update overseer memory")


def _find(items, item_id):
    for item in items:
        if item.id == item_id:
            return item
    raise KeyError(item_id)
