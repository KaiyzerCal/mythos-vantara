# MAVIS Self-Hosted Whisper Server
# Runs faster-whisper (CPU-optimized, no GPU needed).
# Deploy on any $4-6/mo VPS with 1GB+ RAM.
#
# Build:  docker build -t mavis-whisper .
# Run:    docker run -d -p 9000:9000 --name mavis-whisper --memory=1g mavis-whisper
# Config: WHISPER_MODEL=base (base/small/medium/large-v3)
#         WHISPER_DEVICE=cpu  (cpu/cuda)
#         WHISPER_COMPUTE=int8 (int8/float16)
#
# Set in Supabase secrets: WHISPER_URL=http://your-server:9000

FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    faster-whisper \
    python-multipart

COPY server.py .

RUN useradd -m whisper
USER whisper

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9000/health')" || exit 1

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9000"]
