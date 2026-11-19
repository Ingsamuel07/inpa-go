ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS users_idempotency_key_unique
  ON auth.users (idempotency_key);

ALTER TABLE attendance.sessions
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_idempotency_key_unique
  ON attendance.sessions (idempotency_key);

ALTER TABLE academic.courses
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS courses_idempotency_key_unique
  ON academic.courses (idempotency_key);

ALTER TABLE academic.groups
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS groups_idempotency_key_unique
  ON academic.groups (idempotency_key);

ALTER TABLE academic.teacher_assignments
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS teacher_assignments_idempotency_key_unique
  ON academic.teacher_assignments (idempotency_key);

ALTER TABLE academic.enrollments
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_idempotency_key_unique
  ON academic.enrollments (idempotency_key);

ALTER TABLE imports.batches
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS import_batches_idempotency_key_unique
  ON imports.batches (idempotency_key);
