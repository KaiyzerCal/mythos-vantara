
-- 1) mavis-products storage hardening
DROP POLICY IF EXISTS "mavis-products authenticated insert" ON storage.objects;

CREATE POLICY "mavis-products owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mavis-products'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "mavis-products owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'mavis-products'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'mavis-products'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "mavis-products owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'mavis-products'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2) Pin search_path on our trigger function
ALTER FUNCTION public.update_mavis_products_updated_at() SET search_path = public;

-- 3) Lock down SECURITY DEFINER functions that are not meant to be RPC-callable
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_workspaces() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_mavis_notes(vector, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;
