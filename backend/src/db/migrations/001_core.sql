CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(150) NOT NULL,
  email varchar(180) UNIQUE NOT NULL CHECK (email = lower(email)),
  password_hash varchar(255) NOT NULL,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE roles (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(20) UNIQUE NOT NULL CHECK (name IN ('student', 'instructor', 'admin'))
);
INSERT INTO roles(name) VALUES ('student'), ('instructor'), ('admin');
CREATE TABLE user_roles (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role_id integer REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_revision integer NOT NULL,
  refresh_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES users(id),
  title varchar(200) NOT NULL,
  description text,
  category varchar(80) NOT NULL,
  difficulty varchar(20) NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  thumbnail_url text,
  price numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  pricing_tier text NOT NULL DEFAULT 'free',
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
  rating numeric(3,2) CHECK (rating BETWEEN 0 AND 5),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courses_catalog_idx ON courses(status, created_at, id);
CREATE TABLE course_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  admin_id uuid NOT NULL REFERENCES users(id),
  decision varchar(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  UNIQUE (user_id, course_id)
);

