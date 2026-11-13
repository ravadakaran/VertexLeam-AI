CREATE TABLE IF NOT EXISTS learner_targeted_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('course','module','lecture')),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE,
  lecture_id uuid REFERENCES lectures(id) ON DELETE CASCADE,
  title text NOT NULL,
  score numeric(6,5) NOT NULL,
  reason text NOT NULL,
  input_signal text NOT NULL CHECK (input_signal IN ('quiz_scores','topic_mastery','assignments','enrollment_history','ai_tutor_questions')),
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learner_targeted_recs_user_idx ON learner_targeted_recommendations(user_id, target_type, score DESC);

