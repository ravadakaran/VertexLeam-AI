ALTER TABLE lecture_progress
  ADD COLUMN IF NOT EXISTS rewatch_count integer NOT NULL DEFAULT 0 CHECK (rewatch_count >= 0),
  ADD COLUMN IF NOT EXISTS last_watched_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS lecture_progress_last_watched_idx ON lecture_progress(enrollment_id, last_watched_at DESC);

