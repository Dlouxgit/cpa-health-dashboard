#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/data/server.pid"
LOG_FILE="$ROOT/data/server.log"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [[ -z "${NODE_BIN:-}" ]]; then
  echo "node not found"
  exit 1
fi
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" || true)
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "already running: pid=$PID"
    exit 0
  fi
fi
cd "$ROOT"
mkdir -p "$ROOT/data"
nohup "$NODE_BIN" src/server.mjs > "$LOG_FILE" 2>&1 < /dev/null &
PID=$!
echo "$PID" > "$PID_FILE"
sleep 2
if kill -0 "$PID" 2>/dev/null; then
  echo "started: pid=$PID"
  echo "log: $LOG_FILE"
else
  echo "failed to start"
  rm -f "$PID_FILE"
  cat "$LOG_FILE" || true
  exit 1
fi
