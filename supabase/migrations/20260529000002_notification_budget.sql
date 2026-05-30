-- Smart notification budget: each user gets 5 notification slots per day.
-- Notifications are deducted from the budget; highest-priority fire first.

CREATE TABLE IF NOT EXISTS notification_budget (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date NOT NULL DEFAULT current_date,
  slots_used   int  NOT NULL DEFAULT 0,
  slots_total  int  NOT NULL DEFAULT 5,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE notification_budget ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own budget" ON notification_budget
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notification priority log (for analytics/tuning)
CREATE TABLE IF NOT EXISTS notification_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL, -- streak_risk | deadline | energy | contract_violation | motivational
  title         text NOT NULL,
  body          text,
  priority      int  NOT NULL DEFAULT 5, -- 1 (highest) to 10 (lowest)
  sent_at       timestamptz DEFAULT now(),
  opened        boolean DEFAULT false,
  opened_at     timestamptz
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users view own log" ON notification_log
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Function: consume one notification slot
-- Returns true if slot was available, false if budget exhausted
CREATE OR REPLACE FUNCTION consume_notification_slot(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_used int;
  v_total int;
BEGIN
  INSERT INTO notification_budget (user_id, date, slots_used, slots_total)
  VALUES (p_user_id, current_date, 0, 5)
  ON CONFLICT (user_id, date) DO NOTHING;

  SELECT slots_used, slots_total
  INTO v_used, v_total
  FROM notification_budget
  WHERE user_id = p_user_id AND date = current_date
  FOR UPDATE;

  IF v_used >= v_total THEN
    RETURN false;
  END IF;

  UPDATE notification_budget
  SET slots_used = slots_used + 1, updated_at = now()
  WHERE user_id = p_user_id AND date = current_date;

  RETURN true;
END;
$$;
