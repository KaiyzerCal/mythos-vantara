-- Additive only: no data is moved or dropped.
--
-- 1. mavis-attachment-process writes chat_attachments.linked_note_id after it
--    files an attachment's extracted text into the knowledge graph, but the
--    column was never created — so that write has always failed silently and
--    an attachment could never be traced back to its note.
ALTER TABLE public.chat_attachments
  ADD COLUMN IF NOT EXISTS linked_note_id uuid;

-- 2. vault_media predates the grant sweep in 20260627181700 and was created
--    via the dashboard, so it never got explicit privileges. The Gallery reads,
--    updates (rename/description/tags) and deletes these rows from the browser.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_media TO authenticated;
GRANT ALL ON public.vault_media TO service_role;

-- 3. The "Users manage own vault media" policy has USING but no WITH CHECK.
--    Postgres reuses USING for the write check on FOR ALL policies, so this is
--    equivalent — restated explicitly so an INSERT/UPDATE can't be widened by
--    a later edit to only one half of the policy.
DROP POLICY IF EXISTS "Users manage own vault media" ON public.vault_media;
CREATE POLICY "Users manage own vault media"
ON public.vault_media FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
