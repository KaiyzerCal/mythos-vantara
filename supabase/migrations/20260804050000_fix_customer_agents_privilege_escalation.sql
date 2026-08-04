-- ============================================================
-- SECURITY FIX — customer_agents billing/stats self-modification
-- ============================================================
-- Same class of bug as widget_instances (see
-- 20260804000001_fix_widget_billing_privilege_escalation.sql):
-- customer_agents' self-update RLS policy (auth.uid() = user_id,
-- cmd ALL, no column restriction) lets an agent owner PATCH their
-- own plan_tier, monthly_price_cents, status, total_conversations,
-- total_messages, embed_token, and deploy_slug directly — upgrading
-- their own plan for free, faking usage stats, reactivating a
-- suspended agent, or reissuing their embed token to invalidate a
-- revoked one.
--
-- This is defense-in-depth for direct PostgREST access. The primary
-- exploit path (mavis-agent-builder's "update" action spreading the
-- raw request body into an unrestricted .update() call, which runs
-- as service_role and so bypasses this trigger entirely) is fixed
-- separately in the edge function itself with an explicit allowlist.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_customer_agent_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
      OR NEW.monthly_price_cents IS DISTINCT FROM OLD.monthly_price_cents
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.total_conversations IS DISTINCT FROM OLD.total_conversations
      OR NEW.total_messages IS DISTINCT FROM OLD.total_messages
      OR NEW.embed_token IS DISTINCT FROM OLD.embed_token
      OR NEW.deploy_slug IS DISTINCT FROM OLD.deploy_slug
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'This field can only be changed by the agent management system';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_customer_agent_billing_columns_trigger ON public.customer_agents;
CREATE TRIGGER protect_customer_agent_billing_columns_trigger
BEFORE UPDATE ON public.customer_agents
FOR EACH ROW
EXECUTE FUNCTION public.protect_customer_agent_billing_columns();
