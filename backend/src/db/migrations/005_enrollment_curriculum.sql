CREATE TABLE enrollment_curriculum (
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lecture_id uuid NOT NULL REFERENCES lectures(id),
  PRIMARY KEY(enrollment_id, lecture_id)
);
