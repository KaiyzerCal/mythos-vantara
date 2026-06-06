-- Tighten agent_telegram_config policy to authenticated only
DROP POLICY IF EXISTS "users own telegram config" ON public.agent_telegram_config;
CREATE POLICY "Users manage own telegram config"
ON public.agent_telegram_config
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add UPDATE policy for mavis_note_links
CREATE POLICY "Users update own note links"
ON public.mavis_note_links
FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_links.source_note_id AND n.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_links.source_note_id AND n.user_id = auth.uid()));

-- Add DELETE policy for mavis_note_versions
CREATE POLICY "Users delete own note versions"
ON public.mavis_note_versions
FOR DELETE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.mavis_notes n WHERE n.id = mavis_note_versions.note_id AND n.user_id = auth.uid()));