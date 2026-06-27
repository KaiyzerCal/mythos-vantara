-- ── Event dispatcher webhook triggers ────────────────────────────────────────
-- Sets up pg_net calls to mavis-event-dispatcher when key rows change.
-- Requires pg_net extension (enabled by default in Supabase projects).
-- Replace <PROJECT_REF> with your actual Supabase project reference.

-- Enable pg_net if not already enabled
create extension if not exists pg_net schema extensions;

-- ── Helper: fire webhook on table event ──────────────────────────────────────
-- We use a generic function that accepts the payload and fires the Edge Function.
create or replace function mavis_dispatch_event(payload jsonb)
returns void language plpgsql security definer as $$
declare
  _url text;
  _secret text;
begin
  _url    := current_setting('app.supabase_url', true) || '/functions/v1/mavis-event-dispatcher';
  _secret := current_setting('app.webhook_secret', true);

  perform extensions.http_post(
    url     := _url,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-webhook-secret',  coalesce(_secret, ''),
      'Authorization',     'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := payload::text
  );
exception when others then
  -- Non-fatal — never let the webhook block the DB transaction
  null;
end;
$$;

-- ── Quest completion trigger ──────────────────────────────────────────────────
create or replace function trg_quest_status_changed()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'completed' and (old.status is null or old.status <> 'completed') then
    perform mavis_dispatch_event(jsonb_build_object(
      'type',       'UPDATE',
      'table',      'quests',
      'schema',     'public',
      'record',     to_jsonb(new),
      'old_record', to_jsonb(old)
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quest_completed on quests;
create trigger trg_quest_completed
  after update on quests
  for each row execute function trg_quest_status_changed();

-- ── Journal entry created trigger ─────────────────────────────────────────────
create or replace function trg_journal_created()
returns trigger language plpgsql security definer as $$
begin
  perform mavis_dispatch_event(jsonb_build_object(
    'type',   'INSERT',
    'table',  'journal_entries',
    'schema', 'public',
    'record', to_jsonb(new)
  ));
  return new;
end;
$$;

drop trigger if exists trg_journal_insert on journal_entries;
create trigger trg_journal_insert
  after insert on journal_entries
  for each row execute function trg_journal_created();

-- ── Expense logged trigger ────────────────────────────────────────────────────
create or replace function trg_expense_logged()
returns trigger language plpgsql security definer as $$
begin
  perform mavis_dispatch_event(jsonb_build_object(
    'type',   'INSERT',
    'table',  'mavis_expenses',
    'schema', 'public',
    'record', to_jsonb(new)
  ));
  return new;
end;
$$;

drop trigger if exists trg_expense_insert on mavis_expenses;
create trigger trg_expense_insert
  after insert on mavis_expenses
  for each row execute function trg_expense_logged();

-- ── Task completed trigger ────────────────────────────────────────────────────
create or replace function trg_task_completed()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    perform mavis_dispatch_event(jsonb_build_object(
      'type',       'UPDATE',
      'table',      'tasks',
      'schema',     'public',
      'record',     to_jsonb(new),
      'old_record', to_jsonb(old)
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_done on tasks;
create trigger trg_task_done
  after update on tasks
  for each row execute function trg_task_completed();

-- ── Note ─────────────────────────────────────────────────────────────────────
-- After applying this migration, set these Postgres config params in the
-- Supabase dashboard (Settings → Database → Config):
--   app.supabase_url  = https://<project>.supabase.co
--   app.webhook_secret = <your WEBHOOK_SECRET env var value>
--   app.service_role_key = <your service role key>
