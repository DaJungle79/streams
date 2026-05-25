from streams.notedoc import (
    NoteDocument,
    NoteLine,
    make_zone,
    notes_text,
    parse_text,
    serialize_text,
)


def sample_doc() -> NoteDocument:
    return NoteDocument(
        title="Bali Trip",
        zones=[
            make_zone("agent", [NoteLine("current state: planning")]),
            make_zone("goals", [NoteLine("Relax", item_id="g1")]),
            make_zone(
                "todos",
                [
                    NoteLine("Book flights", item_id="t1", checked=False),
                    NoteLine("Renew passport", item_id="t2", checked=True),
                    NoteLine("Confirm visa", item_id="t3", checked=False, agent=True),
                ],
            ),
            make_zone("notes", [NoteLine("villa near Ubud"), NoteLine(""), NoteLine("budget ok")]),
            make_zone("events", [NoteLine("2026-05-25 · decision: picked dates")]),
        ],
    )


def test_serialize_shows_checkboxes_and_marker():
    text = serialize_text(sample_doc())
    assert "- [ ] Book flights" in text
    assert "- [x] Renew passport" in text
    assert "- [ ] 🤖 Confirm visa" in text  # FR-11 marker
    assert "🤖 Agent" in text


def test_text_roundtrip_preserves_user_content():
    doc = sample_doc()
    back = parse_text(serialize_text(doc))
    assert back.title == "Bali Trip"

    todos = back.zone("todos").lines
    assert [(l.text, l.checked, l.agent) for l in todos] == [
        ("Book flights", False, False),
        ("Renew passport", True, False),
        ("Confirm visa", False, True),
    ]
    assert [l.text for l in back.zone("goals").lines] == ["Relax"]
    assert notes_text(back) == "villa near Ubud\n\nbudget ok"


def test_item_ids_not_recoverable_from_text():
    back = parse_text(serialize_text(sample_doc()))
    assert all(l.item_id is None for l in back.zone("todos").lines)


def test_parse_tolerates_missing_zone():
    text = "Title\n\nTo-dos\n- [ ] only todos here\n"
    doc = parse_text(text)
    assert doc.zone("goals") is None
    assert [l.text for l in doc.zone("todos").lines] == ["only todos here"]


def test_tag_rendered_under_title_and_ignored_on_parse():
    doc = sample_doc()
    doc.tag = "#stream"
    text = serialize_text(doc)
    assert text.splitlines()[1] == "#stream"  # right under the title
    # the tag is read-only metadata: it doesn't leak into any zone on parse
    back = parse_text(text)
    assert back.title == "Bali Trip"
    assert all("#stream" not in l.text for z in back.zones for l in z.lines)
