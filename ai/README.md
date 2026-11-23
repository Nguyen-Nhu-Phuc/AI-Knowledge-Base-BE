# AI Service (FastAPI)

Parse/chunk · Embed · Generate (RAG) · Research · OCR.

## Run

```bash
cd apps/ai
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Optional OCR (macOS): brew install tesseract tesseract-lang
uvicorn app.main:app --reload --port 8000
```

## Capabilities

| Capability | Providers | Notes |
|---|---|---|
| **Text → Vector** | `mock` / `openai` / `gemini` | `EMBEDDING_PROVIDER`; Gemini padded to 1536 dims |
| **Text → Answer** | `mock` / `openai` / `gemini` | `LLM_PROVIDER` |
| **Image → Text (OCR)** | Tesseract | Images + scanned PDF pages; `OCR_ENABLED` |

Set `OPENAI_API_KEY` and/or `GEMINI_API_KEY` in `.env`. Org admins can override providers in web **Settings**.

## Endpoints (header `X-AI-Service-Secret`)

| Method | Path | Mục đích |
|--------|------|----------|
| GET | `/health` | Health + provider/OCR status |
| POST | `/v1/ingest/parse-chunk` | Parse PDF/DOCX/TXT/MD/images + chunk |
| POST | `/v1/ocr` | Image → text (OCR) |
| POST | `/v1/embed` | Text → Vector |
| POST | `/v1/generate` | Text → Answer (RAG + citations) |
| POST | `/v1/agent/research` | Research Mode |
