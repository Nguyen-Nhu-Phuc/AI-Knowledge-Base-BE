#!/usr/bin/env bash
# Local stack without Docker (Homebrew Postgres/Redis + MinIO).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/bin:$PATH"
LOG=/tmp/akb-logs
mkdir -p "$LOG"

need() { command -v "$1" >/dev/null || { echo "Missing: $1"; exit 1; }; }
need node
need npm
need python3
need redis-cli
need psql
need minio

echo "==> Infra"
brew services start postgresql@18 >/dev/null 2>&1 || true
brew services start redis >/dev/null 2>&1 || true

if ! curl -sf http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
  pkill -f 'minio server' 2>/dev/null || true
  sleep 1
  MINIO_ROOT_USER=akbminio MINIO_ROOT_PASSWORD=akbminio_dev_password \
    nohup minio server --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 \
    /opt/homebrew/var/minio >"$LOG/minio.log" 2>&1 &
  echo $! >"$LOG/minio.pid"
  sleep 2
fi

psql -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='akb'" | grep -q 1 \
  || psql -d postgres -c "CREATE USER akb WITH PASSWORD 'akb_dev_password' SUPERUSER;"
psql -d postgres -c "ALTER USER akb WITH PASSWORD 'akb_dev_password';" >/dev/null
psql -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='ai_knowledge_base'" | grep -q 1 \
  || psql -d postgres -c "CREATE DATABASE ai_knowledge_base OWNER akb;"
psql -d ai_knowledge_base -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null
psql -d ai_knowledge_base -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' >/dev/null

cd "$ROOT/apps/api"
[ -f .env ] || cp .env.example .env
perl -pi -e 's|S3_ENDPOINT=http://localhost:9000|S3_ENDPOINT=http://127.0.0.1:9000|; s|S3_PUBLIC_ENDPOINT=http://localhost:9000|S3_PUBLIC_ENDPOINT=http://127.0.0.1:9000|' .env
npx prisma migrate deploy

# Ensure bucket
node -e '
const { S3Client, CreateBucketCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
const c = new S3Client({
  endpoint: "http://127.0.0.1:9000", region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: "akbminio", secretAccessKey: "akbminio_dev_password" },
});
(async () => {
  try { await c.send(new HeadBucketCommand({ Bucket: "ai-knowledge-base" })); }
  catch { await c.send(new CreateBucketCommand({ Bucket: "ai-knowledge-base" })); }
  console.log("MinIO bucket ready");
})().catch((e) => console.warn("bucket:", e.message));
'

echo "==> API + Worker"
npm run start:dev >"$LOG/api.log" 2>&1 &
API_PID=$!
npm run start:worker:dev >"$LOG/worker.log" 2>&1 &
WORKER_PID=$!

echo "==> AI"
cd "$ROOT/apps/ai"
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 >"$LOG/ai.log" 2>&1 &
AI_PID=$!

echo "==> Web"
cd "$ROOT/apps/web"
[ -f .env.local ] || cp .env.example .env.local
npm run dev -- -H 127.0.0.1 -p 3000 >"$LOG/web.log" 2>&1 &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WORKER_PID" "$AI_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "Ready (logs in $LOG):"
echo "  Web  http://127.0.0.1:3000"
echo "  API  http://127.0.0.1:3001/api/v1/health"
echo "  AI   http://127.0.0.1:8000/health"
echo "  MinIO http://127.0.0.1:9001 (akbminio / akbminio_dev_password)"
echo "Stop with Ctrl+C"
wait
