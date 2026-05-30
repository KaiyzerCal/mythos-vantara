-- Make bucket private
UPDATE storage.buckets SET public = false WHERE id = 'vault-media';

-- Remove the anonymous SELECT policy that exposes all files
DROP POLICY IF EXISTS "Anyone can read vault media" ON storage.objects;
DROP POLICY IF EXISTS "Public read vault media" ON storage.objects;

-- Ensure owner-scoped authenticated policies exist
-- SELECT for authenticated owners
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users read own vault media' AND tablename = 'objects' AND schemaname = 'storage'
  ) THEN
    EXECUTE 'CREATE POLICY "Authenticated users read own vault media" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''vault-media'' AND (storage.foldername(name))[1] = auth.uid()::text)';
  END IF;
END $$;