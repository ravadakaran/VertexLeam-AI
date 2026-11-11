CREATE TABLE cache_generations (
  scope text PRIMARY KEY,
  generation bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cache_generations(scope, generation) VALUES ('catalog', 1) ON CONFLICT DO NOTHING;

CREATE TABLE discussion_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  title varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discussion_threads_course_idx ON discussion_threads(course_id, created_at DESC, id);

CREATE TABLE discussion_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
  parent_id uuid,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  content text NOT NULL,
  visibility text NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
  is_flagged boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, thread_id),
  FOREIGN KEY (parent_id, thread_id) REFERENCES discussion_posts(id, thread_id) ON DELETE CASCADE
);
CREATE INDEX discussion_posts_thread_idx ON discussion_posts(thread_id, created_at, id);
CREATE INDEX discussion_posts_flagged_idx ON discussion_posts(is_flagged, created_at DESC, id) WHERE is_flagged = true;

CREATE TABLE post_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES discussion_posts(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  moderation_report_id uuid REFERENCES moderation_reports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX post_reports_active_reporter_idx
  ON post_reports(post_id, reporter_id)
  WHERE status = 'pending' AND reporter_id IS NOT NULL;
CREATE INDEX post_reports_post_status_idx ON post_reports(post_id, status, created_at, id);

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_course_idx ON announcements(course_id, created_at DESC, id);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('course.announcement', 'discussion.reply')),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  dispatched_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx
  ON outbox(status, next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'dispatched');

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email')),
  title varchar(150) NOT NULL,
  body text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'failed')),
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, channel)
);
CREATE INDEX notifications_user_in_app_idx
  ON notifications(user_id, created_at DESC, id)
  WHERE channel = 'in_app';

