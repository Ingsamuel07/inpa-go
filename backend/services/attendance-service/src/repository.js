import { neon } from '@neondatabase/serverless';

const db = () => {
  const url = process.env.ATTENDANCE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('ATTENDANCE_DATABASE_URL is required.');
  return neon(url);
};

export async function createSession({ groupId, teacherId, startsAt, idempotencyKey }) {
  const sql = db();
  const rows = await sql`
    INSERT INTO attendance.sessions (group_id, teacher_user_id, starts_at, status, idempotency_key)
    VALUES (${groupId}, ${teacherId}, COALESCE(${startsAt}::timestamptz, now()), 'open', ${idempotencyKey || null})
    ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
    RETURNING id, group_id, teacher_user_id, starts_at, ends_at, status
  `;
  return rows[0];
}

export async function findSession(id) {
  const sql = db();
  const rows = await sql`
    SELECT id, group_id, teacher_user_id, starts_at, ends_at, status
    FROM attendance.sessions
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function closeSession({ id, teacherId, admin }) {
  const sql = db();
  const rows = await sql`
    UPDATE attendance.sessions
    SET status = 'closed', ends_at = now()
    WHERE id = ${id} AND status IN ('open', 'paused') AND (${admin} OR teacher_user_id = ${teacherId})
    RETURNING id, group_id, teacher_user_id, starts_at, ends_at, status
  `;
  return rows[0] || null;
}

export async function pauseSession({ id, teacherId, admin }) {
  const sql = db();
  const rows = await sql`
    UPDATE attendance.sessions
    SET status = 'paused'
    WHERE id = ${id} AND status = 'open' AND (${admin} OR teacher_user_id = ${teacherId})
    RETURNING id, group_id, teacher_user_id, starts_at, ends_at, status
  `;
  return rows[0] || null;
}

export async function resumeSession({ id, teacherId, admin }) {
  const sql = db();
  const rows = await sql`
    UPDATE attendance.sessions
    SET status = 'open'
    WHERE id = ${id} AND status = 'paused' AND (${admin} OR teacher_user_id = ${teacherId})
    RETURNING id, group_id, teacher_user_id, starts_at, ends_at, status
  `;
  return rows[0] || null;
}

export async function sessionsForGroup(id) {
  const sql = db();
  return sql`
    SELECT id, group_id, teacher_user_id, starts_at, ends_at, status
    FROM attendance.sessions
    WHERE group_id = ${id}
    ORDER BY starts_at DESC
    LIMIT 100
  `;
}

export async function recordsForSession(id, studentId = null) {
  const sql = db();
  return sql`
    SELECT id, session_id, student_user_id, status, confirmed_by, confirmed_at, evidence
    FROM attendance.records
    WHERE session_id = ${id} AND (${studentId}::uuid IS NULL OR student_user_id = ${studentId})
    ORDER BY confirmed_at ASC
  `;
}

export async function studentHistory(id) {
  const sql = db();
  return sql`
    SELECT r.id, r.session_id, s.group_id, r.status, r.confirmed_at, r.evidence, s.starts_at, s.ends_at
    FROM attendance.records r
    JOIN attendance.sessions s ON s.id = r.session_id
    WHERE r.student_user_id = ${id}
    ORDER BY s.starts_at DESC
    LIMIT 200
  `;
}

export async function confirmRecord({ sessionId, studentId, teacherId, status, evidence = {} }) {
  const sql = db();
  const rows = await sql`
    INSERT INTO attendance.records (session_id, student_user_id, status, confirmed_by, evidence)
    SELECT s.id, ${studentId}, ${status}, ${teacherId}, ${JSON.stringify(evidence)}::jsonb
    FROM attendance.sessions s
    WHERE s.id = ${sessionId} AND s.status = 'open'
    ON CONFLICT (session_id, student_user_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      confirmed_by = EXCLUDED.confirmed_by,
      evidence = EXCLUDED.evidence,
      confirmed_at = now()
    RETURNING id, session_id, student_user_id, status, confirmed_by, confirmed_at, evidence
  `;
  return rows[0] || null;
}
