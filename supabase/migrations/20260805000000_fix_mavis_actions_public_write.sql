-- ============================================================
-- SECURITY FIX — mavis_actions publicly writable
-- ============================================================
-- "Service role can insert"/"Service role can update" are USING(true)/
-- WITH CHECK(true) with no TO service_role clause — despite the names,
-- these apply to every role, not just service_role. Any authenticated
-- (or anon, depending on grants) caller could insert fake source:"LINDA"
-- tasks or overwrite any other user's row via PostgREST directly. Same
-- class of bug as the already-fixed customer_agent_messages gap.
-- ============================================================

DROP POLICY IF EXISTS "Service role can insert" ON mavis_actions;
CREATE POLICY "Service role can insert"
  ON mavis_actions FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update" ON mavis_actions;
CREATE POLICY "Service role can update"
  ON mavis_actions FOR UPDATE
  TO service_role
  USING (true);
