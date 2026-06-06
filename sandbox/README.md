# MAVIS Python Sandbox

Self-hosted Python code execution server. Replaces e2b.dev.

## Deploy

```bash
docker build -t mavis-sandbox .
docker run -d -p 8080:8080 --name mavis-sandbox \
  --memory=512m --cpus=0.5 \
  --security-opt=no-new-privileges \
  mavis-sandbox
```

## Configure

Set in Supabase edge function secrets:
```
PYTHON_SANDBOX_URL=http://your-server:8080
```

MAVIS will automatically use this for Python code execution.
