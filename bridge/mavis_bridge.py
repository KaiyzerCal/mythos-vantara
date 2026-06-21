"""
MAVIS Universal Device Bridge
Connects MAVIS to local hardware via two transport paths:
  1. Supabase polling (cloud commands from MAVIS)
  2. Local HTTP server on port 7791 (LAN / same-machine callers)

Hardware adapters (loaded when available):
  - GPIO  : Raspberry Pi GPIO pins (requires RPi.GPIO or gpiozero)
  - Serial: Arduino/ESP32 via USB (requires pyserial)
  - MQTT  : smart home devices (requires paho-mqtt)
  - HTTP  : REST-based IoT devices (requires requests, always available)
"""

import importlib
import json
import logging
import os
import platform
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import psutil
from supabase import create_client, Client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("mavis-bridge")

# ── Config ─────────────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent / "bridge_config.json"

def load_config() -> dict:
    if not CONFIG_PATH.exists():
        log.error("Config not found: %s", CONFIG_PATH)
        log.error("Copy bridge_config.json.example → bridge_config.json and fill in credentials.")
        sys.exit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(config: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

# ── Optional adapters ──────────────────────────────────────────────────────────

def _try_import(module: str):
    try:
        return importlib.import_module(module)
    except ImportError:
        return None

_gpio    = _try_import("RPi.GPIO") or _try_import("gpiozero")
_serial  = _try_import("serial")
_mqtt    = _try_import("paho.mqtt.client")
_requests = _try_import("requests")

log.info("Adapters loaded — gpio:%s  serial:%s  mqtt:%s  http:%s",
         bool(_gpio), bool(_serial), bool(_mqtt), bool(_requests))

# ── Auth ───────────────────────────────────────────────────────────────────────

def authenticate(supabase: Client, email: str, password: str) -> str:
    resp = supabase.auth.sign_in_with_password({"email": email, "password": password})
    if not resp.session:
        raise RuntimeError("Authentication failed — check email/password in bridge_config.json")
    log.info("Signed in as %s", email)
    return resp.session.access_token

# ── Device registration ────────────────────────────────────────────────────────

def register_device(supabase: Client, config: dict) -> str:
    uname = platform.uname()
    resp = supabase.functions.invoke(
        "mavis-device-bridge",
        invoke_options={"body": {
            "action": "register_device",
            "name": config.get("device_name", uname.node or "MAVIS Bridge"),
            "device_type": config.get("device_type", "pc"),
            "platform": uname.system.lower(),
            "metadata": {
                "hostname": uname.node,
                "os_version": uname.version,
                "machine": uname.machine,
                "python": sys.version,
                "adapters": {
                    "gpio": bool(_gpio),
                    "serial": bool(_serial),
                    "mqtt": bool(_mqtt),
                    "http": bool(_requests),
                },
            },
        }},
    )
    data = resp.get("data") if isinstance(resp, dict) else {}
    if isinstance(data, bytes):
        data = json.loads(data)
    device_id = data.get("device_id", "")
    if not device_id:
        raise RuntimeError(f"register_device failed: {data}")
    config["device_id"] = device_id
    save_config(config)
    log.info("Device registered: %s", device_id)
    return device_id

def update_device_status(supabase: Client, device_id: str, status: str) -> None:
    supabase.table("mavis_devices").update({
        "status": status,
        "last_seen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }).eq("id", device_id).execute()

# ── Command handlers: OS / file ────────────────────────────────────────────────

def handle_shell(params: dict) -> dict:
    command = params.get("command", "")
    timeout = int(params.get("timeout", 30))
    shell_cmd = params.get("shell", "powershell") if platform.system() == "Windows" else params.get("shell", "bash")
    flag = "-Command" if "powershell" in shell_cmd else "-c"
    try:
        result = subprocess.run(
            [shell_cmd, flag, command],
            capture_output=True, text=True, timeout=timeout,
        )
        return {"stdout": result.stdout, "stderr": result.stderr, "returncode": result.returncode}
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
        procs.append({"pid": info["pid"], "name": info["name"],
                      "cpu_percent": info.get("cpu_percent") or 0, "memory_mb": mem_mb})
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
        "platform": {"system": uname.system, "node": uname.node, "release": uname.release,
                     "version": uname.version, "machine": uname.machine, "processor": uname.processor},
        "cpu": {"count": psutil.cpu_count(), "percent": psutil.cpu_percent(interval=1)},
        "memory": {"total_gb": round(mem.total / 1024**3, 2),
                   "available_gb": round(mem.available / 1024**3, 2), "percent_used": mem.percent},
        "disk": {"total_gb": round(disk.total / 1024**3, 2),
                 "used_gb": round(disk.used / 1024**3, 2), "percent_used": disk.percent},
        "adapters": {"gpio": bool(_gpio), "serial": bool(_serial),
                     "mqtt": bool(_mqtt), "http": bool(_requests)},
    }

def handle_launch_app(params: dict) -> dict:
    path = params.get("path", "")
    if not path:
        return {"error": "launch_app requires 'path' param"}
    args = params.get("args", [])
    proc = subprocess.Popen([path] + (args if isinstance(args, list) else []))
    return {"launched": path, "pid": proc.pid}

def handle_file_read(params: dict) -> dict:
    path = params.get("path", "")
    if not path:
        return {"error": "file_read requires 'path' param"}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(50 * 1024)
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
    try:
        import pyautogui  # type: ignore
        from PIL import Image  # type: ignore
        import io, base64
        shot = pyautogui.screenshot()
        buf = io.BytesIO()
        shot.save(buf, format="PNG")
        return {"image_b64": base64.b64encode(buf.getvalue()).decode(), "format": "png"}
    except ImportError:
        return {"status": "screenshot_not_supported",
                "note": "pip install Pillow pyautogui to enable"}

# ── GPIO adapter ───────────────────────────────────────────────────────────────

def handle_gpio(params: dict) -> dict:
    """
    GPIO pin control for Raspberry Pi.
    params: { op: "set" | "get" | "pwm", pin: int, value: 0|1, duty_cycle: 0-100, frequency: int }
    Requires: pip install RPi.GPIO   (on Raspberry Pi only)
    """
    if not _gpio:
        return {"error": "GPIO adapter not available — pip install RPi.GPIO on a Raspberry Pi"}

    rpi_gpio = _try_import("RPi.GPIO")
    if rpi_gpio is None:
        return {"error": "RPi.GPIO required for gpio handler"}

    pin = int(params.get("pin", 0))
    op  = params.get("op", "get")

    rpi_gpio.setmode(rpi_gpio.BCM)

    if op == "set":
        rpi_gpio.setup(pin, rpi_gpio.OUT)
        rpi_gpio.output(pin, rpi_gpio.HIGH if params.get("value", 0) else rpi_gpio.LOW)
        return {"pin": pin, "value": params.get("value", 0)}

    if op == "get":
        rpi_gpio.setup(pin, rpi_gpio.IN)
        val = rpi_gpio.input(pin)
        return {"pin": pin, "value": val}

    if op == "pwm":
        freq = int(params.get("frequency", 50))
        duty = float(params.get("duty_cycle", 50))
        rpi_gpio.setup(pin, rpi_gpio.OUT)
        pwm = rpi_gpio.PWM(pin, freq)
        pwm.start(duty)
        time.sleep(float(params.get("duration", 1)))
        pwm.stop()
        return {"pin": pin, "frequency": freq, "duty_cycle": duty}

    return {"error": f"Unknown GPIO op: {op}"}

# ── Serial adapter ─────────────────────────────────────────────────────────────

def handle_serial(params: dict) -> dict:
    """
    Send/receive data over a serial port (Arduino, ESP32, etc).
    params: { port: "COM3", baud: 9600, send: "Hello", read_bytes: 64, timeout: 2 }
    Requires: pip install pyserial
    """
    if not _serial:
        return {"error": "Serial adapter not available — pip install pyserial"}

    port    = params.get("port", "COM3")
    baud    = int(params.get("baud", 9600))
    timeout = float(params.get("timeout", 2))
    send    = params.get("send", "")
    read_n  = int(params.get("read_bytes", 64))

    try:
        import serial as ser_mod  # type: ignore
        with ser_mod.Serial(port, baud, timeout=timeout) as s:
            if send:
                s.write((send + "\n").encode("utf-8"))
                time.sleep(0.1)
            received = s.read(read_n).decode("utf-8", errors="replace") if read_n else ""
        return {"port": port, "sent": send, "received": received}
    except Exception as exc:
        return {"error": str(exc)}

# ── MQTT adapter ───────────────────────────────────────────────────────────────

def handle_mqtt(params: dict) -> dict:
    """
    Publish or subscribe to an MQTT topic (smart home, IoT sensors).
    params: { broker: "192.168.1.10", port: 1883, topic: "home/lights/1",
              op: "publish" | "subscribe", payload: "ON", timeout: 5 }
    Requires: pip install paho-mqtt
    """
    if not _mqtt:
        return {"error": "MQTT adapter not available — pip install paho-mqtt"}

    import paho.mqtt.client as mqtt_mod  # type: ignore
    import paho.mqtt.publish as mqtt_pub  # type: ignore

    broker  = params.get("broker", "localhost")
    port    = int(params.get("port", 1883))
    topic   = params.get("topic", "#")
    op      = params.get("op", "publish")
    payload = str(params.get("payload", ""))
    timeout = float(params.get("timeout", 5))

    if op == "publish":
        try:
            mqtt_pub.single(topic, payload=payload, hostname=broker, port=port)
            return {"published": {"broker": broker, "topic": topic, "payload": payload}}
        except Exception as exc:
            return {"error": str(exc)}

    if op == "subscribe":
        received: list = []
        connected = threading.Event()
        done = threading.Event()

        def on_connect(client, userdata, flags, rc):
            client.subscribe(topic)
            connected.set()

        def on_message(client, userdata, msg):
            received.append({"topic": msg.topic, "payload": msg.payload.decode("utf-8", errors="replace")})
            done.set()

        client = mqtt_mod.Client()
        client.on_connect = on_connect
        client.on_message = on_message
        client.connect(broker, port, 60)
        client.loop_start()
        connected.wait(timeout)
        done.wait(timeout)
        client.loop_stop()
        client.disconnect()
        return {"messages": received}

    return {"error": f"Unknown MQTT op: {op}"}

# ── HTTP device adapter ────────────────────────────────────────────────────────

def handle_http_device(params: dict) -> dict:
    """
    Call any HTTP-based device or service (smart plugs, Philips Hue, custom APIs).
    params: { url: "http://192.168.1.20/api", method: "POST",
              headers: {}, body: {}, timeout: 10 }
    """
    if not _requests:
        return {"error": "requests library not available — pip install requests"}

    import requests as req_mod  # type: ignore

    url     = params.get("url", "")
    method  = params.get("method", "GET").upper()
    headers = params.get("headers", {})
    body    = params.get("body", None)
    timeout = float(params.get("timeout", 10))

    if not url:
        return {"error": "http_device requires 'url' param"}

    try:
        resp = req_mod.request(
            method, url, headers=headers,
            json=body if isinstance(body, dict) else None,
            data=body if isinstance(body, str) else None,
            timeout=timeout,
        )
        try:
            response_body = resp.json()
        except Exception:
            response_body = resp.text
        return {"status_code": resp.status_code, "body": response_body}
    except Exception as exc:
        return {"error": str(exc)}

# ── Dispatch table ─────────────────────────────────────────────────────────────

HANDLERS: dict = {
    "shell":         handle_shell,
    "get_processes": handle_get_processes,
    "kill_process":  handle_kill_process,
    "system_info":   handle_system_info,
    "launch_app":    handle_launch_app,
    "file_read":     handle_file_read,
    "file_write":    handle_file_write,
    "screenshot":    handle_screenshot,
    # Hardware adapters
    "gpio":          handle_gpio,
    "serial":        handle_serial,
    "mqtt":          handle_mqtt,
    "http_device":   handle_http_device,
}

# ── Core executor ──────────────────────────────────────────────────────────────

def run_command(command_type: str, params: dict) -> dict:
    handler = HANDLERS.get(command_type)
    if not handler:
        raise ValueError(f"Unknown command_type: {command_type!r}")
    return handler(params)

def execute_db_command(supabase: Client, command: dict) -> None:
    command_id   = command["id"]
    command_type = command.get("command_type", "")
    params       = command.get("params") or {}

    log.info("Executing %s (id=%s)", command_type, command_id)
    supabase.table("mavis_device_commands").update({
        "status": "executing",
        "executed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }).eq("id", command_id).execute()

    try:
        result = run_command(command_type, params)
        supabase.table("mavis_device_commands").update({
            "status": "done",
            "result": result,
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }).eq("id", command_id).execute()
        log.info("Done: %s", command_type)
    except Exception as exc:
        log.warning("Failed: %s — %s", command_type, exc)
        supabase.table("mavis_device_commands").update({
            "status": "failed",
            "error": str(exc),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }).eq("id", command_id).execute()

# ── Local HTTP server ──────────────────────────────────────────────────────────
#
# Exposes the same command interface on http://localhost:7791
# Allows same-machine tools, LAN callers, or ngrok tunnels to dispatch
# commands without going through the Supabase cloud path.
#
# API:
#   GET  /status     → { ok, device_id, uptime_s, adapters }
#   POST /command    → { command_type, params } → { ok, result } | { error }

_start_time = time.time()
_http_device_id: str = ""

class _BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.debug("HTTP %s", fmt % args)

    def _send_json(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/status":
            self._send_json(200, {
                "ok": True,
                "device_id": _http_device_id,
                "uptime_s": round(time.time() - _start_time),
                "adapters": {
                    "gpio": bool(_gpio),
                    "serial": bool(_serial),
                    "mqtt": bool(_mqtt),
                    "http": bool(_requests),
                },
                "commands": list(HANDLERS.keys()),
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/command":
            self._send_json(404, {"error": "Not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(length)
        try:
            body = json.loads(body_bytes)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON"})
            return
        command_type = body.get("command_type", "")
        params = body.get("params", {})
        try:
            result = run_command(command_type, params)
            self._send_json(200, {"ok": True, "result": result})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})

def start_http_server(port: int) -> None:
    server = HTTPServer(("0.0.0.0", port), _BridgeHandler)
    log.info("HTTP server on http://0.0.0.0:%d  (GET /status  POST /command)", port)
    server.serve_forever()

# ── Heartbeat ──────────────────────────────────────────────────────────────────

def heartbeat_loop(supabase: Client, device_id: str, stop_event: threading.Event) -> None:
    while not stop_event.wait(30):
        try:
            supabase.table("mavis_devices").update({
                "last_seen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }).eq("id", device_id).execute()
        except Exception as exc:
            log.warning("Heartbeat error: %s", exc)

# ── Supabase polling ───────────────────────────────────────────────────────────

def poll_loop(supabase: Client, device_id: str, stop_event: threading.Event) -> None:
    log.info("Polling for commands on device %s (every 2s)", device_id)
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
                execute_db_command(supabase, command)
        except Exception as exc:
            log.warning("Poll error: %s", exc)
        stop_event.wait(2)

# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    global _http_device_id

    config = load_config()
    supabase_url  = config.get("supabase_url", "")
    supabase_key  = config.get("supabase_key", "")
    device_id     = config.get("device_id", "")
    user_email    = config.get("user_email", "")
    user_password = config.get("user_password", "")
    http_port     = int(config.get("http_port", 7791))

    if not supabase_url or not supabase_key:
        log.error("supabase_url and supabase_key are required in bridge_config.json")
        sys.exit(1)

    supabase: Client = create_client(supabase_url, supabase_key)
    access_token = authenticate(supabase, user_email, user_password)
    supabase.auth.set_session(access_token, "")

    if not device_id:
        device_id = register_device(supabase, config)
    else:
        log.info("Using existing device_id: %s", device_id)

    _http_device_id = device_id
    update_device_status(supabase, device_id, "online")
    log.info("Device online — listening for commands")

    stop_event = threading.Event()

    def shutdown(signum, frame):
        log.info("Shutting down...")
        stop_event.set()
        try:
            update_device_status(supabase, device_id, "offline")
        except Exception:
            pass
        log.info("Device marked offline. Goodbye.")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Heartbeat thread
    threading.Thread(
        target=heartbeat_loop, args=(supabase, device_id, stop_event),
        daemon=True, name="heartbeat",
    ).start()

    # Local HTTP server thread
    threading.Thread(
        target=start_http_server, args=(http_port,),
        daemon=True, name="http-server",
    ).start()

    # Supabase polling (main thread)
    poll_loop(supabase, device_id, stop_event)


if __name__ == "__main__":
    main()
