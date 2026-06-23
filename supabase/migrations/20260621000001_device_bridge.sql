-- Device registry: tracks all registered devices for each user
CREATE TABLE IF NOT EXISTS mavis_devices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  device_type text DEFAULT 'pc',   -- pc | pi | robot | iot
  platform text,                    -- windows | linux | macos
  status text DEFAULT 'offline',    -- online | offline | error
  last_seen timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_devices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own devices" ON mavis_devices FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_devices_user ON mavis_devices(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Command queue (Realtime-enabled): MAVIS queues commands, bridge picks them up
CREATE TABLE IF NOT EXISTS mavis_device_commands (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  device_id uuid REFERENCES mavis_devices(id) ON DELETE CASCADE NOT NULL,
  command_type text NOT NULL,  -- shell | launch_app | kill_process | get_processes | screenshot | file_read | file_write | system_info
  params jsonb DEFAULT '{}',
  status text DEFAULT 'pending',  -- pending | executing | done | failed | timeout
  result jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE mavis_device_commands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own device commands" ON mavis_device_commands FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_device_commands_user ON mavis_device_commands(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_device_commands_device ON mavis_device_commands(device_id, created_at DESC);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_device_commands_status ON mavis_device_commands(device_id, status) WHERE status = 'pending';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enable Realtime so the bridge receives INSERT events instantly
ALTER PUBLICATION supabase_realtime ADD TABLE mavis_device_commands;
