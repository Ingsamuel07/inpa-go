import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';
import { createBatch, findBatchByIdempotencyKey, getBatch, insertBatchErrors, listBatches, updateBatchStatus } from './repository.js';
import { parseExcelBuffer, processImportRecords } from './excel-processor.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '15mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'import-service' }));
app.use(rateLimit({ windowMs: 900000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(authenticate);

const uploadSchema = z.object({
  fileName: z.string().trim().min(3).max(255).default('usuarios_importacion.xlsx'),
  fileBase64: z.string().min(1, 'El archivo en formato base64 es requerido'),
});

app.post('/upload', requireRoles('admin'), async (req, res, next) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Se requiere el nombre del archivo y el contenido base64.' } });
  }

  const { fileName, fileBase64 } = parsed.data;
  const idempotencyKey = req.get('x-idempotency-key');
  const token = req.get('authorization').slice(7);
  const userServiceUrl = process.env.USER_SERVICE_URL;

  if (!userServiceUrl) {
    return res.status(503).json({ error: { code: 'USER_SERVICE_UNAVAILABLE', message: 'El servicio de usuarios no está configurado.' } });
  }

  let batch;
  try {
    if (idempotencyKey) {
      const existing = await findBatchByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.status === 'processing') {
          return res.status(202).json({
            batchId: existing.id,
            fileName: existing.file_name,
            status: existing.status,
            totalRows: existing.total_rows,
            acceptedRows: existing.accepted_rows,
            rejectedRows: existing.rejected_rows,
            errors: [],
            pendingSync: true,
          });
        }
        const complete = await getBatch(existing.id);
        if (existing.status === 'failed') {
          return res.status(409).json({
            error: {
              code: 'IMPORT_ALREADY_FAILED',
              message: 'El lote previo terminó con error y no se volverá a procesar automáticamente.',
            },
            batch: complete,
          });
        }
        return res.status(200).json({
          batchId: existing.id,
          fileName: existing.file_name,
          status: existing.status,
          totalRows: existing.total_rows,
          acceptedRows: existing.accepted_rows,
          rejectedRows: existing.rejected_rows,
          errors: complete.errors,
        });
      }
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const { records, errors: parseErrors, totalRows } = await parseExcelBuffer(buffer);

    batch = await createBatch({
      createdBy: req.auth.sub,
      fileName,
      totalRows,
      idempotencyKey,
    });
    if (!batch) {
      const existing = await findBatchByIdempotencyKey(idempotencyKey);
      if (!existing) throw new Error('No fue posible reservar el lote de importación.');
      return res.status(202).json({
        batchId: existing.id,
        fileName: existing.file_name,
        status: existing.status,
        totalRows: existing.total_rows,
        acceptedRows: existing.accepted_rows,
        rejectedRows: existing.rejected_rows,
        errors: [],
        pendingSync: true,
      });
    }

    // If there were schema validation errors during parsing, save them
    const allErrors = [...parseErrors];

    // Process valid records
    const { successes, errors: processingErrors } = await processImportRecords({
      records,
      token,
      userServiceUrl,
    });

    allErrors.push(...processingErrors);

    const acceptedRows = successes.length;
    const rejectedRows = allErrors.length;
    const finalStatus = rejectedRows === 0 ? 'completed' : (acceptedRows > 0 ? 'completed_with_errors' : 'failed');

    await updateBatchStatus({
      batchId: batch.id,
      status: finalStatus,
      totalRows,
      acceptedRows,
      rejectedRows,
    });

    if (allErrors.length > 0) {
      await insertBatchErrors(batch.id, allErrors);
    }

    return res.status(201).json({
      batchId: batch.id,
      fileName,
      status: finalStatus,
      totalRows,
      acceptedRows,
      rejectedRows,
      errors: allErrors.slice(0, 50), // return top 50 in response
    });
  } catch (error) {
    if (batch) {
      await updateBatchStatus({ batchId: batch.id, status: 'failed', totalRows: 0, acceptedRows: 0, rejectedRows: 0 }).catch(() => {});
    }
    return next(error);
  }
});

app.get('/batches', requireRoles('admin'), async (_req, res, next) => {
  try {
    const batches = await listBatches();
    return res.json(batches);
  } catch (error) {
    return next(error);
  }
});

app.get('/batches/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const batch = await getBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lote de importación no encontrado.' } });
    return res.json(batch);
  } catch (error) {
    return next(error);
  }
});

app.get('/template', requireRoles('admin'), async (_req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Usuarios');

    sheet.columns = [
      { header: 'Nombre Completo', key: 'fullName', width: 30 },
      { header: 'Correo Institucional', key: 'email', width: 32 },
      { header: 'Código Institucional', key: 'institutionalCode', width: 22 },
      { header: 'Rol (estudiante / docente)', key: 'role', width: 25 },
      { header: 'Contraseña Inicial', key: 'password', width: 22 },
    ];

    // Style the header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF07152F' }, // Institutional Navy Blue
    };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_usuarios_uninpahu.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    return next(error);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('import-service request failed:', err);
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status < 500 ? err.message : 'No fue posible procesar la importación.',
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(Number(process.env.PORT || 4107), () => console.log('Import service listening'));
}

export default app;
