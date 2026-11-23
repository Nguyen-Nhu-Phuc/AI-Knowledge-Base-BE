# AI Knowledge Base — API (NestJS)

Backend hoàn chỉnh theo implementation plan (Auth → Org → KB/Docs → Ingestion → Embed/Search → Chat/RAG → Analytics/Admin).

## Stack

- NestJS 11 + Prisma 6 + PostgreSQL/pgvector
- BullMQ (ingestion + embedding workers)
- MinIO/S3 presigned upload
- JWT + refresh cookie, RBAC multi-tenant

## Chạy local

```bash
# Infra
cd ../../infra/docker && docker compose up -d

# Migrate + API
cd ../../apps/api
cp .env.example .env
npx prisma migrate deploy
npm run start:dev

# Worker
npm run start:worker:dev
```

AI service: xem `apps/ai/README.md`.

## Modules / Endpoints

### Auth & Users
- `POST /auth/register|login|refresh|logout`
- `GET|PATCH /users/me`, `PATCH /users/me/password`

### Organizations
- CRUD org, members, invite-links

### Knowledge Bases & Documents
- KB CRUD
- Presigned upload → confirm → jobs/versions/chunks/retry/reprocess

### Search
- `POST /organizations/:orgId/knowledge-bases/:kbId/search` — Hybrid (vector + FTS + RRF)

### Chat / RAG / Research
- `POST .../knowledge-bases/:kbId/chat` — SSE stream  
  Body: `{ message, conversationId?, rewrite?, research? }`
- Conversations CRUD + messages
- `POST .../messages/:messageId/feedback`

SSE events: `conversation.created`, `status`, `message.delta`, `message.citations`, `message.completed`, `error`

### Analytics
- `GET /organizations/:orgId/usage`
- `GET /organizations/:orgId/analytics/overview`

### Admin (platform)
- `GET /admin/organizations`
- `GET /admin/jobs`
- `POST /admin/organizations/:id/disable`

## Embedding / LLM

Mặc định AI service dùng `mock` provider (không cần OpenAI key).  
Đặt `EMBEDDING_PROVIDER=openai`, `LLM_PROVIDER=openai` + `OPENAI_API_KEY` trên `apps/ai/.env` khi cần thật.
