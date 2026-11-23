from app.chunking import chunk_text, estimate_tokens


def test_estimate_tokens():
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("a" * 40) == 10


def test_chunk_text_splits_long_content():
    text = "\n\n".join([f"Paragraph {i}. " + ("word " * 80) for i in range(20)])
    chunks = chunk_text(text, chunk_size_tokens=200, chunk_overlap_tokens=20)
    assert len(chunks) > 1
    assert chunks[0]["chunk_index"] == 0
    assert all(c["token_count"] > 0 for c in chunks)
