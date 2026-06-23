
-- Tighten website_clients
DROP POLICY IF EXISTS "user own clients" ON public.website_clients;
CREATE POLICY "Users manage own website clients" ON public.website_clients
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Tighten whoop_tokens
DROP POLICY IF EXISTS "user own whoop tokens" ON public.whoop_tokens;
CREATE POLICY "Users manage own whoop tokens" ON public.whoop_tokens
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Tighten wp_credentials
DROP POLICY IF EXISTS "user own wp creds" ON public.wp_credentials;
CREATE POLICY "Users manage own wp credentials" ON public.wp_credentials
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Scope mavis_note_versions INSERT/SELECT to authenticated, add UPDATE policy
DROP POLICY IF EXISTS "Users insert own note versions" ON public.mavis_note_versions;
CREATE POLICY "Users insert own note versions" ON public.mavis_note_versions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_versions.note_id AND n.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users view own note versions" ON public.mavis_note_versions;
CREATE POLICY "Users view own note versions" ON public.mavis_note_versions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_versions.note_id AND n.user_id = auth.uid()));

CREATE POLICY "Users update own note versions" ON public.mavis_note_versions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_versions.note_id AND n.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_versions.note_id AND n.user_id = auth.uid()));
