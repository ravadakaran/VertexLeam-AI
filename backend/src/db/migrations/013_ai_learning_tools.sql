ALTER TABLE ai_chunks ADD COLUMN source_asset_id uuid REFERENCES lecture_assets(id) ON DELETE CASCADE;
ALTER TABLE ai_chunks ADD COLUMN source_name text;
CREATE INDEX ai_chunks_source_asset_idx ON ai_chunks(source_asset_id) WHERE source_asset_id IS NOT NULL;

CREATE TABLE ai_provider_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  feature text NOT NULL CHECK (feature IN ('chat','embed','summary','flashcards','quiz_draft','study_plan')),
  provider text NOT NULL CHECK (provider IN ('openai','anthropic')),
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_provider_usage_actor_idx ON ai_provider_usage(actor_id,recorded_at DESC);
CREATE INDEX ai_provider_usage_course_idx ON ai_provider_usage(course_id,recorded_at DESC);

CREATE TABLE learner_flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  card_hash text NOT NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 1000),
  answer text NOT NULL CHECK (length(answer) BETWEEN 1 AND 2000),
  source_chunks uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  next_review_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,module_id,card_hash)
);
CREATE INDEX learner_flashcards_due_idx ON learner_flashcards(user_id,next_review_at,id);

CREATE TABLE learner_study_plans (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  plan jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,course_id)
);
