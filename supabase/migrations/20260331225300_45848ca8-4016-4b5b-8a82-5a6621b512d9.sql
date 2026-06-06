CREATE POLICY "Authenticated users update own vault media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'vault-media' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'vault-media' AND (storage.foldername(name))[1] = auth.uid()::text);