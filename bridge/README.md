# MAVIS Device Bridge

Runs on your Windows PC (or any Python-capable machine). Connects to Supabase Realtime and executes commands issued by MAVIS.

## Setup

1. **Install Python 3.11+**

2. **Install dependencies**
   ```
   pip install -r requirements.txt
   ```

3. **Configure**
   ```
   copy bridge_config.json.example bridge_config.json
   ```
   Edit `bridge_config.json` and fill in:
   - `supabase_url` — your project URL (e.g. `https://abc123.supabase.co`)
   - `supabase_key` — your anon/public key
   - `user_email` / `user_password` — your MAVIS account credentials
   - `device_name` — a friendly name for this machine (optional)
   - Leave `device_id` blank on first run; it will be populated automatically

4. **Run**
   ```
   python mavis_bridge.py
   ```

   First run registers the device and saves the `device_id` to `bridge_config.json`. Subsequent runs reuse it.

5. **Stop** — press `Ctrl+C`. The bridge marks the device offline before exiting.

## Supported commands

| command_type    | Description                                      |
|-----------------|--------------------------------------------------|
| `shell`         | Run a PowerShell command, returns stdout/stderr  |
| `get_processes` | List top 30 processes by CPU usage               |
| `kill_process`  | Kill a process by PID or name                    |
| `system_info`   | Platform, CPU, memory, disk stats                |
| `launch_app`    | Launch an executable by path                     |
| `file_read`     | Read a file (max 50 KB)                          |
| `file_write`    | Write content to a file                          |
| `screenshot`    | Not supported by default (see note below)        |

### Enabling screenshots

Install optional dependencies:
```
pip install Pillow pyautogui
```
Then update the `handle_screenshot` function in `mavis_bridge.py`.

## Notes

- The bridge polls for pending commands every 2 seconds. For sub-second latency, migrate to the async Realtime client.
- Commands time out after 30 seconds by default (override with `params.timeout`).
- The `bridge_config.json` file contains credentials — do not commit it.
