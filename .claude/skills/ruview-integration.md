# RuView Integration — WiFi Ambient Intelligence for MAVIS

**Triggers:** `["ruview", "presence detection", "vitals sensing", "esp32", "ambient intelligence", "through-wall sensing"]`

## What It Is

RuView uses $8 ESP32 nodes to sense through walls — no cameras. Detects presence, breathing (6–30 BPM), heart rate (40–120 BPM), 17-keypoint body pose estimation, and fall detection. MIT licensed. Ships an MCP server natively.

**GitHub:** `KaiyzerCal/RuView` | **Language:** Python + C++ (ESP32 firmware)

## Hardware Setup

```bash
# Flash ESP32 nodes (one per room zone)
pip install ruview-flash
ruview-flash --port /dev/ttyUSB0 --network YOUR_SSID --password YOUR_PASS

# Each node auto-publishes to MQTT on your local network
# Topic format: ruview/{node_id}/{metric}
```

## MCP Server (Claude Code integration)

```bash
# Run the MCP server
npx @ruvnet/ruview

# Claude Code config (~/.claude/settings.json)
{
  "mcpServers": {
    "ruview": {
      "command": "npx",
      "args": ["@ruvnet/ruview"],
      "env": { "RUVIEW_HOST": "192.168.1.x" }
    }
  }
}
```

## Python Async Client

```python
from ruview import RuViewClient

async def get_presence():
    async with RuViewClient("ws://192.168.1.x:8765") as client:
        state = await client.get_current_state()
        return {
            "present": state.presence,
            "breathing_bpm": state.breathing_rate,
            "heart_rate": state.heart_rate,
            "pose": state.pose_keypoints,
        }
```

## Home Assistant / Matter Integration

```yaml
# configuration.yaml
sensor:
  - platform: mqtt
    name: "Calvin Breathing Rate"
    state_topic: "ruview/node1/breathing_rate"
    unit_of_measurement: "BPM"
```

Supports Matter protocol → Apple Home / Alexa / Google Home auto-discovery.

## MAVIS Integration Pattern

Wire RuView events into Supabase `life_events` via a Deno edge function:

```typescript
// supabase/functions/ruview-webhook/index.ts
Deno.serve(async (req) => {
  const { node_id, metric, value, timestamp } = await req.json();
  
  await supabase.from("life_events").insert({
    user_id: OPERATOR_USER_ID,
    type: "ambient",
    source: `ruview/${node_id}`,
    data: { metric, value },
    created_at: new Date(timestamp).toISOString(),
  });
  
  // Trigger MAVIS alert if HRV drops or fall detected
  if (metric === "fall_detected" && value === true) {
    await sendTelegramNotification("⚠️ Fall detected at home.", "auto", null);
  }
  
  return new Response("OK");
});
```

## Use Cases for MAVIS

- **Presence context** — MAVIS knows when you're home vs. away
- **HRV proxy** — heart rate variability for stress/recovery scoring
- **Auto-briefing** — morning brief fires when you wake (first movement detected)
- **Energy system sync** — update `energy_systems.current_value` from breathing pattern
- **Fall/emergency alert** — Telegram push on fall detection
