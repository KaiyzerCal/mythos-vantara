# MAVIS Universal Device Bridge

Runs on your machine (Windows, Linux, macOS, Raspberry Pi). Receives commands from MAVIS via two paths:

1. **Supabase cloud** — MAVIS queues commands in the DB; the bridge polls every 2s and executes them
2. **Local HTTP** — any tool on the same machine or LAN can POST to `http://localhost:7791/command`

## Setup

### 1. Install Python 3.11+

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

For optional hardware adapters:

```bash
# Serial (Arduino, ESP32)
pip install pyserial

# MQTT (smart home, Zigbee hubs, Home Assistant)
pip install paho-mqtt

# GPIO (Raspberry Pi only)
pip install RPi.GPIO

# Screenshot
pip install Pillow pyautogui
```

### 3. Configure

```bash
# Windows
copy bridge_config.json.example bridge_config.json

# Mac/Linux
cp bridge_config.json.example bridge_config.json
```

Edit `bridge_config.json`:

| Key | Required | Description |
|-----|----------|-------------|
| `supabase_url` | Yes | Your project URL (`https://abc.supabase.co`) |
| `supabase_key` | Yes | Anon/public key |
| `user_email` | Yes | Your MAVIS account email |
| `user_password` | Yes | Your MAVIS account password |
| `device_name` | No | Friendly name (default: hostname) |
| `device_type` | No | `pc` \| `pi` \| `robot` \| `iot` |
| `device_id` | Auto | Leave blank — set automatically on first run |
| `http_port` | No | Local HTTP server port (default: 7791) |

### 4. Run

```bash
python mavis_bridge.py
```

First run auto-registers the device and saves `device_id` to `bridge_config.json`. Use `Ctrl+C` to stop — the bridge marks the device offline before exiting.

---

## Local HTTP API

While running, the bridge exposes:

```
GET  http://localhost:7791/status
POST http://localhost:7791/command
```

**Status:**
```bash
curl http://localhost:7791/status
```

**Run a command:**
```bash
curl -X POST http://localhost:7791/command \
  -H "Content-Type: application/json" \
  -d '{"command_type": "system_info", "params": {}}'
```

---

## Command Reference

### OS / File

| `command_type` | Key params | Description |
|----------------|-----------|-------------|
| `shell` | `command`, `timeout`, `shell` | Run a shell command (PowerShell on Windows, bash elsewhere) |
| `get_processes` | — | Top 30 processes by CPU |
| `kill_process` | `pid` or `name` | Kill a process |
| `system_info` | — | CPU, memory, disk, platform info |
| `launch_app` | `path`, `args` | Start an executable |
| `file_read` | `path` | Read a file (max 50 KB) |
| `file_write` | `path`, `content` | Write a file (creates dirs) |
| `screenshot` | — | Capture screen (needs Pillow + pyautogui) |

### Hardware

| `command_type` | Key params | Requires | Description |
|----------------|-----------|----------|-------------|
| `gpio` | `pin`, `op` (`set`/`get`/`pwm`), `value` | `RPi.GPIO` | Raspberry Pi GPIO pin control |
| `serial` | `port`, `baud`, `send`, `read_bytes` | `pyserial` | Send/receive over USB serial (Arduino, ESP32) |
| `mqtt` | `broker`, `topic`, `op` (`publish`/`subscribe`), `payload` | `paho-mqtt` | MQTT pub/sub for smart home devices |
| `http_device` | `url`, `method`, `body`, `headers` | `requests` | Call any HTTP device (Hue, Tasmota, etc.) |

### GPIO example (Raspberry Pi)

```json
{ "command_type": "gpio", "params": { "op": "set", "pin": 18, "value": 1 } }
```

### Arduino example

```json
{ "command_type": "serial", "params": { "port": "COM3", "baud": 9600, "send": "LED_ON", "read_bytes": 32 } }
```

### MQTT example (turn on a smart switch)

```json
{ "command_type": "mqtt", "params": { "broker": "192.168.1.10", "topic": "home/switch/1/set", "op": "publish", "payload": "ON" } }
```

### HTTP device example (Tasmota plug)

```json
{ "command_type": "http_device", "params": { "url": "http://192.168.1.50/cm?cmnd=Power%20On" } }
```

---

## Security Notes

- `bridge_config.json` contains credentials — **never commit it** (it's in `.gitignore`)
- The local HTTP server has no authentication — run it on a trusted LAN only, or add your own auth layer
- For remote access, use a VPN or ngrok rather than opening the port to the internet
