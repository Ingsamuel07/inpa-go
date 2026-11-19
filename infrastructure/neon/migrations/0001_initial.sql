-- Initial ownership-separated PostgreSQL schemas for Inpa_Go.
-- Review the target database before applying; this migration creates structures only.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS directory;
CREATE SCHEMA IF NOT EXISTS academic;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS location;
CREATE SCHEMA IF NOT EXISTS imports;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institutional_email varchar(254) NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (institutional_email)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON auth.users (lower(institutional_email));
CREATE INDEX IF NOT EXISTS users_role_active_idx ON auth.users (role, active);
CREATE TABLE IF NOT EXISTS auth.refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_sessions_user_active_idx ON auth.refresh_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

-- Profiles own personal/display data; user_id references an Auth account by API contract, not cross-service FK.
CREATE TABLE IF NOT EXISTS directory.profiles (
  user_id uuid PRIMARY KEY,
  full_name varchar(180) NOT NULL,
  institutional_code varchar(50) NOT NULL UNIQUE,
  profile_type text NOT NULL CHECK (profile_type IN ('teacher', 'student', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profiles_type_active_idx ON directory.profiles (profile_type, active);

CREATE TABLE IF NOT EXISTS academic.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(40) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academic.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES academic.courses(id),
  code varchar(40) NOT NULL,
  term varchar(40) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (course_id, code, term)
);
CREATE TABLE IF NOT EXISTS academic.teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES academic.groups(id),
  UNIQUE (teacher_user_id, group_id)
);
CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_idx ON academic.teacher_assignments (teacher_user_id, group_id);
CREATE TABLE IF NOT EXISTS academic.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_user_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES academic.groups(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'completed')),
  UNIQUE (student_user_id, group_id)
);
CREATE INDEX IF NOT EXISTS enrollments_student_idx ON academic.enrollments (student_user_id, status);
CREATE INDEX IF NOT EXISTS enrollments_group_idx ON academic.enrollments (group_id, status);

CREATE TABLE IF NOT EXISTS attendance.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  teacher_user_id uuid NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS attendance_sessions_group_date_idx ON attendance.sessions (group_id, starts_at DESC);
CREATE TABLE IF NOT EXISTS attendance.records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES attendance.sessions(id),
  student_user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (session_id, student_user_id)
);
CREATE INDEX IF NOT EXISTS attendance_records_student_idx ON attendance.records (student_user_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS location.geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_meters integer NOT NULL CHECK (radius_meters BETWEEN 1 AND 10000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed campus principal y sedes oficiales UNINPAHU (Bogotá, Colombia)
INSERT INTO location.geofences (name, latitude, longitude, radius_meters, active)
VALUES 
  ('UNINPAHU - Sede Principal (Cl. 44 # 16-40, Teusaquillo)', 4.628889, -74.065833, 300, true),
  ('UNINPAHU - Sede Académica 2 (Cra. 16 # 43-20)', 4.630500, -74.067200, 250, true)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS location.validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  geofence_id uuid REFERENCES location.geofences(id),
  distance_meters integer NOT NULL CHECK (distance_meters >= 0),
  within_radius boolean NOT NULL,
  accuracy_meters integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_validations_student_date_idx ON location.validations (student_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS imports.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  file_name varchar(255) NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'completed_with_errors', 'failed')),
  total_rows integer NOT NULL DEFAULT 0,
  accepted_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS imports.errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES imports.batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  field_name varchar(100),
  error_code varchar(80) NOT NULL,
  message text NOT NULL
);
CREATE INDEX IF NOT EXISTS import_errors_batch_row_idx ON imports.errors (batch_id, row_number);
-- User Service owns profile data. Auth keeps account credentials and roles.
CREATE SCHEMA IF NOT EXISTS directory;
CREATE TABLE IF NOT EXISTS directory.profiles (
  user_id uuid PRIMARY KEY,
  full_name varchar(180) NOT NULL,
  institutional_code varchar(50) NOT NULL UNIQUE,
  profile_type text NOT NULL CHECK (profile_type IN ('teacher', 'student', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profiles_type_active_idx ON directory.profiles (profile_type, active);

-- Separate NOLOGIN privilege groups. Create matching Neon LOGIN roles and grant membership.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inpago_auth_app') THEN EXECUTE 'CREATE ROLE inpago_auth_app NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inpago_user_app') THEN EXECUTE 'CREATE ROLE inpago_user_app NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inpago_academic_app') THEN EXECUTE 'CREATE ROLE inpago_academic_app NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inpago_attendance_app') THEN EXECUTE 'CREATE ROLE inpago_attendance_app NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inpago_location_app') THEN EXECUTE 'CREATE ROLE inpago_location_app NOLOGIN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inpago_import_app') THEN EXECUTE 'CREATE ROLE inpago_import_app NOLOGIN'; END IF;
END $$;
REVOKE ALL ON SCHEMA auth, directory, academic, attendance, location, imports FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, directory, academic, attendance, location, imports FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO inpago_auth_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA auth TO inpago_auth_app;
GRANT USAGE ON SCHEMA directory TO inpago_user_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA directory TO inpago_user_app;
GRANT USAGE ON SCHEMA academic TO inpago_academic_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA academic TO inpago_academic_app;
GRANT USAGE ON SCHEMA attendance TO inpago_attendance_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA attendance TO inpago_attendance_app;
GRANT USAGE ON SCHEMA location TO inpago_location_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA location TO inpago_location_app;
GRANT USAGE ON SCHEMA imports TO inpago_import_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA imports TO inpago_import_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE ON TABLES TO inpago_auth_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA directory GRANT SELECT, INSERT, UPDATE ON TABLES TO inpago_user_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA academic GRANT SELECT, INSERT, UPDATE ON TABLES TO inpago_academic_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA attendance GRANT SELECT, INSERT, UPDATE ON TABLES TO inpago_attendance_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA location GRANT SELECT, INSERT, UPDATE ON TABLES TO inpago_location_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA imports GRANT SELECT, INSERT, UPDATE ON TABLES TO inpago_import_app;
