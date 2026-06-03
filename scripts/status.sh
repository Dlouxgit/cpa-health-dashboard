#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/data/server.pid"
PORT="${PORT:-18317}"
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" || true)
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "running: pid=$PID"
    curl -sS "http://127.0.0.1:${PORT}/api/status" | python3 -m json.tool
    exit 0
  fi
fi
echo "not running"
exit 1
