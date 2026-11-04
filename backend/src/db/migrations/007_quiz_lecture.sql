ALTER TABLE quizzes ADD COLUMN lecture_id uuid REFERENCES lectures(id) ON DELETE SET NULL;
