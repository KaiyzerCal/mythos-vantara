create or replace function public.__vault_secret_fingerprint(p_name text)
returns table(len int, fp text)
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
begin
  return query
  select length(s.decrypted_secret)::int,
         left(encode(extensions.digest(s.decrypted_secret,'sha256'),'hex'),16)
  from vault.decrypted_secrets s where s.name = p_name;
end;
$$;
revoke all on function public.__vault_secret_fingerprint(text) from public, anon, authenticated;
grant execute on function public.__vault_secret_fingerprint(text) to service_role;

create or replace function public.__vault_secret_write(p_name text, p_value text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'cron helper');
  else
    perform vault.update_secret(v_id, p_value, p_name, 'cron helper');
  end if;
  return 'ok';
end;
$$;
revoke all on function public.__vault_secret_write(text,text) from public, anon, authenticated;
grant execute on function public.__vault_secret_write(text,text) to service_role;