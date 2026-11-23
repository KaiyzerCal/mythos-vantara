-- Light decay for idle Beyonder LIMB sequences (never the Black Sun trunk).
-- A limb sequence untouched for 21 days loses 1 point per day, down to half of the highest proficiency it ever reached.
-- Training it again resets the idle clock. Re-runnable; every statement is guarded.
SET lock_timeout = '3s';
SET statement_timeout = '60s';

ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS last_trained_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS peak_proficiency integer NOT NULL DEFAULT 0;

-- Backfill the peak once; decay never lowers it afterwards.
UPDATE public.skills SET peak_proficiency = proficiency WHERE peak_proficiency < proficiency;

-- Tracking lives in a trigger so no code path (quests, convergence, manual edits) can forget it.
CREATE OR REPLACE FUNCTION public.skills_track_training() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.proficiency IS DISTINCT FROM OLD.proficiency THEN
    IF NEW.proficiency > OLD.proficiency THEN NEW.last_trained_at := now(); END IF;
    IF NEW.proficiency > NEW.peak_proficiency THEN NEW.peak_proficiency := NEW.proficiency; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS skills_track_training ON public.skills;
CREATE TRIGGER skills_track_training BEFORE UPDATE OF proficiency ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.skills_track_training();

-- Limb sequences only: Beyonder sequences (children of a root) whose root is not the sovereign trunk.
CREATE OR REPLACE FUNCTION public.decay_idle_limbs() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  WITH decayed AS (
    UPDATE public.skills s
       SET proficiency = GREATEST(s.proficiency - 1, s.peak_proficiency / 2)
      FROM public.skills r
     WHERE s.parent_skill_id = r.id
       AND r.parent_skill_id IS NULL
       AND COALESCE(r.is_sovereign_trunk, false) = false
       AND s.category = 'Beyonder'
       AND s.energy_type ~ '^Sequence [0-9]$'
       AND s.last_trained_at < now() - interval '21 days'
       AND s.proficiency > s.peak_proficiency / 2
    RETURNING 1)
  SELECT count(*) INTO n FROM decayed;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'decay-idle-limbs') THEN
    PERFORM cron.unschedule('decay-idle-limbs');
  END IF;
  PERFORM cron.schedule('decay-idle-limbs', '17 4 * * *', 'SELECT public.decay_idle_limbs()');
END $$;
