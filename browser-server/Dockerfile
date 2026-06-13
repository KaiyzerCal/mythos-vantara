# MAVIS Browser Server — Playwright/Chromium for browsing, scraping, and PDF generation.
# Handles /browse, /scrape, and /pdf in one container.
#
# Build:  docker build -t mavis-browser .
# Run:    docker run -d -p 3000:3000 --name mavis-browser \
#           --memory=1.5g --shm-size=512m mavis-browser
#
# Set in Supabase secrets:
#   BROWSER_URL=http://your-server:3000
# This unlocks: PDF generation, web browsing in computer-use, mavis-web-scraper.

FROM node:20-slim

# Install Chromium system dependencies (required by Playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libxshmfence1 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

# Install Playwright + Chromium browser binary
RUN npx playwright install chromium --with-deps

COPY server.js .

RUN useradd -m browser
USER browser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
