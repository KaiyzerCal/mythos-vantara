-- ═══════════════════════════════════════════════════════════
-- STORAGE POLICIES — mavis-products bucket
-- Explicit public read so PDF delivery URLs always work,
-- even if Supabase tightens default storage RLS in future.
-- Write is restricted to service role (edge functions only).
-- ═══════════════════════════════════════════════════════════

-- Public read: anyone with the URL can download the PDF
create policy "mavis-products public read"
  on storage.objects for select
  using (bucket_id = 'mavis-products');

-- Authenticated insert (edge functions use service role, which bypasses RLS,
-- but this policy covers any authenticated upload path as well)
create policy "mavis-products authenticated insert"
  on storage.objects for insert
  with check (bucket_id = 'mavis-products' and auth.role() = 'authenticated');
