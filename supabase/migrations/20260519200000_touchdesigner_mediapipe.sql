-- TouchDesigner + MediaPipe integration
-- Supports: real-time gesture control, biometric context for agents,
-- TouchDesigner WebSocket/OSC bridge, gesture-to-command mapping.

-- ── Gesture event log ─────────────────────────────────────────────────────────
-- Rolling log of detected gestures from MediaPipe inference loop.
-- Pruned to last 500 events per user by cleanup function below.
CREATE TABLE IF NOT EXISTS public.mavis_gesture_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Detection result
  source          text        NOT NULL DEFAULT 'mediapipe'
                              CHECK (source IN ('mediapipe','touchdesigner','osc')),
  gesture         text        NOT NULL,       -- e.g. "Thumb_Up", "Open_Palm", "/hand/gesture"
  confidence      float       DEFAULT 1.0,
  hand            text,                       -- "Left" | "Right" | null (pose/face)
  sensor_type     text        NOT NULL DEFAULT 'gesture'
                              CHECK (sensor_type IN ('gesture','face','pose','custom')),

  -- Context
  action_triggered text,                      -- MAVIS action that was fired, if any
  payload         jsonb       DEFAULT '{}',   -- raw landmark data or custom fields

  detected_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_gesture_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own gesture events"
  ON public.mavis_gesture_events FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_gesture_events_user_time
  ON public.mavis_gesture_events(user_id, detected_at DESC);

-- ── Biometric state (latest snapshot) ────────────────────────────────────────
-- One row per user, upserted on each inference cycle.
-- Agents read this for contextual awareness (presence, mood, attention).
CREATE TABLE IF NOT EXISTS public.mavis_biometric_state (
  user_id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Presence
  face_present    boolean     DEFAULT false,
  face_count      int         DEFAULT 0,
  proximity       text        DEFAULT 'unknown'
                              CHECK (proximity IN ('close','medium','far','absent','unknown')),

  -- Estimated expression (heuristic from landmarks)
  expression      text        DEFAULT 'neutral'
                              CHECK (expression IN ('neutral','happy','focused','tired','surprised','unknown')),
  expression_confidence float DEFAULT 0,

  -- Pose / engagement
  pose_detected   boolean     DEFAULT false,
  engagement      text        DEFAULT 'unknown'
                              CHECK (engagement IN ('engaged','distracted','away','resting','unknown')),

  -- Last gesture
  last_gesture    text,
  last_gesture_at timestamptz,
  last_gesture_confidence float DEFAULT 0,

  -- Session stats
  session_gesture_count int   DEFAULT 0,
  tracking_started_at   timestamptz,
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.mavis_biometric_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own biometric state"
  ON public.mavis_biometric_state FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── TouchDesigner connection registry ────────────────────────────────────────
-- Stores TD server configs (WebSocket host + port + OSC settings).
CREATE TABLE IF NOT EXISTS public.mavis_td_connections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT 'TouchDesigner',

  -- WebSocket transport
  ws_host         text        NOT NULL DEFAULT 'localhost',
  ws_port         int         NOT NULL DEFAULT 9980,
  ws_path         text        DEFAULT '/',
  ws_enabled      boolean     DEFAULT true,

  -- OSC transport (received via a WebSocket-OSC bridge running locally)
  osc_enabled     boolean     DEFAULT false,
  osc_port        int         DEFAULT 7000,

  -- MAVIS → TD output topics (what MAVIS state to stream to TD)
  output_topics   text[]      DEFAULT '{"agent_state","voice_active","gesture_ack"}',

  -- Auth
  auth_token      text,

  -- Health
  last_connected_at timestamptz,
  health_status   text        DEFAULT 'unknown'
                              CHECK (health_status IN ('connected','disconnected','error','unknown')),

  enabled         boolean     DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.mavis_td_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own TD connections"
  ON public.mavis_td_connections FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Gesture command mappings ──────────────────────────────────────────────────
-- User-configurable gesture → MAVIS action bindings.
CREATE TABLE IF NOT EXISTS public.mavis_gesture_commands (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  gesture         text        NOT NULL,       -- MediaPipe gesture name or TD address
  hold_ms         int         DEFAULT 0,      -- 0 = single detection, >0 = hold required
  action          text        NOT NULL,       -- MAVIS action/skill name
  action_payload  jsonb       DEFAULT '{}',   -- extra params passed to action
  description     text,
  enabled         boolean     DEFAULT true,

  created_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, gesture)
);

ALTER TABLE public.mavis_gesture_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own gesture commands"
  ON public.mavis_gesture_commands FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Cleanup: keep only last 500 gesture events per user ──────────────────────
CREATE OR REPLACE FUNCTION public.prune_gesture_events(p_user_id uuid)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.mavis_gesture_events
  WHERE user_id = p_user_id
    AND id NOT IN (
      SELECT id FROM public.mavis_gesture_events
      WHERE user_id = p_user_id
      ORDER BY detected_at DESC
      LIMIT 500
    );
$$;
