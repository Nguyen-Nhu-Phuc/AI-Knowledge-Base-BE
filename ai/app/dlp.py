"""Lightweight PII / secret redaction before embed or generate."""

from __future__ import annotations

import re
from typing import List

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(
    r"(?<!\d)(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}(?!\d)"
)
_CC = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
_VN_CCCD = re.compile(r"\b\d{9}(?:\d{3})?\b")
_API_KEYISH = re.compile(
    r"\b(?:sk-|AIza|AQ\.|ghp_|xox[baprs]-)[A-Za-z0-9_\-]{8,}\b"
)


def redact_text(text: str) -> str:
    if not text:
        return text
    out = _EMAIL.sub("[REDACTED_EMAIL]", text)
    out = _API_KEYISH.sub("[REDACTED_SECRET]", out)
    out = _CC.sub("[REDACTED_CARD]", out)
    # phones after cards to avoid partial overlaps
    out = _PHONE.sub("[REDACTED_PHONE]", out)
    return out


def redact_texts(texts: List[str]) -> List[str]:
    return [redact_text(t) for t in texts]
