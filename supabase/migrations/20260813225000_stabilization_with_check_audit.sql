-- Stabilization pass (pre-Capacitor-app audit): a plain USING clause with
-- no WITH CHECK lets an owner UPDATE their own row into a state that
-- violates the same ownership condition — same class of gap already fixed
-- for navi_messages/direct_messages in NAVI this session. Full-table sweep
-- found 8 UPDATE policies missing WITH CHECK; 7 are real (owner-scoped,
-- fixed below), 1 (mavis_actions "Service role can update") is TO
-- service_role only, which bypasses RLS entirely in Supabase regardless
-- of policy content — moot, left as-is.
ALTER POLICY "Users update own actions" ON mavis_action_queue WITH CHECK (auth.uid() = user_id);
ALTER POLICY "Users update own browser sessions" ON mavis_browser_sessions WITH CHECK (auth.uid() = user_id);
ALTER POLICY "Users update own notes" ON mavis_notes WITH CHECK (auth.uid() = user_id);
ALTER POLICY "Users can update their own persona memories" ON persona_memories WITH CHECK (auth.uid() = user_id);
ALTER POLICY "Users can update their own personas" ON personas WITH CHECK (auth.uid() = user_id);
ALTER POLICY "Users can update own profile" ON profiles WITH CHECK (auth.uid() = id);
ALTER POLICY "Users can update their own relationship states" ON relationship_states WITH CHECK (auth.uid() = user_id);
