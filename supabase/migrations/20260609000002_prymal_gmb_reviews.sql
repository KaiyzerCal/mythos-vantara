-- ============================================================
-- PrymalAI — GMB review tracking table
-- Project: fjkkcrmhptrzobajjsqg
-- ============================================================

-- Tracks each Google Business Profile review seen during a /scan,
-- its response status, and which approval queue item owns the draft.
CREATE TABLE IF NOT EXISTS public.prymal_gmb_reviews (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES public.prymal_clients(id) ON DELETE CASCADE,
  google_review_id  text        NOT NULL,
  review_name       text        NOT NULL,  -- full resource name: "accounts/.../locations/.../reviews/..."
  reviewer_name     text,
  rating            int         CHECK (rating BETWEEN 1 AND 5),
  comment           text,
  review_time       timestamptz,
  response_status   text        DEFAULT 'pending'
                    CHECK (response_status IN ('pending', 'drafted', 'approved', 'published', 'skipped')),
  approval_id       uuid        REFERENCES public.prymal_approval_queue(id),
  published_at      timestamptz,
  created_at        timestamptz DEFAULT now() NOT NULL,
  UNIQUE (client_id, google_review_id)
);

CREATE INDEX IF NOT EXISTS idx_gmb_reviews_client
  ON public.prymal_gmb_reviews (client_id, response_status, review_time DESC);

CREATE INDEX IF NOT EXISTS idx_gmb_reviews_approval
  ON public.prymal_gmb_reviews (approval_id)
  WHERE approval_id IS NOT NULL;
