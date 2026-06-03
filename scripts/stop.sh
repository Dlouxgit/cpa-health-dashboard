#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/data/server.pid"
if [[ ! -f "$PID_FILE" ]]; then
  echo "not running"
  exit 0
fi
PID=$(cat "$PID_FILE" || true)
if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for _ in $(seq 1 30); do
    if ! kill -0 "$PID" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "process did not exit in time: pid=$PID"
    exit 1
  fi
  echo "stopped: pid=$PID"
else
  echo "stale pid file"
fi
rm -f "$PID_FILE"
