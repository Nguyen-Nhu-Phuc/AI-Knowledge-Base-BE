# API (NestJS)

NestJS API + Prisma + BullMQ workers cho AI Knowledge Base.

## Stack

- NestJS 11 + Prisma + PostgreSQL / pgvector  
- BullMQ (ingestion + embedding)  
- MinIO / S3 presigned upload  
- JWT + refresh cookie, RBAC multi-tenant  

## Chạy local (trong repo BE)

```bash
# Infra
cd ../infra/docker && docker compose up -d

# API
cd ../../api
cp .env.example .env
npm install
npx prisma migrate deploy
npm run start:dev

# Worker (terminal khác)
npm run start:worker:dev
```

AI service: xem [`../ai/README.md`](../ai/README.md).

API: `http://localhost:3001/api/v1`

## Modules chính

- **Auth / Users** — register, login, refresh, logout, profile  
- **Organizations** — yêu cầu tạo org (Super Admin duyệt), members, invite  
- **Knowledge Bases & Documents** — CRUD, upload, jobs, versions, chunks  
- **Search** — hybrid vector + FTS + RRF  
- **Chat** — SSE RAG / research + feedback  
- **Notifications** — in-app  
- **Admin** — Super Admin (`PLATFORM_ADMIN_EMAILS`)  

Chi tiết env và kiến trúc: README gốc của repo BE.
