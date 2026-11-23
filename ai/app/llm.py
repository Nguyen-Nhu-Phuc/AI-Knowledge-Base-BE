from __future__ import annotations

import hashlib
import math
import re
from typing import Any, Optional

import httpx

from app.config import settings


def _mock_embedding(text: str, dims: int = 1536) -> list[float]:
    """Deterministic pseudo-embedding for local/dev without API keys."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values: list[float] = []
    seed = digest
    while len(values) < dims:
        seed = hashlib.sha256(seed).digest()
        for b in seed:
            values.append((b / 255.0) * 2 - 1)
            if len(values) >= dims:
                break
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


def _l2_normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


def _fit_dims(vector: list[float], dims: int) -> list[float]:
    """Pad or truncate so vectors always match pgvector column size."""
    if len(vector) == dims:
        return vector
    if len(vector) > dims:
        return _l2_normalize(vector[:dims])
    return _l2_normalize(vector + [0.0] * (dims - len(vector)))


def _resolve_embedding_provider(override: Optional[str] = None) -> str:
    provider = (override or settings.embedding_provider or "mock").lower()
    if provider == "openai" and not settings.openai_api_key:
        return "mock"
    if provider == "gemini" and not settings.gemini_api_key:
        return "mock"
    if provider not in {"mock", "openai", "gemini"}:
        return "mock"
    return provider


def _resolve_llm_provider(override: Optional[str] = None) -> str:
    provider = (override or settings.llm_provider or "mock").lower()
    if provider == "openai" and not settings.openai_api_key:
        return "mock"
    if provider == "gemini" and not settings.gemini_api_key:
        return "mock"
    if provider not in {"mock", "openai", "gemini"}:
        return "mock"
    return provider


async def _embed_openai(texts: list[str], dims: int) -> tuple[list[list[float]], str, int]:
    model = settings.embedding_model
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.openai_base_url.rstrip('/')}/embeddings",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={"model": model, "input": texts},
        )
        response.raise_for_status()
        data = response.json()
        vectors = [_fit_dims(item["embedding"], dims) for item in data["data"]]
        usage = data.get("usage", {})
        tokens_in = int(usage.get("total_tokens", sum(max(1, (len(t) + 3) // 4) for t in texts)))
        return vectors, model, tokens_in


def _gemini_headers() -> dict[str, str]:
    # Prefer header auth so keys never appear in URLs / 401 error messages.
    key = (settings.gemini_api_key or "").strip()
    return {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
    }


async def _embed_gemini(texts: list[str], dims: int) -> tuple[list[list[float]], str, int]:
    model = settings.gemini_embedding_model
    url = f"{settings.gemini_base_url.rstrip('/')}/models/{model}:batchEmbedContents"
    requests = []
    for text in texts:
        body: dict[str, Any] = {
            "model": f"models/{model}",
            "content": {"parts": [{"text": text}]},
        }
        # gemini-embedding-001 supports outputDimensionality (incl. 1536)
        if "embedding" in model:
            body["outputDimensionality"] = dims
        requests.append(body)

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            url, headers=_gemini_headers(), json={"requests": requests}
        )
        if response.status_code == 401:
            raise RuntimeError(
                "Gemini API key invalid/revoked (401). Create a new key at "
                "https://aistudio.google.com/apikey and set GEMINI_API_KEY."
            )
        response.raise_for_status()
        data = response.json()
        embeddings = data.get("embeddings") or []
        vectors = [
            _fit_dims(item.get("values") or [], dims) for item in embeddings
        ]
        if len(vectors) != len(texts):
            raise RuntimeError("Gemini embedding count mismatch")
        tokens_in = sum(max(1, (len(t) + 3) // 4) for t in texts)
        return vectors, model, tokens_in


async def embed_texts(
    texts: list[str],
    *,
    provider: Optional[str] = None,
) -> tuple[list[list[float]], str, str, int]:
    """
    Returns embeddings, provider, model, approx tokens_in.
    """
    resolved = _resolve_embedding_provider(provider)
    dims = settings.embedding_dimensions
    tokens_est = sum(max(1, (len(t) + 3) // 4) for t in texts)

    if resolved == "mock":
        return (
            [_mock_embedding(t, dims) for t in texts],
            "mock",
            settings.embedding_model,
            tokens_est,
        )

    if resolved == "openai":
        vectors, model, tokens_in = await _embed_openai(texts, dims)
        return vectors, "openai", model, tokens_in

    vectors, model, tokens_in = await _embed_gemini(texts, dims)
    return vectors, "gemini", model, tokens_in


async def _chat_openai(
    *,
    system: str,
    messages: list[dict[str, str]],
    temperature: float,
) -> tuple[str, str, int, int]:
    model = settings.llm_model
    payload_messages = [{"role": "system", "content": system}, *messages]
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{settings.openai_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={
                "model": model,
                "temperature": temperature,
                "messages": payload_messages,
            },
        )
        response.raise_for_status()
        data = response.json()
        answer = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        return (
            answer,
            model,
            int(usage.get("prompt_tokens", 0)),
            int(usage.get("completion_tokens", 0)),
        )


def _gemini_llm_model_chain() -> list[str]:
    primary = (settings.gemini_llm_model or "").strip()
    extras = [
        m.strip()
        for m in (settings.gemini_llm_fallbacks or "").split(",")
        if m.strip()
    ]
    seen: set[str] = set()
    ordered: list[str] = []
    for m in [primary, *extras]:
        if m and m not in seen:
            seen.add(m)
            ordered.append(m)
    return ordered or ["gemini-2.5-flash"]


async def _chat_gemini(
    *,
    system: str,
    messages: list[dict[str, str]],
    temperature: float,
) -> tuple[str, str, int, int]:
    import asyncio

    contents: list[dict[str, Any]] = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})

    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": temperature},
    }

    models = _gemini_llm_model_chain()
    retries = max(0, int(getattr(settings, "gemini_llm_retries", 2) or 0))
    last_err = "Gemini request failed"

    async with httpx.AsyncClient(timeout=120.0) as client:
        for model in models:
            url = (
                f"{settings.gemini_base_url.rstrip('/')}"
                f"/models/{model}:generateContent"
            )
            for attempt in range(retries + 1):
                try:
                    response = await client.post(
                        url, headers=_gemini_headers(), json=payload
                    )
                except (httpx.TimeoutException, httpx.TransportError) as exc:
                    last_err = f"Gemini timeout/network on {model}: {exc.__class__.__name__}"
                    if attempt < retries:
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    break

                if response.status_code == 401:
                    raise RuntimeError(
                        "Gemini API key invalid/revoked (401). Create a new key at "
                        "https://aistudio.google.com/apikey and set GEMINI_API_KEY."
                    )

                if response.status_code in {429, 503}:
                    last_err = (
                        f"Gemini {model} unavailable ({response.status_code})."
                    )
                    if attempt < retries:
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    break

                if response.status_code >= 400:
                    try:
                        detail = (response.json().get("error") or {}).get(
                            "message"
                        ) or response.text
                    except Exception:
                        detail = response.text
                    last_err = f"Gemini {model} HTTP {response.status_code}: {str(detail)[:180]}"
                    break

                data = response.json()
                candidates = data.get("candidates") or []
                if not candidates:
                    last_err = f"Gemini {model} returned no candidates"
                    break
                parts = candidates[0].get("content", {}).get("parts") or []
                answer = "".join(str(p.get("text") or "") for p in parts).strip()
                if not answer:
                    last_err = f"Gemini {model} returned empty answer"
                    break
                usage = data.get("usageMetadata") or {}
                return (
                    answer,
                    model,
                    int(usage.get("promptTokenCount", 0)),
                    int(usage.get("candidatesTokenCount", 0)),
                )

    raise RuntimeError(
        f"{last_err} Tried models: {', '.join(models)}. Retry shortly."
    )


def _tokenize(text: str) -> set[str]:
    return {
        t
        for t in re.findall(
            r"[a-zA-Z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+",
            text.lower(),
        )
        if len(t) > 1
    }


def _clean_snippet(text: str) -> str:
    from app.ocr import clean_ocr_text, is_ocr_junk_line

    cleaned = clean_ocr_text(text)
    keep = [ln for ln in cleaned.splitlines() if ln.strip() and not is_ocr_junk_line(ln)]
    return " ".join(keep)


def _relevant_sentences(text: str, q_tokens: set[str], *, limit: int = 3) -> list[str]:
    parts = re.split(r"(?<=[\.!?…:;])\s+|\n+", text)
    scored: list[tuple[int, str]] = []
    for part in parts:
        s = part.strip(" -•\t")
        if len(s) < 12:
            continue
        st = _tokenize(s)
        hit = len(q_tokens & st)
        if hit <= 0:
            continue
        # Prefer denser overlap
        scored.append((hit * 10 + min(len(s), 180) // 20, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[str] = []
    seen: set[str] = set()
    for _, s in scored:
        key = s[:80].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s if len(s) <= 280 else s[:277].rstrip() + "…")
        if len(out) >= limit:
            break
    return out


def _mock_answer_from_messages(messages: list[dict[str, str]]) -> str:
    """Extractive mock answer so local demo is readable without API keys."""
    user_msgs = [m["content"] for m in messages if m.get("role") == "user"]
    joined = "\n".join(user_msgs)

    question = ""
    qm = re.search(r"(?is)Question:\s*(.+?)\n\nContext:", joined)
    if qm:
        question = qm.group(1).strip()
    else:
        question = (user_msgs[-1] if user_msgs else "").strip().split("\n")[0][:200]

    blocks: list[tuple[int, str]] = []
    for m in re.finditer(r"\[(\d+)\]\s*(.*?)(?=\n\[\d+\]|\Z)", joined, flags=re.S):
        idx = int(m.group(1))
        body = _clean_snippet(m.group(2))
        if body:
            blocks.append((idx, body))

    vi = bool(
        re.search(
            r"[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]",
            question,
            re.I,
        )
    )

    if not blocks:
        if "Context:" not in joined and question:
            return question
        return (
            "Không tìm thấy đủ ngữ cảnh sạch trong tài liệu để trả lời. "
            "Hãy Xử lý lại tài liệu (OCR) hoặc hỏi cụ thể hơn."
            if vi
            else "Not enough clean context in the documents. Reprocess OCR or refine the question."
        )

    q_tokens = _tokenize(question)
    # Drop stopwords that over-match (single weak words like "tay" alone)
    q_tokens -= {
        "như",
        "nao",
        "nào",
        "the",
        "and",
        "for",
        "with",
        "how",
        "what",
        "cau",
        "hỏi",
        "hoi",
        "các",
        "cua",
        "của",
        "cho",
        "khi",
        "là",
        "va",
        "và",
    }
    # Common short tokens only count inside a multi-hit / phrase
    weak = {"tay", "tay", "day", "muc", "buoc", "bước"}

    def score(text: str) -> int:
        if not q_tokens:
            return 0
        lower = text.lower()
        st = _tokenize(text)
        strong = q_tokens - weak
        hit_strong = len(strong & st)
        hit_weak = len((q_tokens & weak) & st)
        # Phrase boost for 2+ consecutive query words
        q_words = [w for w in re.findall(r"\w+", question.lower(), flags=re.UNICODE) if len(w) > 1]
        phrase = 0
        for i in range(len(q_words) - 1):
            if f"{q_words[i]} {q_words[i + 1]}" in lower:
                phrase += 3
        total = hit_strong * 3 + hit_weak + phrase
        # Need meaningful overlap: phrase or ≥2 strong hits or (1 strong + weak)
        if phrase >= 3:
            return total
        if hit_strong >= 2:
            return total
        if hit_strong >= 1 and hit_weak >= 1:
            return total
        return 0

    ranked = sorted(blocks, key=lambda b: score(b[1]), reverse=True)
    matched = [b for b in ranked if score(b[1]) > 0]
    # Require at least one content token hit — never dump unrelated top chunks
    if not matched:
        return (
            f"Không tìm thấy đoạn tài liệu đủ liên quan tới “{question}”. "
            "Thử hỏi bằng từ khóa đúng trong tài liệu (vd. đúng tên mục), "
            "hoặc Xử lý lại file OCR."
            if vi
            else f"No sufficiently related passages for “{question}”. Try different keywords or reprocess OCR."
        )

    bullets: list[str] = []
    cites: list[str] = []
    for idx, body in matched[:4]:
        sentences = _relevant_sentences(body, q_tokens, limit=2)
        if not sentences:
            # Fall back to a short cleaned head only if the whole block matched
            snippet = body[:240].rstrip(" ,;.")
            if len(body) > 240:
                snippet += "…"
            sentences = [snippet]
        for s in sentences:
            bullets.append(f"- {s} [{idx}]")
        cites.append(f"[{idx}]")
        if len(bullets) >= 4:
            break

    # Dedupe citation labels while preserving order
    cite_str = " ".join(dict.fromkeys(cites))
    if vi:
        header = f"Theo tài liệu liên quan tới câu hỏi “{question}”:"
        footer = f"Nguồn: {cite_str}"
    else:
        header = f"From the documents about “{question}”:"
        footer = f"Sources: {cite_str}"

    return f"{header}\n" + "\n".join(bullets) + f"\n\n{footer}"


async def chat_complete(
    *,
    system: str,
    messages: list[dict[str, str]],
    temperature: float = 0.2,
    provider: Optional[str] = None,
) -> tuple[str, str, str, int, int]:
    """
    Returns answer, provider, model, tokens_in, tokens_out.
    """
    resolved = _resolve_llm_provider(provider)

    if resolved == "mock":
        joined = "\n".join(m["content"] for m in messages if m.get("role") == "user")
        answer = _mock_answer_from_messages(messages)
        tin = max(1, (len(system) + len(joined) + 3) // 4)
        tout = max(1, (len(answer) + 3) // 4)
        return answer, "mock", settings.llm_model, tin, tout

    if resolved == "openai":
        answer, model, tin, tout = await _chat_openai(
            system=system, messages=messages, temperature=temperature
        )
        return answer, "openai", model, tin, tout

    answer, model, tin, tout = await _chat_gemini(
        system=system, messages=messages, temperature=temperature
    )
    return answer, "gemini", model, tin, tout


def rewrite_query_heuristic(query: str) -> str:
    q = re.sub(r"\s+", " ", query).strip()
    q = re.sub(r"^(please|pls|cho hỏi|hãy)\s+", "", q, flags=re.I)
    return q


def rewrite_query(query: str) -> str:
    """Sync heuristic fallback (kept for callers that cannot await)."""
    return rewrite_query_heuristic(query)


async def rewrite_query_llm(
    query: str,
    *,
    provider: Optional[str] = None,
) -> str:
    """LLM rewrite for retrieval; falls back to heuristic on failure."""
    base = rewrite_query_heuristic(query)
    if not base:
        return base
    try:
        answer, _prov, _model, _tin, _tout = await chat_complete(
            system=(
                "Rewrite the user question into a short search query for a document "
                "knowledge base. Keep the original language. Output ONLY the rewritten "
                "query, no quotes or explanation."
            ),
            messages=[{"role": "user", "content": base}],
            temperature=0.0,
            provider=provider,
        )
        cleaned = rewrite_query_heuristic(answer.splitlines()[0] if answer else "")
        return cleaned or base
    except Exception:  # noqa: BLE001
        return base


def validate_citations(answer: str, allowed_indices: set[int]) -> str:
    def repl(match: re.Match[str]) -> str:
        idx = int(match.group(1))
        return match.group(0) if idx in allowed_indices else ""

    cleaned = re.sub(r"\[(\d+)\]", repl, answer)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def assemble_context(chunks: list[dict[str, Any]], max_tokens: int) -> tuple[str, list[dict[str, Any]]]:
    from app.ocr import clean_ocr_text

    used: list[dict[str, Any]] = []
    parts: list[str] = []
    total = 0
    for i, chunk in enumerate(chunks, start=1):
        raw = str(chunk.get("content") or "")
        content = clean_ocr_text(raw) or raw
        tokens = int(chunk.get("token_count") or max(1, (len(content) + 3) // 4))
        if total + tokens > max_tokens and used:
            break
        parts.append(f"[{i}] {content}")
        used.append({**chunk, "content": content, "citation_index": i})
        total += tokens
    return "\n\n".join(parts), used


def provider_capabilities() -> dict[str, Any]:
    return {
        "embedding": {
            "default": settings.embedding_provider,
            "options": ["mock", "openai", "gemini"],
            "openai_ready": bool(settings.openai_api_key),
            "gemini_ready": bool(settings.gemini_api_key),
            "model_openai": settings.embedding_model,
            "model_gemini": settings.gemini_embedding_model,
            "dimensions": settings.embedding_dimensions,
        },
        "llm": {
            "default": settings.llm_provider,
            "options": ["mock", "openai", "gemini"],
            "openai_ready": bool(settings.openai_api_key),
            "gemini_ready": bool(settings.gemini_api_key),
            "model_openai": settings.llm_model,
            "model_gemini": settings.gemini_llm_model,
        },
        "ocr": {
            "enabled": settings.ocr_enabled,
            "lang": settings.ocr_lang,
        },
    }
