FROM node:22-slim

# Install system dependencies: ffmpeg (audio), python3 (for yt-dlp plugins), build tools (native modules)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    pipx \
    curl \
    git \
    build-essential \
    pkg-config \
    python3-dev \
    libcairo2 \
    libcairo2-dev \
    libpango-1.0-0 \
    libpango1.0-dev \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    libgif-dev \
    librsvg2-2 \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

# Install yt-dlp via pipx (Python-based, supports plugins and --update-to nightly)
RUN pipx install --pip-args="--pre" "yt-dlp[default]" && \
    pipx inject yt-dlp "bgutil-ytdlp-pot-provider==2.0.2" 2>/dev/null || true

# Build the bgutil PO Token provider HTTP server (generates YouTube PO tokens without cookies).
# Started on 127.0.0.1:4416 by entrypoint.sh. Non-fatal: if this build ever fails,
# the bot must still deploy (it just runs without PO tokens).
RUN git clone --depth 1 --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-pot \
    && cd /opt/bgutil-pot/server \
    && (npm ci && npx tsc) \
    || echo "WARNING: POT provider build skipped" \
    && npm cache clean --force || true

WORKDIR /app

# Copy configuration files
COPY package.json .npmrc tsconfig.json tsconfig.base.json vite.config.ts ./

# Install dependencies (including dev tools needed for building, omitting optional native addons)
RUN npm install --legacy-peer-deps --include=dev --omit=optional || (echo "=== NPM ERROR LOG ===" && cat /root/.npm/_logs/*-debug-0.log 2>/dev/null && exit 1)

# Copy source code and assets
COPY server/ ./server/
COPY src/ ./src/
COPY public/ ./public/
COPY lib/ ./lib/
COPY data/ ./data/
COPY commands/ ./commands/
COPY server.ts index.html entrypoint.sh ./
RUN chmod +x entrypoint.sh || true

# Build frontend and backend
RUN npm run build

# Update yt-dlp to nightly at the END so Docker doesn't cache stale version
# (This layer runs after source copy, so it always rebuilds on code changes)
RUN pipx upgrade --pip-args="--pre" yt-dlp 2>/dev/null || true
# Re-assert the POT plugin after the upgrade so it can never be dropped
RUN pipx runpip yt-dlp install -q "bgutil-ytdlp-pot-provider==2.0.2" 2>/dev/null || true
RUN echo "yt-dlp version:" && yt-dlp --version

# Runtime environment
ENV NODE_ENV="production"
ENV NODE_OPTIONS="--max-old-space-size=384"
# Explicit local bgutil provider URL (plugin default is the same, but this keeps
# behaviour deterministic and shows up in /check diagnostics).
ENV YOUTUBE_POT_PROVIDER_URL="http://127.0.0.1:4416"
# yt-dlp is installed/updated at build time and the POT plugin is injected by
# entrypoint.sh; a runtime pip update only risks blocking the event loop and
# wiping the plugin.
ENV SKIP_YTDLP_UPDATE="true"

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "start"]
