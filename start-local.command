#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install Python 3, then run this file again."
  read -r _
  exit 1
fi
PORT=8765
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/epistassi-http.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
sleep 1
open "http://127.0.0.1:${PORT}/" 2>/dev/null || printf 'Open this address in your browser: http://127.0.0.1:%s/\n' "$PORT"
wait "$SERVER_PID"
