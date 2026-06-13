-- Persistent terminal sessions for mavis-terminal.
-- Each row represents a live E2B sandbox the user can run commands in.
-- State (cwd) persists between commands within the same session.

CREATE TABLE IF NOT EXISTS public.mavis_terminal_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sandbox_id   text NOT NULL,
  label        text NOT NULL DEFAULT 'Terminal',
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dead')),
  cwd          text NOT NULL DEFAULT '/home/user',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mavis_terminal_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own terminal sessions"
  ON public.mavis_terminal_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "service role manages terminal sessions"
  ON public.mavis_terminal_sessions FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user
  ON public.mavis_terminal_sessions(user_id, status, last_used_at DESC);
