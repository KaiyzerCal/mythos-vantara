# MAVIS Whisper Server

Self-hosted speech-to-text. OpenAI Whisper API-compatible. Zero API cost.

## Models (tradeoff: quality vs RAM)

| Model   | Size  | RAM  | WER  |
|---------|-------|------|------|
| base    | 74MB  | 1GB  | Good |
| small   | 244MB | 2GB  | Better |
| medium  | 769MB | 4GB  | Great |
| large-v3| 1.5GB | 6GB  | Best |

## Deploy

```bash
docker build -t mavis-whisper .
docker run -d -p 9000:9000 --name mavis-whisper \
  --memory=1g \
  -e WHISPER_MODEL=base \
  mavis-whisper
```

## GPU (optional, 10x faster)

```bash
docker run -d -p 9000:9000 --gpus all \
  -e WHISPER_MODEL=large-v3 \
  -e WHISPER_DEVICE=cuda \
  -e WHISPER_COMPUTE=float16 \
  mavis-whisper
```

## Configure

```
WHISPER_URL=http://your-server:9000
```

MAVIS will use this for all voice transcription at zero API cost.
