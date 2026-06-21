"""
MAVIS Device Bridge
Runs on Windows. Connects to Supabase Realtime, executes commands from MAVIS.
"""

import json
import os
import platform
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent / "bridge_config.json"

def load_config() -> dict:
    if not CONFIG_PATH.exists():
        print(f"[ERROR] Config file not found: {CONFIG_PATH}")
        print("Copy bridge_config.json.example to bridge_config.json and fill in your credentials.")
        sys.exit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(config: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

# ── Auth ──────────────────────────────────────────────────────────────────────

def authenticate(supabase: Client, email: str, password: str) -> str:
    """Sign in and return the access token."""
    resp = supabase.auth.sign_in_with_password({"email": email, "password": password})
    if not resp.session:
        raise RuntimeError("Authentication failed — check email/password in bridge_config.json")
    print(f"[AUTH] Signed in as {email}")
    return resp.session.access_token

# ── Device registration ───────────────────────────────────────────────────────

def register_device(supabase: Client, config: dict) -> str:
    """Register this device and return its device_id. Saves to config."""
    uname = platform.uname()
    resp = supabase.functions.invoke(
        "mavis-device-bridge",
        invoke_options={
            "body": {
                "action": "register_device",
                "name": config.get("device_name", uname.node or "Windows PC"),
                "device_type": "pc",
                "platform": uname.system.lower(),
                "metadata": {
                    "hostname": uname.node,
                    "os_version": uname.version,
                    "machine": uname.machine,
                    "python": sys.version,
                },
            }
        },
    )
    data = resp.get("data") if isinstance(resp, dict) else {}
    if isinstance(data, bytes):
        data = json.loads(data)
    device_id = data.get("device_id", "")
    if not device_id:
        raise RuntimeError(f"register_device failed: {data}")

    config["device_id"] = device_id
    save_config(config)
    print(f"[BRIDGE] Device registered: {device_id}")
    return device_id

def update_device_status(supabase: Client, device_id: str, status: str) -> None:
    supabase.table("mavis_devices").update({
        "status": status,
        "last_seen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }).eq("id", device_id).execute()

# ── Command handlers ──────────────────────────────────────────────────────────

def handle_shell(params: dict) -> dict:
    command = params.get("command", "")
    timeout = int(params.get("timeout", 30))
    try:
        result = subprocess.run(
            ["powershell", "-Command", command],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {timeout}s", "returncode": -1}

def handle_get_processes(_params: dict) -> dict:
    procs = []
    for proc in sorted(
        psutil.process_iter(["pid", "name", "cpu_percent", "memory_info"]),
        key=lambda p: p.info.get("cpu_percent") or 0,
        reverse=True,
    )[:30]:
        info = proc.info
        mem_mb = round((info.get("memory_info") or psutil.pmem(0, 0)).rss / 1024 / 1024, 2)
        procs.append({
            "pid": info["pid"],
            "name": info["name"],
            "cpu_percent": info.get("cpu_percent") or 0,
            "memory_mb": mem_mb,
        })
    return {"processes": procs}

def handle_kill_process(params: dict) -> dict:
    pid = params.get("pid")
    name = params.get("name")
    killed = []
    if pid:
        try:
            proc = psutil.Process(int(pid))
            proc.terminate()
            killed.append({"pid": int(pid), "name": proc.name()})
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            return {"error": str(e)}
    elif name:
        for proc in psutil.process_iter(["pid", "name"]):
            if proc.info["name"].lower() == name.lower():
                try:
                    proc.terminate()
                    killed.append({"pid": proc.info["pid"], "name": proc.info["name"]})
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
    return {"killed": killed}

def handle_system_info(_params: dict) -> dict:
    uname = platform.uname()
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    return {
        "platform": {
            "system": uname.system,
            "node": uname.node,
            "release": uname.release,
            "version": uname.version,
            "machine": uname.machine,
            "processor": uname.processor,
        },
        "cpu": {
            "count": psutil.cpu_count(),
            "percent": psutil.cpu_percent(interval=1),
        },
        "memory": {
            "total_gb": round(mem.total / 1024 ** 3, 2),
            "available_gb": round(mem.available / 1024 ** 3, 2),
            "percent_used": mem.percent,
        },
        "disk": {
            "total_gb": round(disk.total / 1024 ** 3, 2),
            "used_gb": round(disk.used / 1024 ** 3, 2),
            "free_gb": round(disk.free / 1024 ** 3, 2),
            "percent_used": disk.percent,
        },
    }

def handle_launch_app(params: dict) -> dict:
    path = params.get("path", "")
    if not path:
        return {"error": "launch_app requires 'path' param"}
    args = params.get("args", [])
    cmd = [path] + (args if isinstance(args, list) else [])
    proc = subprocess.Popen(cmd)
    return {"launched": path, "pid": proc.pid}

def handle_file_read(params: dict) -> dict:
    path = params.get("path", "")
    if not path:
        return {"error": "file_read requires 'path' param"}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(50 * 1024)  # 50 KB cap
        return {"content": content, "truncated": len(content) >= 50 * 1024}
    except OSError as e:
        return {"error": str(e)}

def handle_file_write(params: dict) -> dict:
    path = params.get("path", "")
    content = params.get("content", "")
    if not path:
        return {"error": "file_write requires 'path' param"}
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"written": path, "bytes": len(content.encode("utf-8"))}
    except OSError as e:
        return {"error": str(e)}

def handle_screenshot(_params: dict) -> dict:
    return {
        "status": "screenshot_not_supported",
        "note": "Install Pillow and pyautogui to enable screenshot support.",
    }

HANDLERS = {
    "shell": handle_shell,
    "get_processes": handle_get_processes,
    "kill_process": handle_kill_process,
    "system_info": handle_system_info,
    "launch_app": handle_launch_app,
    "file_read": handle_file_read,
    "file_write": handle_file_write,
    "screenshot": handle_screenshot,
}

# ── Command executor ──────────────────────────────────────────────────────────

def execute_command(supabase: Client, command: dict) -> None:
    command_id = command["id"]
    command_type = command.get("command_type", "")
    params = command.get("params") or {}

    print(f"[CMD] Executing {command_type} (id={command_id})")

    # Mark as executing
    supabase.table("mavis_device_commands").update({
        "status": "executing",
        "executed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }).eq("id", command_id).execute()

    try:
        handler = HANDLERS.get(command_type)
        if not handler:
            raise ValueError(f"Unknown command_type: {command_type}")

        result = handler(params)

        supabase.table("mavis_device_commands").update({
            "status": "done",
            "result": result,
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }).eq("id", command_id).execute()
        print(f"[CMD] Done: {command_type}")

    except Exception as exc:
        print(f"[CMD] Failed: {command_type} — {exc}")
        supabase.table("mavis_device_commands").update({
            "status": "failed",
            "error": str(exc),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }).eq("id", command_id).execute()

# ── Heartbeat ─────────────────────────────────────────────────────────────────

def heartbeat_loop(supabase: Client, device_id: str, stop_event: threading.Event) -> None:
    while not stop_event.wait(30):
        try:
            supabase.table("mavis_devices").update({
                "last_seen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }).eq("id", device_id).execute()
        except Exception as exc:
            print(f"[HEARTBEAT] Error: {exc}")

# ── Realtime polling (fallback for environments without websocket Realtime) ───

def poll_loop(supabase: Client, device_id: str, stop_event: threading.Event) -> None:
    """
    Poll for pending commands every 2 seconds.
    The supabase-py v2 Realtime client requires an asyncio event loop; for
    simplicity the bridge uses polling instead — sufficient for most use cases.
    Upgrade to the async Realtime client if sub-second latency is required.
    """
    print(f"[BRIDGE] Polling for commands on device {device_id}")
    while not stop_event.is_set():
        try:
            resp = supabase.table("mavis_device_commands") \
                .select("*") \
                .eq("device_id", device_id) \
                .eq("status", "pending") \
                .order("created_at") \
                .limit(5) \
                .execute()

            for command in resp.data or []:
                execute_command(supabase, command)

        except Exception as exc:
            print(f"[POLL] Error: {exc}")

        stop_event.wait(2)

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    config = load_config()

    supabase_url = config.get("supabase_url", "")
    supabase_key = config.get("supabase_key", "")
    device_id = config.get("device_id", "")
    user_email = config.get("user_email", "")
    user_password = config.get("user_password", "")

    if not supabase_url or not supabase_key:
        print("[ERROR] supabase_url and supabase_key are required in bridge_config.json")
        sys.exit(1)

    supabase: Client = create_client(supabase_url, supabase_key)

    # Auth
    access_token = authenticate(supabase, user_email, user_password)
    # Update the client session so subsequent requests use the user's JWT
    supabase.auth.set_session(access_token, "")

    # Register device if needed
    if not device_id:
        device_id = register_device(supabase, config)
    else:
        print(f"[BRIDGE] Using existing device_id: {device_id}")

    # Set device online
    update_device_status(supabase, device_id, "online")
    print(f"[BRIDGE] Device is online. Waiting for commands...")

    stop_event = threading.Event()

    # Shutdown handler
    def shutdown(signum, frame):
        print("\n[BRIDGE] Shutting down...")
        stop_event.set()
        try:
            update_device_status(supabase, device_id, "offline")
        except Exception:
            pass
        print("[BRIDGE] Device marked offline. Goodbye.")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Start heartbeat thread
    hb_thread = threading.Thread(
        target=heartbeat_loop,
        args=(supabase, device_id, stop_event),
        daemon=True,
        name="heartbeat",
    )
    hb_thread.start()

    # Start polling loop (blocks until stop_event is set)
    poll_loop(supabase, device_id, stop_event)


if __name__ == "__main__":
    main()
