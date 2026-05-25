from datetime import date, datetime

from streams import markdown as md
from streams.core import (
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
)


def test_stream_roundtrip():
    s = Stream(id="bali-trip", title="Bali Trip", state=StreamState.maintenance,
               weight=3, note_id="x-coredata://abc", created=date(2026, 5, 1))
    out = md.parse_stream(md.format_stream(s))
    assert out == s


def test_goal_roundtrip_full_and_minimal():
    g = Goal(id="g_1", text="Ship v1", status=GoalStatus.achieved,
             src=Provenance.agent, created=date(2026, 5, 1), target=date(2026, 8, 1))
    [back] = md.parse_goals(md.format_goals([g]))
    assert back == g

    # a goal line a human added without metadata still parses
    [hand] = md.parse_goals("# Goals\n\n- Just do it\n")
    assert hand.text == "Just do it"
    assert hand.status is GoalStatus.active
    assert hand.id  # generated


def test_todo_roundtrip_and_checkbox():
    t = Todo(id="t_1", text="Book flights", status=TodoStatus.done,
             src=Provenance.user, created=date(2026, 5, 1),
             due=date(2026, 6, 1), completed=date(2026, 5, 20), reminder_id="r1")
    line = md.format_todo(t)
    assert line.startswith("- [x] Book flights")
    [back] = md.parse_todos(md.format_todos([t]))
    assert back == t


def test_todo_deferred_keeps_status_over_checkbox():
    t = Todo(id="t_2", text="Later", status=TodoStatus.deferred)
    [back] = md.parse_todos(md.format_todos([t]))
    assert back.status is TodoStatus.deferred  # comment is authoritative, box is " "


def test_todo_hand_added_infers_from_checkbox():
    [a, b] = md.parse_todos("- [x] done thing\n- [ ] open thing\n")
    assert a.status is TodoStatus.done
    assert b.status is TodoStatus.open


def test_event_roundtrip_multiline():
    e = Event(id="e_1", timestamp=datetime(2026, 5, 25, 14, 30),
              content="Decided X.\nBecause Y.", type=EventType.decision,
              source=EventSource.manual)
    [back] = md.parse_events("# Events 2026-05\n\n" + md.format_event(e) + "\n")
    assert back == e


def test_parse_multiple_events_skips_heading():
    e1 = Event(id="e_1", timestamp=datetime(2026, 5, 1, 9, 0), content="one")
    e2 = Event(id="e_2", timestamp=datetime(2026, 5, 2, 9, 0), content="two",
               type=EventType.agent_note, source=EventSource.agent)
    text = "# Events 2026-05\n\n" + md.format_event(e1) + "\n\n" + md.format_event(e2) + "\n"
    out = md.parse_events(text)
    assert [e.id for e in out] == ["e_1", "e_2"]
    assert out[1].type is EventType.agent_note
