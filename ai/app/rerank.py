from __future__ import annotations

import math
import re
from typing import Any


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-zA-Z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+", text.lower()) if len(t) > 1}


def _lexical_score(query: str, content: str) -> float:
    q = _tokenize(query)
    if not q:
        return 0.0
    d = _tokenize(content)
    if not d:
        return 0.0
    overlap = len(q & d)
    base = overlap / math.sqrt(len(q) * len(d))
    # Phrase boost: reward consecutive query terms appearing nearby
    ql = query.lower()
    cl = content.lower()
    boost = 0.0
    q_words = [w for w in re.findall(r"\w+", ql, flags=re.UNICODE) if len(w) > 1]
    for i in range(len(q_words) - 1):
        phrase = f"{q_words[i]} {q_words[i + 1]}"
        if phrase in cl:
            boost += 0.25
    # Soft-penalize heavy OCR garbage in content
    junk = len(re.findall(r"(?:[A-Za-z]\s+){4,}[A-Za-z]|[£ˆ`|\\]{2,}", content))
    return max(0.0, base + boost - min(0.4, junk * 0.05))


def rerank_documents(
    query: str,
    documents: list[dict[str, Any]],
    *,
    top_n: int | None = None,
) -> list[dict[str, Any]]:
    """
    Local lexical + prior-score blend. No external vendor required.
    Each document may include: content, score (prior retrieval score).
    Returns documents sorted by rerank_score desc, with rerank_score set.
    """
    scored: list[dict[str, Any]] = []
    for doc in documents:
        content = str(doc.get("content") or "")
        prior = float(doc.get("score") or 0.0)
        lex = _lexical_score(query, content)
        # Blend: emphasize lexical match while keeping retrieval prior
        blend = 0.65 * lex + 0.35 * max(0.0, prior)
        scored.append({**doc, "rerank_score": blend, "lexical_score": lex})

    scored.sort(key=lambda d: float(d.get("rerank_score") or 0.0), reverse=True)
    if top_n is not None:
        return scored[: max(1, top_n)]
    return scored
