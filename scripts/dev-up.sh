#!/usr/bin/env bash
# Start full local stack. Run in Terminal.app / iTerm (needs Docker Desktop).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null || { echo "Missing: $1"; exit 1; }; }
need docker
need node
need npm
need python3

echo "==> Docker infra (Postgres + Redis + MinIO)"
cd infra/docker
docker compose up -d
cd "$ROOT"

echo "==> Wait for Postgres"
for _ in $(seq 1 45); do
  if docker exec akb-postgres pg_isready -U akb -d ai_knowledge_base >/dev/null 2>&1; then
    echo "Postgres ready"
    break
  fi
  sleep 1
done

echo "==> API migrate"
cd apps/api
[ -f .env ] || cp .env.example .env
npx prisma migrate deploy

echo "==> API + Worker"
npm run start:dev &
API_PID=$!
npm run start:worker:dev &
WORKER_PID=$!

echo "==> AI (mock LLM/embed)"
cd "$ROOT/apps/ai"
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
AI_PID=$!

echo "==> Web"
cd "$ROOT/apps/web"
[ -f .env.local ] || cp .env.example .env.local
npm run dev &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WORKER_PID" "$AI_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "Ready:"
echo "  Web  http://localhost:3000"
echo "  API  http://localhost:3001/api/v1/health"
echo "  AI   http://localhost:8000/health"
echo "Stop with Ctrl+C"
wait
