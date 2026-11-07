#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# bgutil PO Token provider (localhost only)
# PO tokens let yt-dlp stream YouTube from datacenter IPs without cookies.
# It is optional: if the server is missing or fails to start, the bot still runs.
# ---------------------------------------------------------------------------
POT_DIR=/opt/bgutil-pot/server
if [ -f "$POT_DIR/build/main.js" ]; then
  node --max-old-space-size=192 "$POT_DIR/build/main.js" --port 4416 >/tmp/bgutil-pot.log 2>&1 &
  POT_PID=$!
  POT_READY=0
  for _ in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:4416/ping >/dev/null 2>&1; then
      POT_READY=1
      echo "POT provider ready on 127.0.0.1:4416 (pid $POT_PID)"
      break
    fi
    if ! kill -0 "$POT_PID" 2>/dev/null; then
      echo "WARNING: POT provider exited during startup:"
      tail -n 20 /tmp/bgutil-pot.log 2>/dev/null || true
      break
    fi
    sleep 0.5
  done
  if [ "$POT_READY" = "0" ]; then
    echo "WARNING: POT provider not reachable on 127.0.0.1:4416 (continuing without PO tokens)"
    tail -n 20 /tmp/bgutil-pot.log 2>/dev/null || true
  fi
else
  echo "WARNING: POT provider build not found at $POT_DIR/build/main.js (continuing without PO tokens)"
fi

# The plugin is baked into the image; only install if it went missing.
if ! pipx runpip yt-dlp show bgutil-ytdlp-pot-provider >/dev/null 2>&1; then
  echo "POT plugin missing, reinstalling..."
  pipx inject yt-dlp "bgutil-ytdlp-pot-provider==2.0.2" 2>/dev/null || true
fi

echo "yt-dlp version: $(yt-dlp --version 2>/dev/null || echo 'unknown')"
echo "yt-dlp path: $(command -v yt-dlp || echo 'not found in PATH')"

exec "$@"
