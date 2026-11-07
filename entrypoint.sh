#!/bin/sh
set -e

# Start the bgutil PO Token provider (localhost only). PO tokens let yt-dlp
# stream YouTube from datacenter IPs without account cookies.
if [ -f /opt/bgutil-pot/server/build/main.js ]; then
  node /opt/bgutil-pot/server/build/main.js --port 4416 >/tmp/bgutil-pot.log 2>&1 &
  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:4416/ping >/dev/null 2>&1; then
      echo "POT provider ready on 127.0.0.1:4416"
      break
    fi
    sleep 0.5
  done
fi

# The plugin is baked into the image; only install if it went missing.
if ! pipx runpip yt-dlp show bgutil-ytdlp-pot-provider >/dev/null 2>&1; then
  pipx inject yt-dlp "bgutil-ytdlp-pot-provider==2.0.2" 2>/dev/null || true
fi

echo "yt-dlp version: $(yt-dlp --version 2>/dev/null || echo 'unknown')"

exec "$@"
