# Chrome and FFmpeg come from Debian rather than from Puppeteer's own download,
# which needs dl.google.com — blocked in some build environments and an extra
# ~150MB in the image either way.
FROM node:22-bookworm-slim

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      fonts-liberation \
      fonts-noto-color-emoji \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./

# Chrome needs more shared memory than a container's 64MB default; the engine
# launches with --disable-dev-shm-usage, but headroom still matters for the
# frame buffers a long composition holds.
ENV NODE_OPTIONS=--max-old-space-size=2048

EXPOSE 8080
CMD ["node", "server.mjs"]
