CREATE TABLE learning_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '',
  UNIQUE(course_id, name)
);

CREATE TABLE mastery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
  evidence_id text NOT NULL,
  score numeric(5,4) NOT NULL CHECK(score BETWEEN 0 AND 1),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, topic_id, evidence_id)
);
CREATE INDEX mastery_events_replay_idx ON mastery_events(user_id, topic_id, accepted_at, id);

CREATE TABLE learner_mastery (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
  score numeric(5,4) NOT NULL DEFAULT 0.5000 CHECK(score BETWEEN 0 AND 1),
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK(confidence BETWEEN 0 AND 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, topic_id)
);

CREATE TABLE learner_recommendations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  score numeric(6,5) NOT NULL,
  reason text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, course_id)
);

CREATE TABLE synthetic_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK(amount >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK(status IN ('succeeded','refunded','failed')),
  provenance text NOT NULL DEFAULT 'synthetic fixture',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moderation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text NOT NULL CHECK(entity_type IN ('course','user','content')),
  entity_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','actioned','dismissed')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_reports_queue_idx ON moderation_reports(status, created_at, id);
