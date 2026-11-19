import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.NEON_MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error('NEON_MIGRATION_DATABASE_URL is required for migrations.');
const migrationFile = new URL('../infrastructure/neon/migrations/0001_initial.sql', import.meta.url);
const migrationSql = await readFile(migrationFile, 'utf8');
const idempotencyMigrationFile = new URL('../infrastructure/neon/migrations/0002_offline_idempotency.sql', import.meta.url);
const idempotencyMigrationSql = await readFile(idempotencyMigrationFile, 'utf8');
const pool = new Pool({ connectionString, enableChannelBinding: true });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(831047221)');
  await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = await client.query('SELECT version FROM public.schema_migrations WHERE version = $1', ['0001_initial']);
  if (applied.rowCount === 0) {
    await client.query(migrationSql);
    await client.query('INSERT INTO public.schema_migrations(version) VALUES ($1)', ['0001_initial']);
    console.log('Applied migration 0001_initial.');
  } else {
    console.log('Migration 0001_initial already applied.');
  }
  const idempotencyApplied = await client.query('SELECT version FROM public.schema_migrations WHERE version = $1', ['0002_offline_idempotency']);
  if (idempotencyApplied.rowCount === 0) {
    await client.query(idempotencyMigrationSql);
    await client.query('INSERT INTO public.schema_migrations(version) VALUES ($1)', ['0002_offline_idempotency']);
    console.log('Applied migration 0002_offline_idempotency.');
  } else {
    console.log('Migration 0002_offline_idempotency already applied.');
  }
  await client.query('COMMIT');
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('Neon migration failed:', error.code || 'DATABASE_ERROR');
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}