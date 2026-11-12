ALTER TABLE mastery_events
  ADD COLUMN evidence_kind text NOT NULL DEFAULT 'quiz'
  CHECK (evidence_kind IN ('quiz', 'tutor_self_assessment'));

CREATE INDEX learner_mastery_updated_idx ON learner_mastery(user_id, updated_at DESC);
