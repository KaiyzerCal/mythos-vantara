-- Browser Web Push (VAPID) — the service worker (public/sw.js) already has a
-- fully-built "push" + "notificationclick" handler expecting {title, body,
-- url}, but nothing ever subscribed via PushManager to feed it: existing
-- push infrastructure (device_push_tokens/mavis-push-notify) is native-only
-- (Capacitor.isNativePlatform() gates registration), so browser/PWA users
-- never got push at all. This is the missing subscribe side for them.
CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users manage own web push subscription" ON public.web_push_subscriptions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-operator on/off switch for Composio real-world tool access, mirroring
-- the same toggle added to NAVI — a configured COMPOSIO_API_KEY shouldn't
-- mean every operator's agent silently gets real-world account access.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS composio_enabled boolean NOT NULL DEFAULT false;
