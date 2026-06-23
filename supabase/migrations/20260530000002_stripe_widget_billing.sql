ALTER TABLE widget_instances
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_widget_instances_stripe_sub ON widget_instances(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_widget_instances_stripe_cust ON widget_instances(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Track Stripe event IDs to prevent double-processing
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id text PRIMARY KEY,  -- Stripe event ID (evt_xxx)
  type text NOT NULL,
  processed_at timestamptz DEFAULT now()
);
