ALTER TABLE courses ADD COLUMN submitted_at timestamptz DEFAULT now();
UPDATE courses SET submitted_at = created_at;

ALTER TABLE course_approvals RENAME COLUMN admin_id TO reviewed_by;
ALTER TABLE course_approvals RENAME COLUMN reason TO comment;
ALTER TABLE course_approvals RENAME COLUMN created_at TO reviewed_at;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action varchar(100) NOT NULL,
  entity varchar(50) NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity, entity_id);
CREATE INDEX enrollments_course_idx ON enrollments(course_id);

