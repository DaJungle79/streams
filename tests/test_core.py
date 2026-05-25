from streams.core import new_id, slugify


def test_slugify():
    assert slugify("Bali Trip") == "bali-trip"
    assert slugify("  Multi   Word -- Title!! ") == "multi-word-title"
    assert slugify("Æøå 123") == "123"  # non-ascii stripped
    assert slugify("!!!") == "stream"  # fallback


def test_new_id_shape():
    tid = new_id("t")
    assert tid.startswith("t_")
    assert len(tid) == 2 + 8
    assert new_id("t") != new_id("t")
