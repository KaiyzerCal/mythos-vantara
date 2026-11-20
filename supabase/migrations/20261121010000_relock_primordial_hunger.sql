-- Applied live 2026-11-21. Primordial_Hunger had Gourmet (Seq.7) and Ouroboros (Seq.1) unlocked while Glutton (Seq.8) was
-- locked, which made the Sefirot tree report Ouroboros as the current sequence. Relocked; their progress (35%, 64%) is kept
-- as banked head-start. To undo: set unlocked = true for these two ids.
SET lock_timeout = '3s';
UPDATE public.skills SET unlocked = false, updated_at = now()
WHERE id IN ('ffe0e5c1-9bc2-42d1-8b60-57cf49b77f89','9f2eec3c-07ff-4a29-9e53-8d5ace2362da')
  AND user_id = '7db54d1c-f2fb-4f73-8494-cb5a6b5720ca';
