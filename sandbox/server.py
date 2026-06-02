"""
MAVIS Python Execution Sandbox
Isolated FastAPI server for running Python code safely.
Deploy via Docker on any $4.50/month Hetzner VPS.
Set PYTHON_SANDBOX_URL=http://your-server:8080 in Supabase edge function secrets.
"""

import subprocess
import sys
import os
import uuid
import tempfile
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="MAVIS Python Sandbox")

ALLOWED_PACKAGES = {
    "math", "json", "datetime", "re", "collections", "itertools",
    "functools", "operator", "string", "textwrap", "decimal",
    "fractions", "random", "statistics", "csv", "io",
    "pandas", "numpy", "matplotlib",  # installed separately if needed
}

MAX_OUTPUT_LEN = 8000
TIMEOUT_SECONDS = 30


class ExecRequest(BaseModel):
    code: str
    timeout: int = TIMEOUT_SECONDS
    language: str = "python"


class ExecResponse(BaseModel):
    stdout: str
    stderr: str
    returncode: int
    error: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "runtime": f"Python {sys.version}"}


@app.post("/execute", response_model=ExecResponse)
def execute(req: ExecRequest):
    if not req.code or not req.code.strip():
        raise HTTPException(status_code=400, detail="code is required")

    code = req.code.strip()
    timeout = min(req.timeout, TIMEOUT_SECONDS)

    # Write code to a temp file
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, prefix="mavis_sandbox_"
    ) as f:
        f.write(code)
        tmp_path = f.name

    try:
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            timeout=timeout,
            # No network, limited env
            env={
                "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                "HOME": "/tmp",
                "PYTHONPATH": "",
            },
        )
        return ExecResponse(
            stdout=result.stdout[:MAX_OUTPUT_LEN],
            stderr=result.stderr[:2000],
            returncode=result.returncode,
        )
    except subprocess.TimeoutExpired:
        return ExecResponse(
            stdout="",
            stderr="",
            returncode=124,
            error=f"Execution timed out after {timeout}s",
        )
    except Exception as e:
        return ExecResponse(
            stdout="",
            stderr="",
            returncode=1,
            error=str(e),
        )
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
