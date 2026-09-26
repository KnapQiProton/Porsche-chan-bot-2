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
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

# Install yt-dlp via pipx (Python-based, supports plugins and --update-to nightly)
RUN pipx install "yt-dlp[default]"

WORKDIR /app

# Copy configuration files
COPY package.json .npmrc tsconfig.json tsconfig.base.json vite.config.ts ./

# Install dependencies (including dev tools needed for building)
RUN npm install --legacy-peer-deps --include=dev

# Copy source code and assets
COPY server/ ./server/
COPY src/ ./src/
COPY public/ ./public/
COPY server.ts index.html ./

# Build frontend and backend
RUN npm run build

# Update yt-dlp to nightly at the END so Docker doesn't cache stale version
# (This layer runs after source copy, so it always rebuilds on code changes)
RUN yt-dlp --update-to nightly 2>/dev/null || yt-dlp --update 2>/dev/null || true && \
    echo "yt-dlp version:" && yt-dlp --version

# Runtime environment
ENV NODE_ENV="production"
ENV NODE_OPTIONS="--max-old-space-size=384"

EXPOSE 3000

CMD ["npm", "start"]
