CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  instructions text NOT NULL,
  rubric jsonb NOT NULL,
  due_date timestamptz NOT NULL
);
CREATE INDEX assignments_course_idx ON assignments(course_id, due_date, id);
CREATE TABLE assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  name text NOT NULL,
  mime text NOT NULL,
  data bytea NOT NULL,
  grade numeric(5,2) CHECK (grade BETWEEN 0 AND 100),
  feedback text,
  rubric_scores jsonb,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(assignment_id, user_id)
);
CREATE TABLE quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  is_ai_generated boolean NOT NULL DEFAULT false,
  latest integer NOT NULL DEFAULT 1,
  published integer
);
CREATE INDEX quizzes_module_idx ON quizzes(module_id, id);
CREATE TABLE quiz_revisions (
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  title varchar(200) NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','approved','rejected')),
  questions jsonb NOT NULL,
  PRIMARY KEY(quiz_id, revision)
);
CREATE TABLE quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL,
  quiz_revision integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','pending_review','graded')),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  answers jsonb,
  points jsonb,
  objective_score numeric(5,2) CHECK (objective_score BETWEEN 0 AND 100),
  score numeric(5,2) CHECK (score BETWEEN 0 AND 100),
  revision integer NOT NULL DEFAULT 1,
  FOREIGN KEY(quiz_id, quiz_revision) REFERENCES quiz_revisions(quiz_id, revision) ON DELETE CASCADE
);
CREATE UNIQUE INDEX quiz_attempts_active_idx ON quiz_attempts(quiz_id, user_id) WHERE status='in_progress';
