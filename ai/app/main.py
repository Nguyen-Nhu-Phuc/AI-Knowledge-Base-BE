from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.chunking import chunk_text
from app.config import settings
from app.llm import (
    assemble_context,
    chat_complete,
    embed_texts,
    provider_capabilities,
    rewrite_query,
    rewrite_query_llm,
    validate_citations,
)
from app.rerank import rerank_documents
from app.dlp import redact_text, redact_texts
from app.ocr import image_to_text, ocr_available
from app.parsing import parse_document
from app.schemas import ParseChunkResponse
from app.security import require_service_secret

app = FastAPI(title=settings.app_name, version="0.3.0")


class EmbedRequest(BaseModel):
    texts: List[str] = Field(min_length=1, max_length=128)
    provider: Optional[str] = None  # mock | openai | gemini
    dlp: Optional[bool] = None


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    provider: str
    model: str
    tokens_in: int
    dimensions: int


class GenerateRequest(BaseModel):
    query: str
    chunks: List[dict] = Field(default_factory=list)
    history: List[Dict[str, str]] = Field(default_factory=list)
    rewrite: bool = False
    max_context_tokens: Optional[int] = None
    provider: Optional[str] = None  # mock | openai | gemini
    system_prompt: Optional[str] = None
    dlp: Optional[bool] = None


class GenerateResponse(BaseModel):
    answer: str
    rewritten_query: Optional[str] = None
    citations: List[dict]
    provider: str
    model: str
    tokens_in: int
    tokens_out: int


class ResearchRequest(BaseModel):
    query: str
    chunks: List[dict] = Field(default_factory=list)
    max_steps: int = 3
    max_context_tokens: Optional[int] = None
    provider: Optional[str] = None


class ResearchResponse(BaseModel):
    answer: str
    steps: List[dict]
    citations: List[dict]
    provider: str
    model: str
    tokens_in: int
    tokens_out: int


class OcrResponse(BaseModel):
    text: str
    char_count: int
    provider: str = "tesseract"
    lang: str


@app.get("/health")
async def health():
    caps = provider_capabilities()
    return {
        "status": "ok",
        "service": "ai",
        "embedding_provider": settings.embedding_provider,
        "llm_provider": settings.llm_provider,
        "ocr_enabled": settings.ocr_enabled,
        "ocr_available": ocr_available(),
        "capabilities": caps,
    }


@app.post(
    f"{settings.api_prefix}/ingest/parse-chunk",
    response_model=ParseChunkResponse,
    dependencies=[Depends(require_service_secret)],
)
async def parse_and_chunk(
    file: UploadFile = File(...),
    mime_type: str = Form(...),
    filename: Optional[str] = Form(default=None),
    chunk_size_tokens: Optional[int] = Form(default=None),
    chunk_overlap_tokens: Optional[int] = Form(default=None),
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(data) > settings.max_file_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large",
        )

    name = filename or file.filename or "upload.bin"
    try:
        parsed = parse_document(data, mime_type=mime_type, filename=name)
        chunks = chunk_text(
            parsed["text"],
            chunk_size_tokens=chunk_size_tokens or settings.chunk_size_tokens,
            chunk_overlap_tokens=chunk_overlap_tokens
            or settings.chunk_overlap_tokens,
            pages=parsed.get("pages"),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return ParseChunkResponse(
        parser=parsed["parser"],
        page_count=parsed.get("page_count"),
        char_count=len(parsed["text"]),
        chunk_count=len(chunks),
        chunks=chunks,
    )


@app.post(
    f"{settings.api_prefix}/ocr",
    response_model=OcrResponse,
    dependencies=[Depends(require_service_secret)],
)
async def ocr_image(
    file: UploadFile = File(...),
    lang: Optional[str] = Form(default=None),
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    try:
        text = image_to_text(data, lang=lang)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="OCR found no text in image",
        )
    return OcrResponse(
        text=text,
        char_count=len(text),
        lang=lang or settings.ocr_lang,
    )


@app.post(
    f"{settings.api_prefix}/embed",
    response_model=EmbedResponse,
    dependencies=[Depends(require_service_secret)],
)
async def embed(req: EmbedRequest):
    use_dlp = settings.dlp_enabled if req.dlp is None else req.dlp
    texts = redact_texts(req.texts) if use_dlp else req.texts
    try:
        vectors, provider, model, tokens_in = await embed_texts(
            texts, provider=req.provider
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Embedding failed: {exc}") from exc
    return EmbedResponse(
        embeddings=vectors,
        provider=provider,
        model=model,
        tokens_in=tokens_in,
        dimensions=len(vectors[0]) if vectors else settings.embedding_dimensions,
    )


@app.post(
    f"{settings.api_prefix}/generate",
    response_model=GenerateResponse,
    dependencies=[Depends(require_service_secret)],
)
async def generate(req: GenerateRequest):
    use_dlp = settings.dlp_enabled if req.dlp is None else req.dlp
    query = redact_text(req.query) if use_dlp else req.query
    chunks = req.chunks
    if use_dlp:
        chunks = [
            {**c, "content": redact_text(str(c.get("content") or ""))}
            for c in req.chunks
        ]
    rewritten = (
        await rewrite_query_llm(query, provider=req.provider)
        if req.rewrite
        else query
    )
    context, used = assemble_context(
        chunks,
        req.max_context_tokens or settings.max_context_tokens,
    )

    if not used:
        return GenerateResponse(
            answer="I could not find enough information in the knowledge base to answer this question.",
            rewritten_query=rewritten if req.rewrite else None,
            citations=[],
            provider="none",
            model="none",
            tokens_in=0,
            tokens_out=0,
        )

    system = (req.system_prompt or "").strip() or (
        "You are an enterprise knowledge assistant. Answer ONLY using the provided context. "
        "If the context is insufficient, say you do not have enough information. "
        "When making claims from context, cite sources using [n] markers that match context indices. "
        "Do not invent citations."
    )
    if "cite" not in system.lower() and "[n]" not in system.lower():
        system = (
            system
            + " Always cite sources using [n] markers that match context indices. Do not invent citations."
        )
    user_content = f"Question: {rewritten}\n\nContext:\n{context}"
    history = [{"role": h["role"], "content": h["content"]} for h in req.history[-6:]]
    messages = [*history, {"role": "user", "content": user_content}]

    try:
        answer, provider, model, tin, tout = await chat_complete(
            system=system,
            messages=messages,
            provider=req.provider,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"LLM failed: {exc}") from exc

    allowed = {int(c["citation_index"]) for c in used}
    answer = validate_citations(answer, allowed)
    citations = [
        {
            "index": c["citation_index"],
            "chunk_id": c.get("id") or c.get("chunk_id"),
            "document_id": c.get("document_id"),
            "document_version_id": c.get("document_version_id"),
            "snippet": (c.get("content") or "")[:400],
            "score": c.get("score"),
            "metadata": c.get("metadata") or {},
        }
        for c in used
    ]

    return GenerateResponse(
        answer=answer,
        rewritten_query=rewritten if req.rewrite else None,
        citations=citations,
        provider=provider,
        model=model,
        tokens_in=tin,
        tokens_out=tout,
    )


class RerankRequest(BaseModel):
    query: str
    documents: List[dict] = Field(default_factory=list)
    top_n: Optional[int] = None


class RerankResponse(BaseModel):
    results: List[dict]
    provider: str = "local_blend"


class PlanQueriesRequest(BaseModel):
    query: str
    max_queries: int = 3
    provider: Optional[str] = None


class PlanQueriesResponse(BaseModel):
    queries: List[str]
    provider: str
    model: str


@app.post(
    f"{settings.api_prefix}/rerank",
    response_model=RerankResponse,
    dependencies=[Depends(require_service_secret)],
)
async def rerank(req: RerankRequest):
    results = rerank_documents(req.query, req.documents, top_n=req.top_n)
    return RerankResponse(results=results)


@app.post(
    f"{settings.api_prefix}/agent/plan-queries",
    response_model=PlanQueriesResponse,
    dependencies=[Depends(require_service_secret)],
)
async def plan_queries(req: PlanQueriesRequest):
    """Produce follow-up search queries for multi-hop research (Nest orchestrates retrieve)."""
    n = max(1, min(req.max_queries, 5))
    try:
        raw, provider, model, _tin, _tout = await chat_complete(
            system=(
                "You plan document searches for an enterprise knowledge base. "
                f"Given a user question, output up to {n} short alternative search queries, "
                "one per line, same language as the question. No numbering or bullets."
            ),
            messages=[{"role": "user", "content": req.query}],
            temperature=0.2,
            provider=req.provider,
        )
        lines = [rewrite_query(x) for x in raw.splitlines() if x.strip()]
        # Dedupe while preserving order
        seen: set[str] = set()
        queries: list[str] = []
        for q in lines:
            key = q.lower()
            if key and key not in seen:
                seen.add(key)
                queries.append(q)
            if len(queries) >= n:
                break
        if req.query.strip() and req.query.strip().lower() not in seen:
            queries = [rewrite_query(req.query), *queries][:n]
        return PlanQueriesResponse(
            queries=queries or [rewrite_query(req.query)],
            provider=provider,
            model=model,
        )
    except Exception:  # noqa: BLE001
        return PlanQueriesResponse(
            queries=[rewrite_query(req.query)],
            provider="heuristic",
            model="none",
        )


@app.post(
    f"{settings.api_prefix}/agent/research",
    response_model=ResearchResponse,
    dependencies=[Depends(require_service_secret)],
)
async def research(req: ResearchRequest):
    """Synthesize from Nest-provided multi-hop retrieved chunks."""
    steps: list[dict] = []
    steps.append({"step": 1, "action": "plan", "detail": "Clarify question and evidence needs"})
    rewritten = await rewrite_query_llm(req.query, provider=req.provider)
    steps.append({"step": 2, "action": "analyze_context", "detail": f"Using {len(req.chunks)} retrieved chunks"})

    context, used = assemble_context(
        req.chunks,
        req.max_context_tokens or settings.max_context_tokens,
    )
    system = (
        "You are a research assistant for an enterprise knowledge base. "
        "Synthesize a structured answer from context only. Use [n] citations. "
        "Include a short 'Key findings' section and note gaps if any."
    )
    user_content = f"Research question: {rewritten}\n\nEvidence:\n{context}"
    try:
        answer, provider, model, tin, tout = await chat_complete(
            system=system,
            messages=[{"role": "user", "content": user_content}],
            temperature=0.2,
            provider=req.provider,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Research LLM failed: {exc}") from exc

    allowed = {int(c["citation_index"]) for c in used}
    answer = validate_citations(answer, allowed)
    steps.append({"step": 3, "action": "synthesize", "detail": "Drafted answer with citations"})

    citations = [
        {
            "index": c["citation_index"],
            "chunk_id": c.get("id") or c.get("chunk_id"),
            "document_id": c.get("document_id"),
            "document_version_id": c.get("document_version_id"),
            "snippet": (c.get("content") or "")[:400],
            "score": c.get("score"),
            "metadata": c.get("metadata") or {},
        }
        for c in used
    ]

    return ResearchResponse(
        answer=answer,
        steps=steps[: max(1, min(req.max_steps, 6))],
        citations=citations,
        provider=provider,
        model=model,
        tokens_in=tin,
        tokens_out=tout,
    )
