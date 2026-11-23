# AI Service (FastAPI)

Parse / chunk · Embed · Generate (RAG) · Research · OCR.

## Chạy (trong repo BE)

```bash
cd ai
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Tuỳ chọn OCR (macOS): brew install tesseract tesseract-lang
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health: `http://localhost:8000/health`

`SERVICE_SECRET` phải khớp `AI_SERVICE_SECRET` bên `api/.env`.

## Capabilities

| Capability | Providers | Env |
|---|---|---|
| Text → Vector | `mock` / `openai` / `gemini` | `EMBEDDING_PROVIDER` |
| Text → Answer | `mock` / `openai` / `gemini` | `LLM_PROVIDER` |
| Image → Text (OCR) | Tesseract | `OCR_ENABLED` |

Mặc định **mock** — không cần API key.

## Endpoints (header `X-AI-Service-Secret`)

| Method | Path | Mục đích |
|--------|------|----------|
| GET | `/health` | Health + provider/OCR |
| POST | `/v1/ingest/parse-chunk` | Parse + chunk |
| POST | `/v1/ocr` | OCR |
| POST | `/v1/embed` | Embedding |
| POST | `/v1/generate` | RAG answer |
| POST | `/v1/agent/research` | Research mode |
