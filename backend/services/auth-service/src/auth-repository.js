import { neon } from '@neondatabase/serverless';

const db = () => {
  const url = process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('AUTH_DATABASE_URL is required.');
  return neon(url);
};

export async function findActiveUserByEmail(email) {
  const sql = db();
  const rows = await sql`
    SELECT id, institutional_email, password_hash, role, active
    FROM auth.users
    WHERE lower(institutional_email) = lower(${email}) AND active = true
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function createRefreshSession({ userId, tokenHash, expiresAt }) {
  const sql = db();
  const rows = await sql`
    INSERT INTO auth.refresh_sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
    RETURNING id
  `;
  return rows[0].id;
}

export async function findValidRefreshSession(tokenHash) {
  const sql = db();
  const rows = await sql`
    SELECT s.id AS session_id, u.id AS user_id, u.institutional_email, u.role
    FROM auth.refresh_sessions s
    JOIN auth.users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active = true
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function findActiveSession(sessionId, userId) {
  const sql = db();
  const rows = await sql`
    SELECT u.id, u.institutional_email, u.role
    FROM auth.refresh_sessions s
    JOIN auth.users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active = true
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function revokeRefreshSession(tokenHash) {
  const sql = db();
  const rows = await sql`
    UPDATE auth.refresh_sessions
    SET revoked_at = now()
    WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function createUserAccount({ email, passwordHash, role, idempotencyKey }) {
  const sql = db();
  const rows = await sql`
    INSERT INTO auth.users (institutional_email, password_hash, role, idempotency_key)
    VALUES (${email.toLowerCase()}, ${passwordHash}, ${role}, ${idempotencyKey || null})
    ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
    RETURNING id, institutional_email, role, active
  `;
  return rows[0];
}

export async function findUserByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  const sql = db();
  const rows = await sql`
    SELECT id, institutional_email, role, active
    FROM auth.users
    WHERE idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function institutionalEmailExists(email) {
  const sql = db();
  const rows = await sql`
    SELECT 1 FROM auth.users
    WHERE lower(institutional_email) = lower(${email})
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function updateUserPassword({ email, newPasswordHash }) {
  const sql = db();
  const rows = await sql`
    UPDATE auth.users
    SET password_hash = ${newPasswordHash}, updated_at = now()
    WHERE lower(institutional_email) = lower(${email}) AND active = true
    RETURNING id, institutional_email, role
  `;
  if (rows.length) {
    await sql`
      UPDATE auth.refresh_sessions
      SET revoked_at = now()
      WHERE user_id = ${rows[0].id} AND revoked_at IS NULL
    `;
  }
  return rows[0] || null;
}

export async function listUserAccounts() {
  const sql = db();
  return sql`SELECT id, institutional_email, role, active, created_at FROM auth.users ORDER BY institutional_email`;
}

export async function findUserAccount(id) {
  const sql = db();
  const rows = await sql`SELECT id, institutional_email, role, active, created_at FROM auth.users WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

export async function setUserAccountActive(id, active) {
  const sql = db();
  const rows = await sql`UPDATE auth.users SET active = ${active}, updated_at = now() WHERE id = ${id} RETURNING id`;
  if (!active && rows.length) {
    await sql`UPDATE auth.refresh_sessions SET revoked_at = now() WHERE user_id = ${id} AND revoked_at IS NULL`;
  }
  return rows.length > 0;
}
