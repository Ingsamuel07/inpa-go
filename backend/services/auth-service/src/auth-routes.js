import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  account,
  accounts,
  changePassword,
  provision,
  registerUser,
  renew,
  resetPassword,
  setActive,
  signIn,
  signOut,
  validateAccess,
} from './auth-service.js';

const r = Router();

const loginSchema = z.object({
  identifier: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(180),
  institutionalCode: z.string().trim().min(2).max(50),
});

const changePasswordSchema = z.object({
  email: z.string().trim().email().max(254),
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const resetPasswordSchema = z.object({
  email: z.string().trim().email().max(254),
  newPassword: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(40).max(256),
});

const provisionBody = z.object({
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'teacher', 'student']),
  fullName: z.string().trim().min(2).max(180).optional(),
}).refine((value) => value.role === 'admin' ? Boolean(value.email) : Boolean(value.fullName), {
  message: 'El rol requiere correo o nombre completo.',
});

function internal(req, res, next) {
  const expected = Buffer.from(process.env.AUTH_INTERNAL_TOKEN || '');
  const actual = Buffer.from((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  if (expected.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Acceso no autorizado al servicio interno.' } });
  }
  next();
}

// Token Introspection
r.get('/introspect', async (req, res, next) => {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Token requerido.' } });
  }
  try {
    res.json({ user: await validateAccess(token) });
  } catch (e) {
    next(e);
  }
});

// Login
r.post('/login', async (req, res, next) => {
  const p = loginSchema.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Revisa el correo institucional y la contraseña.' } });
  }
  try {
    res.json(await signIn(p.data));
  } catch (e) {
    next(e);
  }
});

// Self Registration (RF01)
r.post('/register', async (req, res, next) => {
  const p = registerSchema.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de registro inválidos. Verifica todos los campos.' } });
  }
  try {
    const session = await registerUser(p.data);
    res.status(201).json(session);
  } catch (e) {
    next(e);
  }
});

// Change Password
r.post('/change-password', async (req, res, next) => {
  const p = changePasswordSchema.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de cambio de contraseña inválidos.' } });
  }
  try {
    res.json(await changePassword(p.data));
  } catch (e) {
    next(e);
  }
});

// Reset Password
r.post('/reset-password', async (req, res, next) => {
  const p = resetPasswordSchema.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Indica un correo válido y una nueva contraseña de al menos 8 caracteres.' } });
  }
  try {
    res.json(await resetPassword(p.data));
  } catch (e) {
    next(e);
  }
});

// Refresh Token
r.post('/refresh', async (req, res, next) => {
  const p = refreshSchema.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Token no válido.' } });
  }
  try {
    res.json(await renew(p.data.refreshToken));
  } catch (e) {
    next(e);
  }
});

// Logout
r.post('/logout', async (req, res, next) => {
  const p = refreshSchema.safeParse(req.body);
  if (!p.success) return res.status(204).end();
  try {
    await signOut(p.data.refreshToken);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Internal Provisioning
r.post('/internal/users', internal, async (req, res, next) => {
  const p = provisionBody.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Datos de cuenta inválidos.' } });
  }
  try {
    res.status(201).json(await provision({ ...p.data, idempotencyKey: req.get('x-idempotency-key') || undefined }));
  } catch (e) {
    next(e);
  }
});

r.get('/internal/users', internal, async (_req, res, next) => {
  try {
    res.json(await accounts());
  } catch (e) {
    next(e);
  }
});

r.get('/internal/users/:id', internal, async (req, res, next) => {
  try {
    const u = await account(req.params.id);
    u ? res.json(u) : res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada.' } });
  } catch (e) {
    next(e);
  }
});

r.patch('/internal/users/:id/status', internal, async (req, res, next) => {
  const p = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Estado inválido.' } });
  }
  try {
    const changed = await setActive(req.params.id, p.data.active);
    changed ? res.json({ changed }) : res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Cuenta no encontrada.' } });
  } catch (e) {
    next(e);
  }
});

export default r;
