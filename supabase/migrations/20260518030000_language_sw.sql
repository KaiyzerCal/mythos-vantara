-- Language preference
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='language') THEN
    ALTER TABLE profiles ADD COLUMN language TEXT DEFAULT 'en';
  END IF;
END $$;
