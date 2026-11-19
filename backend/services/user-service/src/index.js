import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { neon } from '@neondatabase/serverless';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'user-service' }));
app.use(rateLimit({ windowMs: 900000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

const db = () => {
  const url = process.env.USER_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('USER_DATABASE_URL is required.');
  return neon(url);
};

function internal(req, res, next) {
  const expected = Buffer.from(process.env.AUTH_INTERNAL_TOKEN || '');
  const actual = Buffer.from((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  if (expected.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Acceso no autorizado al servicio interno.' } });
  }
  next();
}

const internalProfileSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().trim().min(2).max(180),
  institutionalCode: z.string().trim().min(2).max(50),
});

app.post('/internal/profiles', internal, async (req, res, next) => {
  const parsed = internalProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos del perfil inválidos.' } });
  }
  try {
    const sql = db();
    const { userId, fullName, institutionalCode } = parsed.data;
    const rows = await sql`
      INSERT INTO directory.profiles (user_id, full_name, institutional_code, profile_type)
      VALUES (${userId}, ${fullName}, ${institutionalCode}, 'student')
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id, full_name, institutional_code, profile_type, active, created_at
    `;
    const profiles = rows.length
      ? rows
      : await sql`SELECT user_id, full_name, institutional_code, profile_type, active, created_at FROM directory.profiles WHERE user_id = ${userId} LIMIT 1`;
    return res.status(201).json(profiles[0]);
  } catch (error) {
    return next(error);
  }
});

app.use(authenticate);

async function authCall(path, options = {}) {
  const baseUrl = process.env.AUTH_SERVICE_URL;
  const token = process.env.AUTH_INTERNAL_TOKEN;
  if (!baseUrl || !token) throw new Error('Auth service configuration is required.');
  const res = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(body?.error?.message || 'Auth service error.');
    error.status = res.status;
    error.code = body?.error?.code || 'AUTH_SERVICE_ERROR';
    throw error;
  }
  return body;
}

const userCreateSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(180),
  institutionalCode: z.string().trim().min(2).max(50),
});
const adminCreateSchema = userCreateSchema.extend({
  email: z.string().trim().email().max(254),
});

const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(180).optional(),
  institutionalCode: z.string().trim().min(2).max(50).optional(),
});

// Helper to provision user + create directory profile
async function provisionAndCreateProfile(role, data) {
  let user;
  try {
    user = await authCall('/internal/users', {
      method: 'POST',
      body: JSON.stringify({ email: data.email, fullName: data.fullName, password: data.password, role }),
      headers: reqIdempotencyHeader(data.idempotencyKey),
    });
    const sql = db();
    const existingProfiles = !user.active
      ? await sql`SELECT user_id FROM directory.profiles WHERE user_id = ${user.id} LIMIT 1`
      : [];
    if (!user.active && existingProfiles.length === 0) {
      await authCall(`/internal/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
    }
    const rows = await sql`
      INSERT INTO directory.profiles (user_id, full_name, institutional_code, profile_type)
      VALUES (${user.id}, ${data.fullName}, ${data.institutionalCode}, ${role})
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id, full_name, institutional_code, profile_type, active, created_at
    `;
    const profiles = rows.length
      ? rows
      : await sql`SELECT user_id, full_name, institutional_code, profile_type, active, created_at FROM directory.profiles WHERE user_id = ${user.id} LIMIT 1`;
    return { ...user, profile: profiles[0] };
  } catch (error) {
    if (user?.id) {
      await authCall(`/internal/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      }).catch(() => {});
    }
    throw error;
  }
}

function reqIdempotencyHeader(idempotencyKey) {
  return idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {};
}

// List users with optional role filtering (RF03)
app.get('/', requireRoles('admin'), async (req, res, next) => {
  try {
    const roleFilter = req.query.role;
    const [users, sql] = await Promise.all([authCall('/internal/users'), Promise.resolve(db())]);
    const profiles = await sql`SELECT user_id, full_name, institutional_code, profile_type, active FROM directory.profiles`;
    const map = new Map(profiles.map((x) => [x.user_id, x]));
    let combined = users.map((x) => ({ ...x, profile: map.get(x.id) || null }));
    if (roleFilter) {
      combined = combined.filter((u) => u.role === roleFilter);
    }
    return res.json(combined);
  } catch (error) {
    return next(error);
  }
});

// Create Teacher (RF03)
app.post('/teachers', requireRoles('admin'), async (req, res, next) => {
  const parsed = userCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Verifica los datos del docente y usa una contraseña segura.' } });
  }
  try {
    const result = await provisionAndCreateProfile('teacher', {
      ...parsed.data,
      idempotencyKey: req.get('x-idempotency-key'),
    });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

// Create Student (RF03)
app.post('/students', requireRoles('admin'), async (req, res, next) => {
  const parsed = userCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Verifica los datos del estudiante y usa una contraseña segura.' } });
  }
  try {
    const result = await provisionAndCreateProfile('student', {
      ...parsed.data,
      idempotencyKey: req.get('x-idempotency-key'),
    });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

// Create Admin (RF03)
app.post('/admins', requireRoles('admin'), async (req, res, next) => {
  const parsed = adminCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Verifica los datos del administrador.' } });
  }
  try {
    const result = await provisionAndCreateProfile('admin', {
      ...parsed.data,
      idempotencyKey: req.get('x-idempotency-key'),
    });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

// Lookup profiles for a group (Used by Voice & Report Services)
app.post('/profiles/lookup', requireRoles('admin', 'teacher'), async (req, res, next) => {
  const p = z.object({
    groupId: z.string().uuid(),
    userIds: z.array(z.string().uuid()).min(1).max(200),
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Listado de perfiles inválido.' } });
  }

  try {
    const rosterRes = await fetch(new URL(`/groups/${p.data.groupId}/students`, process.env.ACADEMIC_SERVICE_URL), {
      headers: { authorization: req.get('authorization') },
    });
    if (!rosterRes.ok) {
      throw Object.assign(new Error('No fue posible validar el listado académico.'), { status: 502, code: 'ACADEMIC_SERVICE_ERROR' });
    }
    const roster = await rosterRes.json();
    const allowed = new Set(roster.map((x) => x.studentId));
    if (p.data.userIds.some((id) => !allowed.has(id))) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'El grupo no contiene todos los perfiles solicitados.' } });
    }
    const sql = db();
    const ids = JSON.stringify([...new Set(p.data.userIds)]);
    const profiles = await sql`
      SELECT user_id, full_name, institutional_code
      FROM directory.profiles
      WHERE profile_type = 'student' AND active = true AND user_id::text IN (SELECT jsonb_array_elements_text(${ids}::jsonb))
    `;
    return res.json(profiles);
  } catch (error) {
    return next(error);
  }
});

// Get user profile by ID
app.get('/:id', async (req, res, next) => {
  if (req.auth.role !== 'admin' && req.auth.sub !== req.params.id) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Solo puedes consultar tu propio perfil.' } });
  }
  try {
    const [u, sql] = await Promise.all([authCall(`/internal/users/${req.params.id}`), Promise.resolve(db())]);
    const rows = await sql`
      SELECT user_id, full_name, institutional_code, profile_type, active, created_at, updated_at
      FROM directory.profiles
      WHERE user_id = ${req.params.id}
      LIMIT 1
    `;
    return res.json({ ...u, profile: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

// Update Profile (RF03)
app.put('/:id', requireRoles('admin'), async (req, res, next) => {
  const parsed = userUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de actualización inválidos.' } });
  }
  try {
    const sql = db();
    const rows = await sql`
      UPDATE directory.profiles
      SET full_name = COALESCE(${parsed.data.fullName || null}, full_name),
          institutional_code = COALESCE(${parsed.data.institutionalCode || null}, institutional_code),
          updated_at = now()
      WHERE user_id = ${req.params.id}
      RETURNING user_id, full_name, institutional_code, profile_type, active, updated_at
    `;
    if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Perfil no encontrado.' } });
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

// Toggle User Status (RF03)
app.patch('/:id/status', requireRoles('admin'), async (req, res, next) => {
  const p = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Estado inválido.' } });
  }
  try {
    const result = await authCall(`/internal/users/${req.params.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(p.data),
    });
    const sql = db();
    await sql`UPDATE directory.profiles SET active = ${p.data.active}, updated_at = now() WHERE user_id = ${req.params.id}`;
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('user-service request failed:', err);
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status < 500 ? err.message : 'No fue posible procesar la solicitud.',
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(Number(process.env.PORT || 4102), () => console.log('User service listening'));
}

export default app;
