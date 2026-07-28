FROM node:22-slim

# Install system dependencies: ffmpeg (audio), python3 + pipx (yt-dlp), build tools (native modules)
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
    && pipx install yt-dlp \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

# Install pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace config files first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./

# Copy all needed packages
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY scripts/ ./scripts/

# Install dependencies (skip frozen lockfile to avoid version mismatch)
RUN pnpm install --no-frozen-lockfile

# Build the API server
RUN pnpm --filter @workspace/api-server run build

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
