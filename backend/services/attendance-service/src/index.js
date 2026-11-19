import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';
import {
  closeSession,
  confirmRecord,
  createSession,
  findSession,
  pauseSession,
  recordsForSession,
  resumeSession,
  sessionsForGroup,
  studentHistory,
} from './repository.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '128kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'attendance-service' }));
app.use(rateLimit({ windowMs: 900000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(authenticate);

async function groupAccess(groupId, token) {
  const base = process.env.ACADEMIC_SERVICE_URL;
  if (!base) throw new Error('ACADEMIC_SERVICE_URL is required.');
  const res = await fetch(new URL(`/groups/${groupId}`, base), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) throw Object.assign(new Error('No tienes acceso al grupo.'), { status: 403, code: 'GROUP_ACCESS_DENIED' });
  if (!res.ok) throw Object.assign(new Error('No fue posible validar el grupo.'), { status: 502, code: 'ACADEMIC_SERVICE_ERROR' });
  return res.json();
}

// Create Session (RF07)
app.post('/sessions', requireRoles('teacher'), async (req, res, next) => {
  const p = z.object({
    groupId: z.string().uuid(),
    startsAt: z.string().datetime().optional(),
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de sesión inválidos.' } });
  }

  try {
    await groupAccess(p.data.groupId, req.get('authorization').slice(7));
    const session = await createSession({
      ...p.data,
      teacherId: req.auth.sub,
      idempotencyKey: req.get('x-idempotency-key'),
    });
    return res.status(201).json(session);
  } catch (e) {
    return next(e);
  }
});

// List Sessions for a group (RF07)
app.get('/sessions', async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.query.groupId);
  if (!id.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Indica un grupo válido.' } });
  }
  try {
    await groupAccess(id.data, req.get('authorization').slice(7));
    return res.json(await sessionsForGroup(id.data));
  } catch (e) {
    return next(e);
  }
});

// Get Session details
app.get('/sessions/:id', async (req, res, next) => {
  try {
    const x = await findSession(req.params.id);
    if (!x) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sesión no encontrada.' } });
    await groupAccess(x.group_id, req.get('authorization').slice(7));
    return res.json(x);
  } catch (e) {
    return next(e);
  }
});

// Pause Session (RF07)
app.patch('/sessions/:id/pause', requireRoles('teacher', 'admin'), async (req, res, next) => {
  try {
    const session = await pauseSession({
      id: req.params.id,
      teacherId: req.auth.sub,
      admin: req.auth.role === 'admin',
    });
    if (session) return res.json(session);
    const existing = await findSession(req.params.id);
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sesión no encontrada.' } });
    if (existing.status === 'paused') return res.status(409).json({ error: { code: 'ALREADY_PAUSED', message: 'La sesión ya está pausada.' } });
    if (existing.status === 'closed') return res.status(409).json({ error: { code: 'SESSION_CLOSED', message: 'La sesión está cerrada.' } });
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No tienes permiso para pausar esta sesión.' } });
  } catch (e) {
    return next(e);
  }
});

// Resume Session (RF07)
app.patch('/sessions/:id/resume', requireRoles('teacher', 'admin'), async (req, res, next) => {
  try {
    const session = await resumeSession({
      id: req.params.id,
      teacherId: req.auth.sub,
      admin: req.auth.role === 'admin',
    });
    if (session) return res.json(session);
    const existing = await findSession(req.params.id);
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sesión no encontrada.' } });
    if (existing.status === 'open') return res.status(409).json({ error: { code: 'ALREADY_OPEN', message: 'La sesión ya se encuentra abierta.' } });
    if (existing.status === 'closed') return res.status(409).json({ error: { code: 'SESSION_CLOSED', message: 'La sesión está cerrada.' } });
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No tienes permiso para reanudar esta sesión.' } });
  } catch (e) {
    return next(e);
  }
});

// Close Session (RF07)
app.patch('/sessions/:id/close', requireRoles('teacher', 'admin'), async (req, res, next) => {
  try {
    const session = await closeSession({
      id: req.params.id,
      teacherId: req.auth.sub,
      admin: req.auth.role === 'admin',
    });
    if (session) return res.json(session);
    const old = await findSession(req.params.id);
    if (!old) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sesión no encontrada.' } });
    if (old.status === 'closed') return res.status(409).json({ error: { code: 'SESSION_CLOSED', message: 'La sesión ya está cerrada.' } });
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No tienes permiso para cerrar esta sesión.' } });
  } catch (e) {
    return next(e);
  }
});

// Get Records for Session
app.get('/sessions/:id/records', async (req, res, next) => {
  try {
    const session = await findSession(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sesión no encontrada.' } });
    await groupAccess(session.group_id, req.get('authorization').slice(7));
    return res.json(await recordsForSession(session.id, req.auth.role === 'student' ? req.auth.sub : null));
  } catch (e) {
    return next(e);
  }
});

// Teacher confirms/marks attendance (RF10)
app.put('/sessions/:id/records', requireRoles('teacher'), async (req, res, next) => {
  const p = z.object({
    studentUserId: z.string().uuid(),
    status: z.enum(['present', 'absent', 'late', 'excused']),
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Estado de asistencia inválido.' } });
  }

  try {
    const session = await findSession(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sesión no encontrada.' } });
    if (session.status !== 'open') return res.status(409).json({ error: { code: 'SESSION_NOT_OPEN', message: 'La sesión no está abierta para registrar asistencias.' } });
    await groupAccess(session.group_id, req.get('authorization').slice(7));

    const rosterRes = await fetch(new URL(`/groups/${session.group_id}/students`, process.env.ACADEMIC_SERVICE_URL), {
      headers: { authorization: req.get('authorization') },
    });
    if (!rosterRes.ok) throw Object.assign(new Error('No fue posible verificar matrículas.'), { status: 502, code: 'ACADEMIC_SERVICE_ERROR' });
    const roster = await rosterRes.json();
    if (!roster.some((x) => x.studentId === p.data.studentUserId)) {
      return res.status(403).json({ error: { code: 'STUDENT_NOT_ENROLLED', message: 'El estudiante no pertenece al grupo.' } });
    }

    const record = await confirmRecord({
      sessionId: session.id,
      studentId: p.data.studentUserId,
      teacherId: req.auth.sub,
      status: p.data.status,
      evidence: { method: 'teacher_manual', confirmedByTeacherId: req.auth.sub },
    });

    if (!record) return res.status(409).json({ error: { code: 'SESSION_NOT_WRITABLE', message: 'La sesión no se encuentra disponible.' } });
    return res.json(record);
  } catch (e) {
    return next(e);
  }
});

// Student GPS Self Check-In (RF09, RF10)
app.post('/sessions/:id/check-in', requireRoles('student'), async (req, res, next) => {
  const p = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0).max(1000).default(10),
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Coordenadas GPS requeridas.' } });
  }

  const token = req.get('authorization').slice(7);

  try {
    const session = await findSession(req.params.id);
    if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sesión no encontrada.' } });
    if (session.status !== 'open') {
      return res.status(409).json({ error: { code: 'SESSION_NOT_OPEN', message: 'La sesión está cerrada o pausada.' } });
    }

    // 1. Verify student enrollment in group
    const rosterRes = await fetch(new URL(`/groups/${session.group_id}/students`, process.env.ACADEMIC_SERVICE_URL), {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!rosterRes.ok) throw Object.assign(new Error('No fue posible verificar tu matrícula en el grupo.'), { status: 502 });
    const roster = await rosterRes.json();
    if (!roster.some((x) => x.studentId === req.auth.sub)) {
      return res.status(403).json({ error: { code: 'NOT_ENROLLED', message: 'No estás matriculado en esta asignatura.' } });
    }

    // 2. Validate location with location-service
    const locRes = await fetch(new URL('/validate', process.env.LOCATION_SERVICE_URL), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: session.id,
        latitude: p.data.latitude,
        longitude: p.data.longitude,
        accuracyMeters: p.data.accuracyMeters,
      }),
    });

    const locData = await locRes.json().catch(() => ({}));
    if (!locRes.ok) {
      return res.status(locRes.status).json(locData);
    }

    if (!locData.withinRadius) {
      return res.status(422).json({
        error: {
          code: 'OUTSIDE_GEOFENCE',
          message: `Te encuentras a ${locData.distanceMeters} metros de la sede, fuera del radio permitido para marcar asistencia.`,
          distanceMeters: locData.distanceMeters,
        },
      });
    }

    // 3. Register attendance as present
    const record = await confirmRecord({
      sessionId: session.id,
      studentId: req.auth.sub,
      teacherId: session.teacher_user_id,
      status: 'present',
      evidence: {
        method: 'gps_self_checkin',
        distanceMeters: locData.distanceMeters,
        accuracyMeters: locData.accuracyMeters,
        geofence: locData.geofence,
        timestamp: new Date().toISOString(),
      },
    });

    return res.status(200).json({
      message: '¡Asistencia confirmada exitosamente con validación de geocerca!',
      record,
      validation: locData,
    });
  } catch (e) {
    return next(e);
  }
});

// Student Attendance History (RF11)
app.get('/history', requireRoles('student'), async (req, res, next) => {
  try {
    return res.json(await studentHistory(req.auth.sub));
  } catch (e) {
    return next(e);
  }
});

// Student Attendance Statistics & Percentages per Course (RF11)
app.get('/stats', requireRoles('student'), async (req, res, next) => {
  try {
    const history = await studentHistory(req.auth.sub);
    const token = req.get('authorization').slice(7);

    // Fetch student's groups
    const groupsRes = await fetch(new URL('/groups', process.env.ACADEMIC_SERVICE_URL), {
      headers: { authorization: `Bearer ${token}` },
    });
    const groups = groupsRes.ok ? await groupsRes.json() : [];

    // Calculate stats per group
    const stats = groups.map((g) => {
      const groupHistory = history.filter((h) => h.group_id === g.id);
      const totalRecorded = groupHistory.length;
      const presentCount = groupHistory.filter((h) => h.status === 'present').length;
      const lateCount = groupHistory.filter((h) => h.status === 'late').length;
      const excusedCount = groupHistory.filter((h) => h.status === 'excused').length;
      const absentCount = groupHistory.filter((h) => h.status === 'absent').length;

      // Academic attendance percentage
      const percentage = totalRecorded > 0 ? Math.round(((presentCount + lateCount * 0.8) / totalRecorded) * 100) : 100;

      return {
        groupId: g.id,
        groupCode: g.code,
        courseCode: g.course_code,
        courseName: g.course_name,
        term: g.term,
        totalSessions: totalRecorded,
        present: presentCount,
        late: lateCount,
        excused: excusedCount,
        absent: absentCount,
        attendancePercentage: percentage,
      };
    });

    return res.json(stats);
  } catch (e) {
    return next(e);
  }
});

app.use((e, _req, res, _next) => {
  const s = e.status || 500;
  if (s >= 500) console.error('attendance-service request failed:', e);
  res.status(s).json({
    error: {
      code: e.code || 'INTERNAL_ERROR',
      message: s < 500 ? e.message : 'No fue posible procesar la solicitud.',
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(Number(process.env.PORT || 4104), () => console.log('Attendance service listening'));
}

export default app;
