#!/bin/sh
set -e

echo "Checking yt-dlp version..."
pipx upgrade --pip-args="--pre" yt-dlp 2>/dev/null || python3 -m pip install --upgrade --pre yt-dlp 2>/dev/null || true
echo "yt-dlp updated to $(yt-dlp --version 2>/dev/null || echo 'unknown')"

exec "$@"
