import { neon } from '@neondatabase/serverless';

function db() {
  const url = process.env.IMPORT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('IMPORT_DATABASE_URL is required.');
  return neon(url);
}

export async function createBatch({ createdBy, fileName, totalRows = 0, idempotencyKey }) {
  const sql = db();
  const rows = await sql`
    INSERT INTO imports.batches (created_by, file_name, status, total_rows, idempotency_key)
    VALUES (${createdBy}, ${fileName}, 'processing', ${totalRows}, ${idempotencyKey || null})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, created_by, file_name, status, total_rows, accepted_rows, rejected_rows, created_at
  `;
  return rows[0] || null;
}

export async function findBatchByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  const sql = db();
  const rows = await sql`
    SELECT id, created_by, file_name, status, total_rows, accepted_rows, rejected_rows, created_at
    FROM imports.batches
    WHERE idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function updateBatchStatus({ batchId, status, totalRows, acceptedRows, rejectedRows }) {
  const sql = db();
  const rows = await sql`
    UPDATE imports.batches
    SET status = ${status},
        total_rows = COALESCE(${totalRows}, total_rows),
        accepted_rows = COALESCE(${acceptedRows}, accepted_rows),
        rejected_rows = COALESCE(${rejectedRows}, rejected_rows)
    WHERE id = ${batchId}
    RETURNING id, created_by, file_name, status, total_rows, accepted_rows, rejected_rows, created_at
  `;
  return rows[0] || null;
}

export async function insertBatchErrors(batchId, errors) {
  if (!errors || errors.length === 0) return [];
  const sql = db();
  const results = [];
  for (const err of errors) {
    const rows = await sql`
      INSERT INTO imports.errors (batch_id, row_number, field_name, error_code, message)
      VALUES (${batchId}, ${err.rowNumber || 0}, ${err.fieldName || null}, ${err.errorCode || 'VALIDATION_ERROR'}, ${err.message})
      RETURNING id, batch_id, row_number, field_name, error_code, message
    `;
    results.push(rows[0]);
  }
  return results;
}

export async function getBatch(batchId) {
  const sql = db();
  const [batches, errors] = await Promise.all([
    sql`SELECT id, created_by, file_name, status, total_rows, accepted_rows, rejected_rows, created_at FROM imports.batches WHERE id = ${batchId} LIMIT 1`,
    sql`SELECT id, row_number, field_name, error_code, message FROM imports.errors WHERE batch_id = ${batchId} ORDER BY row_number LIMIT 200`
  ]);
  if (!batches.length) return null;
  return { ...batches[0], errors };
}

export async function listBatches(limit = 20) {
  const sql = db();
  return sql`
    SELECT id, created_by, file_name, status, total_rows, accepted_rows, rejected_rows, created_at
    FROM imports.batches
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
