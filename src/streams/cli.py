"""Terminal CLI over the store — the power/admin surface for Phase 1.

Repo resolution order: ``--repo`` flag, then ``$STREAMS_REPO``, then the
configured ``repo_path``. Query commands build a fresh in-memory index from the
store so results are always current.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime
from pathlib import Path

from .config import Config
from .core import EventSource, EventType, GoalStatus, Provenance, StreamState
from .index import build_index
from .notedoc import serialize_text
from .render import render
from .store import Store, StreamNotFound


def _resolve_repo(args: argparse.Namespace) -> Path:
    if args.repo:
        return Path(args.repo).expanduser()
    if os.environ.get("STREAMS_REPO"):
        return Path(os.environ["STREAMS_REPO"]).expanduser()
    return Config.load(args.config).repo_path


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


# --- command handlers -------------------------------------------------------


def cmd_stream_create(store: Store, args) -> int:
    stream = store.create_stream(
        args.title, state=StreamState(args.state), weight=args.weight
    )
    print(stream.id)
    return 0


def cmd_stream_list(store: Store, args) -> int:
    for s in store.list_streams():
        print(f"{s.id:<24} {s.state.value:<12} w{s.weight:<3} {s.title}")
    return 0


def cmd_stream_show(store: Store, args) -> int:
    s = store.read_stream(args.slug)
    print(f"# {s.title}  ({s.id})")
    print(f"state={s.state.value} weight={s.weight} created={s.created} note_id={s.note_id}")

    goals = store.list_goals(s.id)
    print(f"\nGoals ({len(goals)}):")
    for g in goals:
        flag = "" if g.src is Provenance.user else " [agent]"
        print(f"  {g.id}  [{g.status.value}] {g.text}{flag}")

    todos = store.list_todos(s.id)
    print(f"\nTodos ({len(todos)}):")
    for t in todos:
        box = "x" if t.status.value == "done" else " "
        due = f" (due {t.due})" if t.due else ""
        flag = "" if t.src is Provenance.user else " [agent]"
        print(f"  [{box}] {t.id}  {t.text}{due} <{t.status.value}>{flag}")

    events = store.list_events(s.id)[-5:]
    print(f"\nRecent events ({len(events)} of {len(store.list_events(s.id))}):")
    for e in events:
        print(f"  {e.timestamp:%Y-%m-%d %H:%M} · {e.type.value} · {e.source.value}: {e.content}")

    print("\nNotes:")
    print(store.read_notes(s.id).rstrip() or "  (none)")
    return 0


def cmd_stream_archive(store: Store, args) -> int:
    store.archive_stream(args.slug)
    print(f"archived {args.slug}")
    return 0


def cmd_goal_add(store: Store, args) -> int:
    g = store.add_goal(args.slug, args.text, target=_parse_date(args.target))
    print(g.id)
    return 0


def cmd_goal_set(store: Store, args) -> int:
    g = store.set_goal_status(args.slug, args.goal_id, GoalStatus(args.status))
    print(f"{g.id} -> {g.status.value}")
    return 0


def cmd_todo_add(store: Store, args) -> int:
    t = store.add_todo(args.slug, args.text, due=_parse_date(args.due))
    print(t.id)
    return 0


def cmd_todo_done(store: Store, args) -> int:
    t = store.complete_todo(args.slug, args.todo_id)
    print(f"{t.id} -> {t.status.value}")
    return 0


def cmd_todo_defer(store: Store, args) -> int:
    t = store.defer_todo(args.slug, args.todo_id)
    print(f"{t.id} -> {t.status.value}")
    return 0


def cmd_event_add(store: Store, args) -> int:
    e = store.append_event(
        args.slug, args.content,
        type=EventType(args.type), source=EventSource(args.source),
    )
    print(e.id)
    return 0


def cmd_note_show(store: Store, args) -> int:
    print(store.read_notes(args.slug).rstrip())
    return 0


def cmd_note_set(store: Store, args) -> int:
    store.set_notes(args.slug, args.text)
    return 0


def cmd_query_open_todos(store: Store, args) -> int:
    idx = build_index(store)
    for r in idx.open_todos():
        due = f" (due {r['due']})" if r["due"] else ""
        print(f"{r['stream']:<20} {r['id']}  {r['text']}{due}")
    return 0


def cmd_query_due(store: Store, args) -> int:
    start = _parse_date(args.after) or date.today()
    end = _parse_date(args.before) or date.max
    idx = build_index(store)
    for r in idx.todos_due_between(start, end):
        print(f"{r['due']}  {r['stream']:<20} {r['id']}  {r['text']}")
    return 0


def cmd_query_recent(store: Store, args) -> int:
    idx = build_index(store)
    for r in idx.recent_events(args.limit):
        print(f"{r['ts']}  {r['stream']:<20} {r['type']}: {r['content']}")
    return 0


def cmd_note_preview(store: Store, args) -> int:
    print(serialize_text(render(store, args.slug)), end="")
    return 0


def cmd_sync(store: Store, args) -> int:
    # imported lazily so non-sync CLI use never touches Apple/osascript
    from .notes_bridge import AppleNotesBridge
    from .sync import sync_stream

    cfg = Config.load(args.config)
    bridge = AppleNotesBridge(account=cfg.notes_account)
    slugs = [s.id for s in store.list_streams()] if args.all else [args.slug]
    for slug in slugs:
        result = sync_stream(store, bridge, slug)
        if result.created:
            print(f"{slug}: created note")
        elif result.changes:
            print(f"{slug}: {len(result.changes)} change(s)")
            for c in result.changes:
                print(f"  - {c}")
        else:
            print(f"{slug}: up to date")
    return 0


def _agent_llm(cfg: Config):
    from .agent.llm import AnthropicLLM

    return AnthropicLLM(cfg.model_synthesis)


def cmd_agent_pass(store: Store, args) -> int:
    from .agent.runner import run_pass, synthesize_stream

    cfg = Config.load(args.config)
    try:
        llm = _agent_llm(cfg)
        if args.all:
            results = run_pass(store, llm, budget=cfg.token_budget)
        else:
            results = [synthesize_stream(store, llm, args.slug, budget=cfg.token_budget)]
    except Exception as exc:  # noqa: BLE001 — surface API/key errors plainly
        return _agent_error(exc)
    if not results:
        print("no streams to process")
    for r in results:
        cost = f"${r.usage.cost_usd:.4f}" if r.usage else "n/a"
        print(f"{r.slug}: {len(r.suggestions_added)} suggestion(s), cost {cost}")
    return 0


def cmd_agent_digest(store: Store, args) -> int:
    from .agent.runner import daily_digest

    cfg = Config.load(args.config)
    try:
        text, usage = daily_digest(store, _agent_llm(cfg), budget=cfg.token_budget)
    except Exception as exc:  # noqa: BLE001
        return _agent_error(exc)
    print(text)
    print(f"\n[cost ${usage.cost_usd:.4f}]", file=sys.stderr)
    return 0


def _agent_error(exc: Exception) -> int:
    msg = str(exc)
    if "api_key" in msg.lower() or "ANTHROPIC_API_KEY" in msg or "authentication" in msg.lower():
        print("error: set ANTHROPIC_API_KEY to run agent passes", file=sys.stderr)
    else:
        print(f"agent error: {exc}", file=sys.stderr)
    return 2


def cmd_index_rebuild(store: Store, args) -> int:
    db = store.repo / ".index.sqlite"
    idx = build_index(store, db)
    idx.close()
    print(f"rebuilt {db}")
    return 0


# --- parser -----------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--repo", help="data repo path (overrides config/$STREAMS_REPO)")
    common.add_argument("--config", help="path to a config.yaml")

    parser = argparse.ArgumentParser(prog="streams", description="Streams CLI")
    sub = parser.add_subparsers(dest="group", required=True)

    # stream
    sp = sub.add_parser("stream").add_subparsers(dest="action", required=True)
    p = sp.add_parser("create", parents=[common]); p.add_argument("title")
    p.add_argument("--state", default="active", choices=[s.value for s in StreamState])
    p.add_argument("--weight", type=int, default=0); p.set_defaults(fn=cmd_stream_create)
    p = sp.add_parser("list", parents=[common]); p.set_defaults(fn=cmd_stream_list)
    p = sp.add_parser("show", parents=[common]); p.add_argument("slug")
    p.set_defaults(fn=cmd_stream_show)
    p = sp.add_parser("archive", parents=[common]); p.add_argument("slug")
    p.set_defaults(fn=cmd_stream_archive)

    # goal
    gp = sub.add_parser("goal").add_subparsers(dest="action", required=True)
    p = gp.add_parser("add", parents=[common]); p.add_argument("slug"); p.add_argument("text")
    p.add_argument("--target"); p.set_defaults(fn=cmd_goal_add)
    p = gp.add_parser("set", parents=[common]); p.add_argument("slug"); p.add_argument("goal_id")
    p.add_argument("status", choices=[s.value for s in GoalStatus])
    p.set_defaults(fn=cmd_goal_set)

    # todo
    tp = sub.add_parser("todo").add_subparsers(dest="action", required=True)
    p = tp.add_parser("add", parents=[common]); p.add_argument("slug"); p.add_argument("text")
    p.add_argument("--due"); p.set_defaults(fn=cmd_todo_add)
    p = tp.add_parser("done", parents=[common]); p.add_argument("slug"); p.add_argument("todo_id")
    p.set_defaults(fn=cmd_todo_done)
    p = tp.add_parser("defer", parents=[common]); p.add_argument("slug"); p.add_argument("todo_id")
    p.set_defaults(fn=cmd_todo_defer)

    # event
    ep = sub.add_parser("event").add_subparsers(dest="action", required=True)
    p = ep.add_parser("add", parents=[common]); p.add_argument("slug"); p.add_argument("content")
    p.add_argument("--type", default="event", choices=[t.value for t in EventType])
    p.add_argument("--source", default="manual", choices=[s.value for s in EventSource])
    p.set_defaults(fn=cmd_event_add)

    # note
    np = sub.add_parser("note").add_subparsers(dest="action", required=True)
    p = np.add_parser("show", parents=[common]); p.add_argument("slug")
    p.set_defaults(fn=cmd_note_show)
    p = np.add_parser("set", parents=[common]); p.add_argument("slug"); p.add_argument("text")
    p.set_defaults(fn=cmd_note_set)
    p = np.add_parser("preview", parents=[common]); p.add_argument("slug")
    p.set_defaults(fn=cmd_note_preview)

    # sync (render <-> reconcile round-trip with Apple Notes)
    p = sub.add_parser("sync", parents=[common])
    p.add_argument("slug", nargs="?"); p.add_argument("--all", action="store_true")
    p.set_defaults(fn=cmd_sync, group="sync", action=None)

    # agent (Claude synthesis + digest)
    ap = sub.add_parser("agent").add_subparsers(dest="action", required=True)
    p = ap.add_parser("pass", parents=[common])
    p.add_argument("slug", nargs="?"); p.add_argument("--all", action="store_true")
    p.set_defaults(fn=cmd_agent_pass)
    p = ap.add_parser("digest", parents=[common]); p.set_defaults(fn=cmd_agent_digest)

    # query
    qp = sub.add_parser("query").add_subparsers(dest="action", required=True)
    p = qp.add_parser("open-todos", parents=[common]); p.set_defaults(fn=cmd_query_open_todos)
    p = qp.add_parser("due", parents=[common]); p.add_argument("--after"); p.add_argument("--before")
    p.set_defaults(fn=cmd_query_due)
    p = qp.add_parser("recent", parents=[common]); p.add_argument("--limit", type=int, default=20)
    p.set_defaults(fn=cmd_query_recent)

    # index
    ip = sub.add_parser("index").add_subparsers(dest="action", required=True)
    p = ip.add_parser("rebuild", parents=[common]); p.set_defaults(fn=cmd_index_rebuild)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    store = Store(_resolve_repo(args))
    try:
        return args.fn(store, args)
    except StreamNotFound as exc:
        print(f"error: stream not found: {exc}", file=sys.stderr)
        return 2
    except KeyError as exc:
        print(f"error: item not found: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
