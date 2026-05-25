"""iMessage two-way: ask/poll with the pending-question state machine."""

import pytest

from streams.core import EventSource
from streams.messages import FakeMessages, ask, poll_inbound, send
from streams.store import Store


@pytest.fixture
def setup(tmp_path):
    store = Store(tmp_path / "data")
    store.create_stream("Trip")
    return store, FakeMessages()


def test_ask_sends_and_records_pending(setup):
    store, bridge = setup
    qid = ask(store, bridge, "Confirm the dates?", stream="trip")
    assert bridge.sent == ["Confirm the dates?"]
    assert qid.startswith("q_")


def test_reply_answers_question_and_logs_event(setup):
    store, bridge = setup
    ask(store, bridge, "Confirm the dates?", stream="trip")
    bridge.user_reply("yes, June 3-17")
    result = poll_inbound(store, bridge)

    assert result.answered == 1
    events = store.list_events("trip")
    assert events and "Q: Confirm the dates?" in events[-1].content
    assert "A: yes, June 3-17" in events[-1].content
    assert events[-1].source is EventSource.sync


def test_reply_before_first_poll_is_not_lost(setup):
    # ask anchors the cursor, so a reply arriving before any poll is still caught
    store, bridge = setup
    ask(store, bridge, "Proceed?", stream="trip")
    bridge.user_reply("go ahead")
    assert poll_inbound(store, bridge).answered == 1


def test_first_poll_without_ask_skips_backlog(setup):
    store, bridge = setup
    bridge.user_reply("old message before we started")
    result = poll_inbound(store, bridge)  # initializes cursor, skips history
    assert result.processed == 0
    # a message after init is processed (no pending -> unrouted to meta)
    bridge.user_reply("hello")
    result2 = poll_inbound(store, bridge)
    assert result2.processed == 1 and result2.unrouted == 1


def test_fifo_routing_of_multiple_questions(setup):
    store, bridge = setup
    store.create_stream("Company")
    ask(store, bridge, "Q1 trip?", stream="trip")
    ask(store, bridge, "Q2 company?", stream="company")
    bridge.user_reply("answer one")
    bridge.user_reply("answer two")
    poll_inbound(store, bridge)
    assert "answer one" in store.list_events("trip")[-1].content
    assert "answer two" in store.list_events("company")[-1].content


def test_unrouted_reply_captured_to_meta(setup):
    store, bridge = setup
    poll_inbound(store, bridge)  # anchor cursor
    bridge.user_reply("random thought, no question pending")
    poll_inbound(store, bridge)
    assert any("random thought" in e.content for e in store.list_events("meta"))


def test_cursor_advances_no_reprocess(setup):
    store, bridge = setup
    ask(store, bridge, "Q?", stream="trip")
    bridge.user_reply("a")
    poll_inbound(store, bridge)
    assert poll_inbound(store, bridge).processed == 0  # nothing new


def test_send_is_plain_outbound(setup):
    store, bridge = setup
    send(store, bridge, "heads up: digest is ready")
    assert bridge.sent == ["heads up: digest is ready"]


def test_signature_is_appended_but_question_stored_clean(setup):
    store, bridge = setup
    ask(store, bridge, "Proceed?", stream="trip", signature="Mr. Streams")
    assert bridge.sent == ["Proceed?\n\n— Mr. Streams"]
    # the recorded/logged question stays unsigned
    bridge.user_reply("yes")
    poll_inbound(store, bridge)
    assert "Q: Proceed?\nA: yes" in store.list_events("trip")[-1].content
