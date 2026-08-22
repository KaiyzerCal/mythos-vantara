-- Additive only: no data is moved or dropped.
-- Verified against the live Lovable-managed database on 2026-08-22.
--
-- 1. REQUIRED. mavis-attachment-process writes chat_attachments.linked_note_id
--    after filing an attachment's extracted text into the knowledge graph, but
--    the column does not exist on the live database (confirmed: 0 rows in
--    information_schema.columns). That write has always failed silently, so an
--    attachment can never be traced back to its note.
ALTER TABLE public.chat_attachments
  ADD COLUMN IF NOT EXISTS linked_note_id uuid;

-- 2. NO-OP on the current database — authenticated already holds SELECT and
--    UPDATE on vault_media (verified via has_table_privilege). Kept as a
--    belt-and-braces idempotent restatement so a rebuilt environment does not
--    silently lose the Gallery's read/rename/delete access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_media TO authenticated;
GRANT ALL ON public.vault_media TO service_role;

-- 3. Cosmetic. The live "Users manage own vault media" policy has USING but no
--    WITH CHECK. Postgres reuses USING as the write check on FOR ALL policies,
--    so behaviour is unchanged — restated explicitly so a later edit to one
--    half of the policy cannot silently widen writes.
DROP POLICY IF EXISTS "Users manage own vault media" ON public.vault_media;
CREATE POLICY "Users manage own vault media"
ON public.vault_media FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
