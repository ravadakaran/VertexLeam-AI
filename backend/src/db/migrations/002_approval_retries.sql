ALTER TABLE course_approvals
  ADD COLUMN idempotency_key varchar(128),
  ADD COLUMN request_revision text,
  ADD COLUMN response jsonb,
  ADD UNIQUE (admin_id, course_id, idempotency_key);

