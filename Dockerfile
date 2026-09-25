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
    && pipx install "yt-dlp[default]" \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"
ENV NODE_ENV="production"
ENV NODE_OPTIONS="--max-old-space-size=384"

WORKDIR /app

# Copy configuration files
COPY package.json .npmrc tsconfig.json tsconfig.base.json vite.config.ts ./

# Copy source code and assets
COPY server/ ./server/
COPY src/ ./src/
COPY public/ ./public/
COPY server.ts index.html ./

# Install dependencies and build
RUN npm install --legacy-peer-deps
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
