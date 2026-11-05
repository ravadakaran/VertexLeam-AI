ALTER TABLE quiz_attempts ADD COLUMN graded_at timestamptz;
ALTER TABLE playback_events ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX playback_events_created_idx ON playback_events(created_at);

CREATE TABLE learner_activity (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, activity_date)
);
CREATE TABLE learner_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key text NOT NULL CHECK (badge_key IN ('first_course','seven_day_streak','perfect_quiz')),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,badge_key)
);
CREATE TABLE learner_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  pdf bytea NOT NULL,
  UNIQUE(user_id,course_id)
);
CREATE TABLE ai_source_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  status text NOT NULL CHECK(status IN ('processing','active','failed','superseded')),
  source_hash text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lecture_id,generation)
);
CREATE UNIQUE INDEX ai_one_active_source ON ai_source_generations(lecture_id) WHERE status='active';
CREATE TABLE ai_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES ai_source_generations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  content text NOT NULL,
  start_seconds integer,
  end_seconds integer,
  page_number integer,
  embedding vector(1536),
  UNIQUE(generation_id,ordinal)
);
CREATE INDEX ai_chunks_scope_idx ON ai_chunks(course_id,lecture_id,generation_id);
CREATE TABLE ai_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'intermediate' CHECK(mode IN ('beginner','intermediate','advanced')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('user','assistant')),
  content text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,request_id,role)
);
