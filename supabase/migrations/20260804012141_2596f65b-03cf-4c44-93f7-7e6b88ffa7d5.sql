CREATE OR REPLACE FUNCTION public.__store_cron_vault_secret(p_name text, p_value text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;
  IF v_id IS NULL THEN
    SELECT vault.create_secret(p_value, p_name, 'used by pg_cron http calls') INTO v_id;
  ELSE
    PERFORM vault.update_secret(v_id, p_value, p_name, 'used by pg_cron http calls');
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.__store_cron_vault_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__store_cron_vault_secret(text, text) TO service_role;