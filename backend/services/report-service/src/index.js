import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'report-service' }));
app.use(rateLimit({ windowMs: 900000, limit: 150, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(authenticate);

async function service(path, base, token, options = {}) {
  if (!base) throw new Error('Service URL is missing.');
  const r = await fetch(new URL(path, base), {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) {
    throw Object.assign(new Error('No fue posible consultar los datos del reporte.'), {
      status: r.status === 403 ? 403 : 502,
      code: 'REPORT_DATA_UNAVAILABLE',
    });
  }
  return r.json();
}

function makePdf({ group, sessions, records, profiles, from, to }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (x) => chunks.push(x));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Institutional Header Banner
    doc.rect(40, 40, 515, 60).fill('#07152F'); // Navy Blue
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('FUNDACIÓN UNIVERSITARIA INPAHU', 55, 52);
    doc.fontSize(11).font('Helvetica').fillColor('#F0440B').text('INPA_GO · Sistema Inteligente de Asistencia Académica', 55, 75);

    doc.moveDown(2);
    doc.fillColor('#07152F').fontSize(14).font('Helvetica-Bold').text('REPORTE OFICIAL DE ASISTENCIA', 40, 115);

    // Group & Course Meta Information Card
    doc.rect(40, 135, 515, 60).fillAndStroke('#F8FAFC', '#E2E8F0');
    doc.fillColor('#334155').fontSize(10).font('Helvetica');
    doc.text(`Asignatura: ${group.course_name} (${group.course_code})`, 50, 145);
    doc.text(`Grupo: ${group.code}  |  Periodo Académico: ${group.term}`, 50, 160);
    doc.text(`Rango de Fechas: ${from || 'Inicio'} hasta ${to || 'Fecha actual'}`, 50, 175);
    doc.text(`Total Sesiones: ${sessions.length}`, 380, 145);
    doc.text(`Total Matrículas: ${profiles.length}`, 380, 160);

    doc.moveDown(3);

    // Attendance Summary Statistics
    let totalPresent = 0, totalLate = 0, totalAbsent = 0, totalExcused = 0;
    records.forEach(r => {
      if (r.status === 'present') totalPresent++;
      else if (r.status === 'late') totalLate++;
      else if (r.status === 'absent') totalAbsent++;
      else if (r.status === 'excused') totalExcused++;
    });

    const totalRecords = records.length;
    const globalPercent = totalRecords > 0 ? Math.round(((totalPresent + totalLate * 0.8) / totalRecords) * 100) : 100;

    let y = 210;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#07152F').text('Resumen de Control:', 40, y);
    y += 18;

    doc.rect(40, y, 120, 36).fill('#ECFDF5'); // Green box
    doc.fillColor('#065F46').fontSize(9).font('Helvetica-Bold').text('Presentes:', 48, y + 6);
    doc.fontSize(14).text(`${totalPresent}`, 48, y + 18);

    doc.rect(170, y, 120, 36).fill('#FFFBEB'); // Amber box
    doc.fillColor('#92400E').fontSize(9).font('Helvetica-Bold').text('Retardos:', 178, y + 6);
    doc.fontSize(14).text(`${totalLate}`, 178, y + 18);

    doc.rect(300, y, 120, 36).fill('#FEF2F2'); // Red box
    doc.fillColor('#991B1B').fontSize(9).font('Helvetica-Bold').text('Inasistencias:', 308, y + 6);
    doc.fontSize(14).text(`${totalAbsent}`, 308, y + 18);

    doc.rect(430, y, 125, 36).fill('#EFF6FF'); // Blue box
    doc.fillColor('#1E40AF').fontSize(9).font('Helvetica-Bold').text('Efectividad:', 438, y + 6);
    doc.fontSize(14).text(`${globalPercent}%`, 438, y + 18);

    y += 55;

    // Detailed Session Records
    const names = new Map(profiles.map((p) => [p.user_id, p.full_name]));
    const codes = new Map(profiles.map((p) => [p.user_id, p.institutional_code]));

    doc.fontSize(12).font('Helvetica-Bold').fillColor('#07152F').text('Detalle por Sesión:', 40, y);
    y += 18;

    for (const session of sessions) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      const sessionDate = new Date(session.starts_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      doc.rect(40, y, 515, 20).fill('#07152F');
      doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(`Sesión: ${sessionDate}  ·  Estado: ${session.status === 'open' ? 'Abierta' : 'Cerrada'}`, 48, y + 5);
      y += 24;

      const rows = records.filter((r) => r.session_id === session.id);
      if (!rows.length) {
        doc.fillColor('#64748B').fontSize(9).font('Helvetica-Oblique').text('No se confirmaron asistencias en esta sesión.', 50, y);
        y += 16;
      } else {
        // Table header
        doc.rect(40, y, 515, 16).fill('#F1F5F9');
        doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold');
        doc.text('CÓDIGO', 48, y + 4);
        doc.text('ESTUDIANTE', 140, y + 4);
        doc.text('ESTADO', 360, y + 4);
        doc.text('HORA REGISTRO', 440, y + 4);
        y += 18;

        for (const row of rows) {
          if (y > 750) {
            doc.addPage();
            y = 50;
          }

          const studentName = names.get(row.student_user_id) || 'Estudiante';
          const studentCode = codes.get(row.student_user_id) || 'N/A';
          const confirmedTime = new Date(row.confirmed_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' });

          doc.fillColor('#1E293B').fontSize(8).font('Helvetica');
          doc.text(studentCode, 48, y);
          doc.text(studentName, 140, y, { width: 210, ellipsis: true });

          // Status Badge
          let statusColor = '#16803C';
          let statusLabel = 'PRESENTE';
          if (row.status === 'late') { statusColor = '#B45309'; statusLabel = 'RETARDO'; }
          else if (row.status === 'absent') { statusColor = '#B91C1C'; statusLabel = 'AUSENTE'; }
          else if (row.status === 'excused') { statusColor = '#4338CA'; statusLabel = 'EXCUSA'; }

          doc.font('Helvetica-Bold').fillColor(statusColor).text(statusLabel, 360, y);
          doc.font('Helvetica').fillColor('#64748B').text(confirmedTime, 440, y);

          y += 14;
        }
        y += 8;
      }
    }

    // Institutional Footer
    doc.fontSize(8).fillColor('#94A3B8').text(
      `Documento generado automáticamente por INPA_GO el ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })} · Uso oficial UNINPAHU`,
      40,
      780,
      { align: 'center', width: 515 }
    );

    doc.end();
  });
}

app.get('/', requireRoles('admin', 'teacher'), async (req, res, next) => {
  const p = z.object({
    groupId: z.string().uuid(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  }).safeParse(req.query);

  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Filtros del reporte inválidos.' } });
  }

  if (p.data.from && p.data.to && p.data.from > p.data.to) {
    return res.status(400).json({ error: { code: 'INVALID_RANGE', message: 'La fecha inicial debe ser anterior a la final.' } });
  }

  try {
    const token = req.get('authorization').slice(7);
    const group = await service(`/groups/${p.data.groupId}`, process.env.ACADEMIC_SERVICE_URL, token);
    const allSessions = await service(`/sessions?groupId=${p.data.groupId}`, process.env.ATTENDANCE_SERVICE_URL, token);
    const sessions = allSessions.filter(
      (x) => (!p.data.from || x.starts_at.slice(0, 10) >= p.data.from) && (!p.data.to || x.starts_at.slice(0, 10) <= p.data.to)
    );

    const recordSets = await Promise.all(
      sessions.map((x) => service(`/sessions/${x.id}/records`, process.env.ATTENDANCE_SERVICE_URL, token))
    );
    const records = recordSets.flat();
    const ids = [...new Set(records.map((x) => x.student_user_id))];
    const profiles = ids.length
      ? await service('/profiles/lookup', process.env.USER_SERVICE_URL, token, {
          method: 'POST',
          body: JSON.stringify({ groupId: p.data.groupId, userIds: ids }),
        })
      : [];

    const pdf = await makePdf({ group, sessions, records, profiles, from: p.data.from, to: p.data.to });
    res.set({
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="reporte_asistencia_${group.code}.pdf"`,
      'cache-control': 'private, no-store',
    });
    return res.send(pdf);
  } catch (e) {
    return next(e);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('report-service request failed:', err);
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status < 500 ? err.message : 'No fue posible generar el reporte.',
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(Number(process.env.PORT || 4108), () => console.log('Report service listening'));
}

export default app;
