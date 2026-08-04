-- ============================================================
-- SECURITY FIX — widget_instances billing self-modification
-- ============================================================
-- Found via live testing: widget_instances' self-update RLS policy
-- (auth.uid() = user_id, cmd ALL, no column restriction) let a widget
-- owner PATCH their own subscription_status, monthly_price_cents, and
-- trial_ends_at directly. Verified live: a freshly created, unpaid
-- test widget had its subscription_status set to 'active', price set
-- to $0, and trial extended to 2099 with a single authenticated PATCH
-- — the same class of bug as navi-exe's subscription_tier
-- privilege-escalation (see that repo's
-- 20260803060000_fix_privilege_escalation.sql for the sibling fix).
--
-- The real write path is supabase/functions/stripe-widget-webhook,
-- which runs as service_role and writes exactly the columns locked
-- below. This trigger blocks everyone else from touching them while
-- leaving the rest of the row (config, business_context, etc.)
-- freely self-editable, since those were never the problem.
--
-- Verified live: exploit attempt now fails with this trigger's error;
-- a legitimate self-edit (config) still succeeds.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_widget_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.monthly_price_cents IS DISTINCT FROM OLD.monthly_price_cents
      OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
      OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
      OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
      OR NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
      OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
      OR NEW.cancel_at_period_end IS DISTINCT FROM OLD.cancel_at_period_end
    THEN
      RAISE EXCEPTION 'Billing fields can only be changed by the payment system';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_widget_billing_columns_trigger ON public.widget_instances;
CREATE TRIGGER protect_widget_billing_columns_trigger
BEFORE UPDATE ON public.widget_instances
FOR EACH ROW
EXECUTE FUNCTION public.protect_widget_billing_columns();
