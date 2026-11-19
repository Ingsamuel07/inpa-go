import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';
import { matchRoster } from './matcher.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'voice-service' }));
app.use(rateLimit({ windowMs: 900000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(authenticate);

async function callService(base, path, token, options = {}) {
  if (!base) throw new Error('Required service URL is not configured.');
  const response = await fetch(new URL(path, base), {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(3500),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message || 'No fue posible consultar el servicio dependiente.'), {
      status: response.status === 404 ? 404 : 502,
      code: 'DEPENDENCY_ERROR',
    });
  }
  return data;
}

// Match recognized voice text against session student roster (RF08)
app.post('/match', requireRoles('teacher'), async (req, res, next) => {
  const p = z.object({
    sessionId: z.string().uuid(),
    transcript: z.string().trim().min(1).max(160),
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Texto reconocido o sesión inválidos.' } });
  }

  const token = req.get('authorization').slice(7);

  try {
    const session = await callService(process.env.ATTENDANCE_SERVICE_URL, `/sessions/${p.data.sessionId}`, token);
    if (session.status !== 'open') {
      return res.status(409).json({ error: { code: 'SESSION_NOT_OPEN', message: 'La sesión está cerrada o pausada.' } });
    }
    if (session.teacher_user_id !== req.auth.sub && req.auth.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Solo el docente responsable puede consultar coincidencias de voz.' } });
    }

    const students = await callService(process.env.ACADEMIC_SERVICE_URL, `/groups/${session.group_id}/students`, token);
    const profiles = await callService(process.env.USER_SERVICE_URL, '/profiles/lookup', token, {
      method: 'POST',
      body: JSON.stringify({ groupId: session.group_id, userIds: students.map((x) => x.studentId) }),
    });

    const candidates = matchRoster(p.data.transcript, profiles);
    return res.json({
      transcript: p.data.transcript,
      candidates,
      requiresManualConfirmation: true,
      count: candidates.length,
    });
  } catch (e) {
    return next(e);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('voice-service request failed:', err);
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status < 500 ? err.message : 'No fue posible procesar el reconocimiento.',
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(Number(process.env.PORT || 4105), () => console.log('Voice service listening'));
}

export default app;
