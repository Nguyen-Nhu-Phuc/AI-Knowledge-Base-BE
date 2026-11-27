# Enterprise AI Knowledge Base

Hệ thống quản lý tri thức doanh nghiệp (Advanced RAG + AI Agent).

## Repos trên GitHub

| Phần | Repo |
|------|------|
| Backend (API + AI) | https://github.com/Nguyen-Nhu-Phuc/AI-Knowledge-Base-BE |
| Frontend (Next.js) | https://github.com/Nguyen-Nhu-Phuc/AI-Knowledge-Base-FE |

Monorepo local:

| Path | Nội dung |
|------|----------|
| `apps/api` | NestJS API + workers |
| `apps/ai` | FastAPI embed / LLM / OCR |
| `apps/web` | Next.js frontend |
| `infra/docker` | Postgres + Redis + MinIO |

Hướng dẫn dùng: [`HUONG_DAN_SU_DUNG.md`](./HUONG_DAN_SU_DUNG.md) · Kiến trúc: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Quick start (local monorepo)

Xem README trong từng GitHub repo BE / FE, hoặc:

```bash
cd infra/docker && docker compose up -d
cd ../../apps/api && cp .env.example .env && npm i && npx prisma migrate deploy && npm run start:dev
# terminal khác: npm run start:worker:dev
cd ../ai && python3 -m venv .venv && source .venv/bin/activate && pip i -r requirements.txt && cp .env.example .env
uvicorn app.main:app --reload --port 8000
cd ../web && cp .env.example .env.local && npm i && npm run dev
```

- Web: http://localhost:3000  
- API: http://localhost:3001/api/v1  
- AI: http://localhost:8000/health  
