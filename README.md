# AI Knowledge Base — Backend

Backend cho hệ thống **Enterprise AI Knowledge Base** (RAG + AI Agent).

Repo này gồm:

| Thư mục | Vai trò |
|---------|---------|
| `api/` | NestJS API + Prisma + BullMQ workers |
| `ai/` | FastAPI — parse/chunk, embed, LLM, OCR, research |
| `infra/docker/` | Postgres (pgvector) + Redis + MinIO |
| `scripts/` | Seed demo / ops |

Frontend riêng: [`AI-Knowledge-Base-FE`](https://github.com/Nguyen-Nhu-Phuc/AI-Knowledge-Base-FE)

---

## Yêu cầu

- Node.js 20+
- Python 3.10+
- Docker (Postgres, Redis, MinIO) **hoặc** cài local tương đương
- (Tuỳ chọn) [Tesseract](https://github.com/tesseract-ocr/tesseract) nếu dùng OCR

---

## Chạy nhanh

### 1. Infra

```bash
cd infra/docker
docker compose up -d
```

### 2. API (NestJS)

```bash
cd api
cp .env.example .env
npm install
npx prisma migrate deploy
npm run start:dev
```

Worker (ingestion + embedding):

```bash
npm run start:worker:dev
```

API: `http://localhost:3001/api/v1`  
Health: `http://localhost:3001/api/v1/health`

### 3. AI service (FastAPI)

```bash
cd ai
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health: `http://localhost:8000/health`

Mặc định `EMBEDDING_PROVIDER=mock` và `LLM_PROVIDER=mock` — chạy được **không cần API key**.

---

## Biến môi trường quan trọng

### `api/.env`

| Biến | Ý nghĩa |
|------|---------|
| `DATABASE_URL` | PostgreSQL |
| `REDIS_*` | Hàng đợi BullMQ |
| `S3_*` | MinIO / S3 upload |
| `AI_SERVICE_URL` / `AI_SERVICE_SECRET` | Gọi service `ai/` |
| `PLATFORM_ADMIN_EMAILS` | Email Super Admin (vd. `demo@akb.local`) |
| `WEB_ORIGIN` | Origin frontend (CORS / cookie) |

### `ai/.env`

| Biến | Ý nghĩa |
|------|---------|
| `SERVICE_SECRET` | Phải khớp `AI_SERVICE_SECRET` bên API |
| `EMBEDDING_PROVIDER` | `mock` \| `openai` \| `gemini` |
| `LLM_PROVIDER` | `mock` \| `openai` \| `gemini` |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | Khi dùng provider thật |
| `OCR_ENABLED` | OCR ảnh / PDF scan |

---

## Kiến trúc ngắn

```
Web (FE)  →  Nest API  →  Postgres / Redis / MinIO
                ↓
           AI service (parse, embed, generate, research)
                ↑
           Worker (BullMQ: ingest + embed)
```

- **Multi-tenant** theo Organization + RBAC (`owner` / `admin` / `member` / `viewer`)
- **RAG**: hybrid search (vector + FTS + RRF), chat SSE kèm citations
- **Super Admin**: phê duyệt tạo org, quản lý user/org/AI cost (`/admin/*`)

Chi tiết hơn: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`HUONG_DAN_SU_DUNG.md`](./HUONG_DAN_SU_DUNG.md).

---

## Seed demo (tuỳ chọn)

Khi API đã chạy:

```bash
node scripts/seed-demo.mjs
```

Tài khoản demo (mật khẩu `Demo1234!`):

| Role | Email |
|------|--------|
| Owner / Super Admin | `demo@akb.local` |
| Admin | `admin@akb.local` |
| Member | `member@akb.local` |
| Viewer | `viewer@akb.local` |

---

## API modules chính

- Auth / Users — JWT + refresh cookie  
- Organizations — tạo org (cần Super Admin duyệt), members, invite  
- Knowledge Bases & Documents — upload presigned, ingest, versions  
- Search — hybrid  
- Chat — SSE RAG / research  
- Notifications — chuông trong app  
- Admin — Super Admin console  

AI endpoints (header `X-AI-Service-Secret`): xem [`ai/README.md`](./ai/README.md).

---

## License

Private — chỉ chủ sở hữu repo.
