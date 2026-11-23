from __future__ import annotations

import re
from typing import Any


def estimate_tokens(text: str) -> int:
    # Lightweight approximation (~4 chars/token).
    return max(1, (len(text) + 3) // 4)


_PAGE_RE = re.compile(r"^\[Page\s+(\d+)\]\s*$", re.I | re.M)
_SHEET_RE = re.compile(r"^\[Sheet\s+(.+?)\]\s*$", re.I | re.M)
_HEADING_RE = re.compile(
    r"^(#{1,6}\s+\S.+|[A-Z0-9][A-Z0-9 \-/]{2,80}|[0-9]+(?:\.[0-9]+)*\s+\S.+)$",
    re.M,
)


def recursive_split(text: str, chunk_size: int, overlap: int) -> list[str]:
    separators = ["\n\n", "\n", ". ", " ", ""]
    return _split_recursive(text.strip(), chunk_size, overlap, separators)


def _split_recursive(
    text: str,
    chunk_size: int,
    overlap: int,
    separators: list[str],
) -> list[str]:
    if not text:
        return []
    if estimate_tokens(text) <= chunk_size:
        return [text]

    sep = separators[0]
    rest = separators[1:] if len(separators) > 1 else [""]

    if sep == "":
        approx_chars = chunk_size * 4
        overlap_chars = overlap * 4
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = min(len(text), start + approx_chars)
            chunks.append(text[start:end])
            if end >= len(text):
                break
            start = max(0, end - overlap_chars)
        return [c for c in chunks if c.strip()]

    parts = text.split(sep)
    chunks: list[str] = []
    current = ""

    for part in parts:
        candidate = part if not current else f"{current}{sep}{part}"
        if estimate_tokens(candidate) <= chunk_size:
            current = candidate
            continue

        if current:
            chunks.extend(_split_recursive(current, chunk_size, overlap, rest))
            current = ""

        if estimate_tokens(part) > chunk_size:
            chunks.extend(_split_recursive(part, chunk_size, overlap, rest))
        else:
            current = part

    if current:
        chunks.extend(_split_recursive(current, chunk_size, overlap, rest))

    if overlap <= 0 or len(chunks) <= 1:
        return [c.strip() for c in chunks if c.strip()]

    overlapped: list[str] = []
    for i, chunk in enumerate(chunks):
        if i == 0:
            overlapped.append(chunk.strip())
            continue
        prev_tail = chunks[i - 1][-overlap * 4 :]
        merged = f"{prev_tail}\n{chunk}".strip()
        if estimate_tokens(merged) <= chunk_size + overlap:
            overlapped.append(merged)
        else:
            overlapped.append(chunk.strip())
    return [c for c in overlapped if c]


def _split_by_structure(text: str) -> list[tuple[str, dict[str, Any]]]:
    """Semantic-ish split: pages, sheets, headings — keep topics together."""
    if not text.strip():
        return []

    # Normalize structural markers onto their own lines
    normalized = re.sub(r"\[Page\s+(\d+)\]", r"\n[Page \1]\n", text)
    normalized = re.sub(r"\[Sheet\s+(.+?)\]", r"\n[Sheet \1]\n", normalized)
    blocks: list[tuple[str, dict[str, Any]]] = []
    current_page: int | None = None
    current_sheet: str | None = None
    current_heading: str | None = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf
        body = "\n".join(buf).strip()
        if body:
            meta: dict[str, Any] = {"chunking": "semantic_structure"}
            if current_page is not None:
                meta["page"] = current_page
            if current_sheet:
                meta["sheet"] = current_sheet
            if current_heading:
                meta["heading"] = current_heading
            blocks.append((body, meta))
        buf = []

    for line in normalized.splitlines():
        stripped = line.strip()
        page_m = _PAGE_RE.match(stripped)
        if page_m:
            flush()
            current_page = int(page_m.group(1))
            current_heading = None
            continue
        sheet_m = _SHEET_RE.match(stripped)
        if sheet_m:
            flush()
            current_sheet = sheet_m.group(1).strip()
            current_heading = None
            continue
        if _HEADING_RE.match(stripped) and len(stripped) < 120:
            flush()
            current_heading = stripped.lstrip("#").strip()
            buf.append(line)
            continue
        buf.append(line)
    flush()
    return blocks or [(text.strip(), {"chunking": "semantic_structure"})]


def chunk_text(
    text: str,
    *,
    chunk_size_tokens: int,
    chunk_overlap_tokens: int,
    pages: list[dict[str, Any]] | None = None,
    min_tokens: int | None = None,
) -> list[dict[str, Any]]:
    from app.config import settings

    floor = min_tokens if min_tokens is not None else settings.chunk_min_tokens
    structured = _split_by_structure(text)
    pieces: list[tuple[str, dict[str, Any]]] = []

    for block, meta in structured:
        if estimate_tokens(block) <= chunk_size_tokens:
            pieces.append((block, meta))
        else:
            for part in recursive_split(block, chunk_size_tokens, chunk_overlap_tokens):
                pieces.append((part, dict(meta)))

    # Merge tiny trailing fragments into previous chunk when possible
    merged: list[tuple[str, dict[str, Any]]] = []
    for content, meta in pieces:
        if (
            merged
            and estimate_tokens(content) < floor
            and estimate_tokens(merged[-1][0]) + estimate_tokens(content)
            <= chunk_size_tokens
        ):
            prev, prev_meta = merged[-1]
            merged[-1] = (f"{prev}\n\n{content}".strip(), prev_meta)
        else:
            merged.append((content, meta))

    results: list[dict[str, Any]] = []
    for idx, (content, meta) in enumerate(merged):
        metadata: dict[str, Any] = {"chunk_index": idx, "source": "smart_chunk", **meta}
        if "page" not in metadata and pages:
            for page in pages:
                page_text = (page.get("text") or "")[:200]
                if page_text and page_text in content:
                    metadata["page"] = page.get("page")
                    break
            if "page" not in metadata:
                m = re.search(r"\[Page (\d+)\]", content)
                if m:
                    metadata["page"] = int(m.group(1))

        results.append(
            {
                "chunk_index": idx,
                "content": content,
                "token_count": estimate_tokens(content),
                "metadata": metadata,
            }
        )
    return results
