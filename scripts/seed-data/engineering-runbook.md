# Engineering Runbook — Local AI Knowledge Base

## Services

| Service | Port | Health |
|---------|------|--------|
| Web (Next.js) | 3000 | http://127.0.0.1:3000 |
| API (NestJS) | 3001 | /api/v1/health |
| AI (FastAPI) | 8000 | /health |
| MinIO | 9000 / 9001 | /minio/health/live |
| Postgres | 5432 | pg_isready |
| Redis | 6379 | PING |

## Common incidents

### Documents stuck in `processing`

1. Check worker logs (`/tmp/akb-logs/worker.log`).
2. Confirm AI service is up and `AI_SERVICE_SECRET` matches.
3. Confirm MinIO bucket `ai-knowledge-base` exists.
4. Retry the job from document detail or Admin → Jobs.

### Search returns empty

- Ensure document status is `ready`.
- Confirm chunks exist for the current document version.
- Embedding provider may be `mock` in local demo — still searchable via FTS.

### Auth stuck on Loading

- Hard refresh the browser.
- Clear `localStorage` key `akb-auth` if hydrate is corrupted.
- Confirm API proxy `/api/v1` reaches Nest on port 3001.

## Deploy notes

Local demo uses mock LLM/embeddings. Point `OPENAI_API_KEY` and set providers to `openai` for real answers.
