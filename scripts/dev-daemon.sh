#!/usr/bin/env bash
# Detached local stack (survives agent shell exit). No EXIT trap kill.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/bin:$PATH"
LOG=/tmp/akb-logs
mkdir -p "$LOG"

for port in 3000 3001 8000; do
  pids=$(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${pids:-}" ]; then
    kill -9 $pids 2>/dev/null || true
  fi
done
pkill -f 'uvicorn app.main:app' 2>/dev/null || true
pkill -f 'start:worker:dev' 2>/dev/null || true
pkill -f 'next dev' 2>/dev/null || true
sleep 1

brew services start postgresql@18 >/dev/null 2>&1 || true
brew services start redis >/dev/null 2>&1 || true

if ! curl -sf http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
  MINIO_ROOT_USER=akbminio MINIO_ROOT_PASSWORD=akbminio_dev_password \
    nohup minio server --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 \
    /opt/homebrew/var/minio >"$LOG/minio.log" 2>&1 &
  echo $! >"$LOG/minio.pid"
  sleep 1
fi

cd "$ROOT/apps/api"
nohup npm run start:dev >"$LOG/api.log" 2>&1 &
echo $! >"$LOG/api.pid"
nohup npm run start:worker:dev >"$LOG/worker.log" 2>&1 &
echo $! >"$LOG/worker.pid"

cd "$ROOT/apps/ai"
nohup "$ROOT/apps/ai/.venv/bin/uvicorn" app.main:app --reload --host 0.0.0.0 --port 8000 >"$LOG/ai.log" 2>&1 &
echo $! >"$LOG/ai.pid"

cd "$ROOT/apps/web"
# Bind all interfaces so Safari localhost (::1) and 127.0.0.1 both work
nohup npm run dev -- -H 0.0.0.0 -p 3000 >"$LOG/web.log" 2>&1 &
echo $! >"$LOG/web.pid"

echo "started $(date -Iseconds)" | tee "$LOG/daemon.txt"
echo "pids: api=$(cat "$LOG/api.pid") worker=$(cat "$LOG/worker.pid") ai=$(cat "$LOG/ai.pid") web=$(cat "$LOG/web.pid")"
