-- MAVIS SMS / WhatsApp log — Twilio outbound message records
CREATE TABLE IF NOT EXISTS mavis_sms_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  to_number text NOT NULL,
  from_number text NOT NULL,
  message text NOT NULL,
  channel text NOT NULL DEFAULT 'sms',  -- sms | whatsapp
  status text NOT NULL DEFAULT 'sent',
  twilio_sid text,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mavis_sms_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "user own sms log" ON mavis_sms_log FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_sms_log_user ON mavis_sms_log(user_id, created_at DESC);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX idx_mavis_sms_log_twilio_sid ON mavis_sms_log(twilio_sid) WHERE twilio_sid IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;
