import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';
import {
  addAssignment,
  addCourse,
  addEnrollment,
  addGroup,
  courses,
  groupFor,
  groupsFor,
  studentsIn,
} from './repository.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'academic-service' }));
app.use(rateLimit({ windowMs: 900000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(authenticate);

const schemas = {
  course: z.object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(2).max(180),
  }),
  group: z.object({
    courseId: z.string().uuid(),
    code: z.string().trim().min(1).max(40),
    term: z.string().trim().min(1).max(40),
  }),
  assignment: z.object({
    teacherUserId: z.string().uuid(),
    groupId: z.string().uuid(),
  }),
  enrollment: z.object({
    studentUserId: z.string().uuid(),
    groupId: z.string().uuid(),
  }),
};

// List Courses (Admin) (RF05)
app.get('/courses', requireRoles('admin'), async (_req, res, next) => {
  try {
    return res.json(await courses());
  } catch (e) {
    return next(e);
  }
});

// Create Course (RF05)
app.post('/courses', requireRoles('admin'), async (req, res, next) => {
  const p = schemas.course.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de asignatura inválidos.' } });
  }
  try {
    return res.status(201).json(await addCourse({ ...p.data, idempotencyKey: req.get('x-idempotency-key') }));
  } catch (e) {
    return next(e);
  }
});

// List Groups accessible by the authenticated user's role (RF05, RF06)
app.get('/groups', async (req, res, next) => {
  try {
    return res.json(await groupsFor(req.auth));
  } catch (e) {
    return next(e);
  }
});

// Create Group (RF05)
app.post('/groups', requireRoles('admin'), async (req, res, next) => {
  const p = schemas.group.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de grupo inválidos.' } });
  }
  try {
    return res.status(201).json(await addGroup({ ...p.data, idempotencyKey: req.get('x-idempotency-key') }));
  } catch (e) {
    return next(e);
  }
});

// Get specific group
app.get('/groups/:id', async (req, res, next) => {
  try {
    const x = await groupFor(req.params.id, req.auth);
    if (!x) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Grupo no encontrado.' } });
    return res.json(x);
  } catch (e) {
    return next(e);
  }
});

// List enrolled students in group (RF06)
app.get('/groups/:id/students', requireRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    if (!await groupFor(req.params.id, req.auth)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Grupo no encontrado.' } });
    }
    return res.json(await studentsIn(req.params.id));
  } catch (e) {
    return next(e);
  }
});

// Assign Teacher to Group (RF06)
app.post('/assignments', requireRoles('admin'), async (req, res, next) => {
  const p = schemas.assignment.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de vinculación docente inválidos.' } });
  }
  try {
    return res.status(201).json(await addAssignment({ ...p.data, idempotencyKey: req.get('x-idempotency-key') }));
  } catch (e) {
    return next(e);
  }
});

// Enroll Student in Group (RF06)
app.post('/enrollments', requireRoles('admin'), async (req, res, next) => {
  const p = schemas.enrollment.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de matrícula inválidos.' } });
  }
  try {
    return res.status(201).json(await addEnrollment({ ...p.data, idempotencyKey: req.get('x-idempotency-key') }));
  } catch (e) {
    return next(e);
  }
});

app.use((e, _req, res, _next) => {
  const duplicate = e.code === '23505';
  const status = duplicate ? 409 : e.status || 500;
  if (status >= 500) console.error('academic-service request failed:', e);
  res.status(status).json({
    error: {
      code: duplicate ? 'DUPLICATE_RECORD' : e.code || 'INTERNAL_ERROR',
      message: status < 500 ? (duplicate ? 'El registro o vinculación ya existe.' : e.message) : 'No fue posible procesar la solicitud.',
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(Number(process.env.PORT || 4103), () => console.log('Academic service listening'));
}

export default app;
