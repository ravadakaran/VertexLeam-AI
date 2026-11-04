CREATE TABLE modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  order_index integer NOT NULL CHECK (order_index >= 0),
  UNIQUE(course_id, order_index)
);
CREATE TABLE lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  order_index integer NOT NULL CHECK (order_index >= 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
  media_status text NOT NULL CHECK (media_status IN ('ready', 'none')),
  UNIQUE(module_id, order_index)
);
CREATE TABLE lecture_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL,
  resource boolean NOT NULL,
  data bytea NOT NULL,
  UNIQUE(lecture_id, name)
);
CREATE TABLE request_replays (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key varchar(128) NOT NULL,
  digest text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY(user_id, scope, key)
);
CREATE TABLE playback_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE lecture_progress (
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  coverage int4multirange NOT NULL DEFAULT '{}',
  position_seconds integer NOT NULL DEFAULT 0,
  playback_ordinal bigint NOT NULL DEFAULT 0,
  sequence integer NOT NULL DEFAULT -1,
  PRIMARY KEY(enrollment_id, lecture_id)
);
CREATE TABLE playback_events (
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY(enrollment_id, lecture_id, event_id)
);
CREATE TABLE lecture_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('note','bookmark')),
  timestamp_seconds integer NOT NULL CHECK(timestamp_seconds >= 0),
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'note') = (content IS NOT NULL))
);
CREATE INDEX lecture_annotations_owner_idx ON lecture_annotations(user_id, lecture_id, kind, created_at, id);
