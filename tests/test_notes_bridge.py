"""The Apple Notes HTML round-trip (doc_to_html <-> html_to_text).

The fake bridge round-trips via plain text, so these guard the real bridge's
HTML path directly — where a <br>+</div> per blank line used to DOUBLE blank
lines on every sync, growing a note without bound.
"""

from streams.notedoc import NoteDocument, NoteLine, make_zone, parse_text
from streams.notes_bridge import doc_to_html, html_to_text


def _apple_reformat(html: str) -> str:
    """Mimic how Apple Notes re-stores HTML: each tag on its own line."""
    return html.replace("><", ">\n<")


def _roundtrip(doc: NoteDocument, *, apple: bool = False) -> NoteDocument:
    body = doc_to_html(doc)
    if apple:
        body = _apple_reformat(body)
    return parse_text(html_to_text(body))


def test_blank_lines_stable_across_roundtrips():
    doc = NoteDocument(title="T", zones=[make_zone("notes", [NoteLine("a"), NoteLine(""), NoteLine("b")])])
    for _ in range(5):
        doc = _roundtrip(doc)
        assert [l.text for l in doc.zone("notes").lines] == ["a", "", "b"]  # no growth


def test_blank_lines_stable_with_apple_reformatting():
    # Apple pretty-prints stored HTML with newlines between tags; the round-trip
    # must still not grow blank lines (the bug that ballooned a note to 193k lines).
    doc = NoteDocument(title="T", zones=[make_zone("notes", [NoteLine("a"), NoteLine(""), NoteLine("b")])])
    for _ in range(8):
        doc = _roundtrip(doc, apple=True)
        assert [l.text for l in doc.zone("notes").lines] == ["a", "", "b"]


def test_soft_break_splits_into_lines():
    assert html_to_text("<div>a<br>b</div>") == "a\nb\n"


def test_content_survives_roundtrip():
    doc = NoteDocument(
        title="Trip",
        zones=[
            make_zone("todos", [NoteLine("Book flights", checked=False)]),
            make_zone("notes", [NoteLine("remember sunscreen")]),
        ],
    )
    back = _roundtrip(doc)
    assert back.title == "Trip"
    assert [l.text for l in back.zone("todos").lines] == ["Book flights"]
    assert [l.text for l in back.zone("notes").lines] == ["remember sunscreen"]
