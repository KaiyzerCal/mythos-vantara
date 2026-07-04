"""
MAVIS Multi-Language Execution Sandbox v2
Supports Python, Node.js, TypeScript, and Bash with persistent sessions.
Deploy via Docker on any VPS ($4.50/mo Hetzner CX22 works great).
Set PYTHON_SANDBOX_URL=http://your-server:8080 in Supabase edge function secrets.
"""

import subprocess
import sys
import os
import uuid
import tempfile
import shutil
import re
from typing import Dict, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="MAVIS Multi-Language Sandbox", version="2.0.0")

MAX_OUTPUT_LEN = 8000
TIMEOUT_SECONDS = 30

# Active session working directories (in-memory; cleared on restart)
_sessions: Dict[str, str] = {}


class ExecRequest(BaseModel):
    code: str
    timeout: int = TIMEOUT_SECONDS
    language: str = "python"       # python | node | typescript | bash
    session_id: Optional[str] = None   # persistent working dir key


class ExecResponse(BaseModel):
    stdout: str
    stderr: str
    returncode: int
    error: Optional[str] = None
    session_id: Optional[str] = None
    language: Optional[str] = None


def _get_or_create_session(session_id: Optional[str]) -> tuple:
    """Return (session_id, workdir). Creates a new workdir if session is new."""
    if session_id and session_id in _sessions:
        return session_id, _sessions[session_id]
    sid = session_id or str(uuid.uuid4())
    workdir = tempfile.mkdtemp(prefix=f"mavis_session_{sid[:8]}_")
    _sessions[sid] = workdir
    return sid, workdir


def _safe_env() -> Dict[str, str]:
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin",
        "HOME": "/tmp",
        "PYTHONPATH": "",
        "NODE_PATH": "/usr/local/lib/node_modules",
    }


def _run_file(cmd: list, code: str, suffix: str, timeout: int, workdir: str) -> ExecResponse:
    """Write code to a temp file, execute with cmd, return structured response."""
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=suffix, delete=False, dir=workdir, prefix="mavis_exec_"
    )
    tmp.write(code)
    tmp.flush()
    tmp.close()
    if suffix == ".sh":
        os.chmod(tmp.name, 0o700)

    try:
        result = subprocess.run(
            cmd + [tmp.name],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=workdir,
            env=_safe_env(),
        )
        return ExecResponse(
            stdout=result.stdout[:MAX_OUTPUT_LEN],
            stderr=result.stderr[:2000],
            returncode=result.returncode,
        )
    except subprocess.TimeoutExpired:
        return ExecResponse(
            stdout="", stderr="", returncode=124,
            error=f"Execution timed out after {timeout}s",
        )
    except FileNotFoundError as e:
        return ExecResponse(
            stdout="", stderr="", returncode=127,
            error=f"Runtime not found ({e}). Ensure Node.js is installed in the Docker image.",
        )
    except Exception as e:
        return ExecResponse(stdout="", stderr="", returncode=1, error=str(e))
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


# ── Per-language runners ──────────────────────────────────────

def run_python(code: str, timeout: int, workdir: str) -> ExecResponse:
    return _run_file([sys.executable], code, ".py", timeout, workdir)


def run_node(code: str, timeout: int, workdir: str) -> ExecResponse:
    node_bin = shutil.which("node") or "/usr/local/bin/node"
    return _run_file([node_bin, "--max-old-space-size=256"], code, ".js", timeout, workdir)


def run_typescript(code: str, timeout: int, workdir: str) -> ExecResponse:
    # Try ts-node first, fall back to stripping types and running as JS
    tsnode = shutil.which("ts-node")
    if tsnode:
        return _run_file([tsnode, "--skip-project"], code, ".ts", timeout, workdir)
    # Minimal type-strip: remove annotations, interfaces, generics
    js_code = re.sub(r":\s*[\w<>\[\]|&]+", "", code)
    js_code = re.sub(r"(interface|type)\s+\w+[^{]*\{[^}]*\}", "", js_code, flags=re.DOTALL)
    js_code = re.sub(r"<[\w,\s]+>", "", js_code)
    return run_node(js_code, timeout, workdir)


def run_bash(script: str, timeout: int, workdir: str) -> ExecResponse:
    bash_bin = shutil.which("bash") or "/bin/bash"
    safe_script = "#!/bin/bash\nset -uo pipefail\n" + script
    return _run_file([bash_bin], safe_script, ".sh", timeout, workdir)


# ── Endpoints ─────────────────────────────────────────────────

@app.get("/health")
def health():
    node_version = ""
    try:
        r = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=3)
        node_version = r.stdout.strip()
    except Exception:
        pass
    return {
        "status": "ok",
        "python": sys.version,
        "node": node_version or "not installed",
        "languages": ["python", "node", "typescript", "bash"],
        "active_sessions": len(_sessions),
    }


@app.post("/execute", response_model=ExecResponse)
def execute(req: ExecRequest):
    if not req.code or not req.code.strip():
        raise HTTPException(status_code=400, detail="code is required")

    timeout = max(1, min(req.timeout, TIMEOUT_SECONDS))
    sid, workdir = _get_or_create_session(req.session_id)
    lang = req.language.lower().strip()

    if lang in ("python", "py"):
        resp = run_python(req.code, timeout, workdir)
    elif lang in ("node", "javascript", "js"):
        resp = run_node(req.code, timeout, workdir)
    elif lang in ("typescript", "ts"):
        resp = run_typescript(req.code, timeout, workdir)
    elif lang in ("bash", "sh", "shell"):
        resp = run_bash(req.code, timeout, workdir)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported language '{lang}'. Use: python, node, typescript, bash")

    resp.session_id = sid
    resp.language = lang
    return resp


@app.get("/sessions")
def list_sessions():
    return {
        "sessions": [
            {"id": sid, "workdir": wdir, "exists": os.path.isdir(wdir)}
            for sid, wdir in _sessions.items()
        ]
    }


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    workdir = _sessions.pop(session_id)
    shutil.rmtree(workdir, ignore_errors=True)
    return {"ok": True, "deleted": session_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
