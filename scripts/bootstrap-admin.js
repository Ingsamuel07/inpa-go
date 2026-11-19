import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const required = ['NEON_MIGRATION_DATABASE_URL', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'BOOTSTRAP_ADMIN_CODE', 'BOOTSTRAP_ADMIN_NAME'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment variable names: ${missing.join(', ')}`);
if (process.env.BOOTSTRAP_ADMIN_PASSWORD.length < 12) throw new Error('Bootstrap password must have at least 12 characters.');
const pool = new Pool({
  connectionString: process.env.NEON_MIGRATION_DATABASE_URL,
  enableChannelBinding: true,
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const hash = await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD, 12);
  const account = await client.query(
    'INSERT INTO auth.users (institutional_email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
    [process.env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase(), hash, 'admin'],
  );
  await client.query(
    'INSERT INTO directory.profiles (user_id, full_name, institutional_code, profile_type) VALUES ($1, $2, $3, $4)',
    [account.rows[0].id, process.env.BOOTSTRAP_ADMIN_NAME.trim(), process.env.BOOTSTRAP_ADMIN_CODE.trim(), 'admin'],
  );
  await client.query('COMMIT');
  console.log('Initial administrator created. Password value was not logged.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Administrator bootstrap failed:', error.code || 'DATABASE_ERROR');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}