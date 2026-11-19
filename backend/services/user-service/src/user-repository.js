import { neon } from '@neondatabase/serverless';
function database() { if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.'); return neon(process.env.DATABASE_URL); }
export async function createProfile({ userId, fullName, institutionalCode, profileType }) {
  const sql = database();
  const rows = await sql`
    INSERT INTO directory.profiles (user_id, full_name, institutional_code, profile_type)
    VALUES (${userId}, ${fullName}, ${institutionalCode}, ${profileType})
    RETURNING user_id, full_name, institutional_code, profile_type, active, created_at
  `;
  return rows[0];
}
export async function listProfiles() {
  const sql = database();
  return sql`SELECT user_id, full_name, institutional_code, profile_type, active, created_at FROM directory.profiles ORDER BY full_name`;
}
export async function findProfile(userId) {
  const sql = database();
  const rows = await sql`SELECT user_id, full_name, institutional_code, profile_type, active, created_at FROM directory.profiles WHERE user_id = ${userId} LIMIT 1`;
  return rows[0] || null;
}
export async function setProfileActive(userId, active) {
  const sql = database();
  const rows = await sql`UPDATE directory.profiles SET active = ${active}, updated_at = now() WHERE user_id = ${userId} RETURNING user_id, active`;
  return rows[0] || null;
}