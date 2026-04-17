#!/usr/bin/env bash
# Kill whatever is listening on the dev port, then start Next.js on the same port.
set -e
PORT="${PORT:-3000}"
if command -v lsof >/dev/null 2>&1; then
  pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${pids}" ]; then
    echo "Stopping listener(s) on port ${PORT}: ${pids}"
    kill -9 ${pids} 2>/dev/null || true
    sleep 0.3
  else
    echo "No listener on port ${PORT}."
  fi
else
  echo "lsof not found; skipping port cleanup. Start dev manually if the port is busy."
fi
exec npm run dev -- --port "${PORT}"
