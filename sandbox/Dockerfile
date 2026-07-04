# MAVIS Multi-Language Sandbox v2
# Deploy on Hetzner CX22 ($4.50/mo), Railway, Fly.io, or Render.
# Set PYTHON_SANDBOX_URL=http://your-host:8080 in Supabase edge function secrets.

FROM python:3.12-slim

WORKDIR /app

# Install Node.js LTS (via NodeSource) + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    bash \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir fastapi uvicorn pydantic && \
    pip install --no-cache-dir pandas numpy 2>/dev/null || true

# Install ts-node for TypeScript execution (optional — falls back to type-strip)
RUN npm install -g ts-node typescript 2>/dev/null || true

COPY server.py .

# Run as non-root for security
RUN useradd -m sandbox
USER sandbox

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
