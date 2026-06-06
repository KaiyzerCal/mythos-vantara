# MAVIS Python Execution Sandbox
# Deploy on Hetzner CX22 ($4.50/mo), Railway, Fly.io, or Render.
# Set PYTHON_SANDBOX_URL=http://your-host:8080 in Supabase edge function secrets.

FROM python:3.12-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir fastapi uvicorn pydantic && \
    # Optional scientific packages — remove if not needed
    pip install --no-cache-dir pandas numpy 2>/dev/null || true

COPY server.py .

# Run as non-root for security
RUN useradd -m sandbox
USER sandbox

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
