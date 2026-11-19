import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';
import { createGeofence, listActiveGeofences, saveValidation, updateGeofence, validationsForSession } from './repository.js';
import { distanceMeters } from './geo.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'location-service' }));
app.use(rateLimit({ windowMs: 900000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(authenticate);

const geofenceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(1).max(10000),
});

async function openSession(sessionId, token) {
  if (!process.env.ATTENDANCE_SERVICE_URL) throw new Error('ATTENDANCE_SERVICE_URL is required.');
  const response = await fetch(new URL(`/sessions/${sessionId}`, process.env.ATTENDANCE_SERVICE_URL), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw Object.assign(new Error('No se pudo validar la sesión académica.'), {
      status: response.status === 404 ? 404 : 502,
      code: 'ATTENDANCE_SERVICE_ERROR',
    });
  }
  return response.json();
}

app.get('/geofences', requireRoles('admin'), async (_req, res, next) => {
  try {
    return res.json(await listActiveGeofences());
  } catch (e) {
    return next(e);
  }
});

app.post('/geofences', requireRoles('admin'), async (req, res, next) => {
  const p = geofenceSchema.safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Zona geográfica inválida.' } });
  }
  try {
    return res.status(201).json(await createGeofence(p.data));
  } catch (e) {
    return next(e);
  }
});

app.put('/geofences/:id', requireRoles('admin'), async (req, res, next) => {
  const p = geofenceSchema.extend({ active: z.boolean() }).safeParse(req.body);
  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Zona geográfica inválida.' } });
  }
  try {
    const g = await updateGeofence({ id: req.params.id, ...p.data });
    return g ? res.json(g) : res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Zona no encontrada.' } });
  } catch (e) {
    return next(e);
  }
});

// Student GPS validation with Haversine formula (RF09)
app.post('/validate', requireRoles('student'), async (req, res, next) => {
  const p = z.object({
    sessionId: z.string().uuid(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0).max(1000).default(10),
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Coordenadas o precisión GPS inválidas.' } });
  }

  try {
    const session = await openSession(p.data.sessionId, req.get('authorization').slice(7));
    if (session.status !== 'open') {
      return res.status(409).json({
        error: {
          code: 'SESSION_NOT_OPEN',
          message: session.status === 'paused' ? 'La sesión de clase se encuentra pausada.' : 'La sesión de clase está cerrada.',
        },
      });
    }

    const fences = await listActiveGeofences();
    if (!fences.length) {
      return res.status(503).json({ error: { code: 'GEOFENCE_UNCONFIGURED', message: 'La institución aún no configuró zonas de asistencia.' } });
    }

    // Calculate distance to nearest active campus geofence using Haversine
    const nearest = fences
      .map((g) => ({ g, distance: distanceMeters(p.data, g) }))
      .sort((a, b) => a.distance - b.distance)[0];

    // Inside if distance is within the geofence radius
    const inside = nearest.distance <= nearest.g.radius_meters;

    const record = await saveValidation({
      studentId: req.auth.sub,
      sessionId: session.id,
      geofenceId: nearest.g.id,
      distanceMeters: nearest.distance,
      withinRadius: inside,
      accuracyMeters: Math.round(p.data.accuracyMeters),
    });

    return res.json({
      validationId: record.id,
      withinRadius: record.within_radius,
      distanceMeters: record.distance_meters,
      accuracyMeters: record.accuracy_meters,
      geofence: nearest.g.name,
      radiusMeters: nearest.g.radius_meters,
    });
  } catch (e) {
    return next(e);
  }
});

app.get('/sessions/:id/validations', requireRoles('admin', 'teacher'), async (req, res, next) => {
  try {
    await openSession(req.params.id, req.get('authorization').slice(7));
    return res.json(await validationsForSession(req.params.id));
  } catch (e) {
    return next(e);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('location-service request failed:', err);
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status < 500 ? err.message : 'No fue posible procesar la solicitud.',
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(Number(process.env.PORT || 4106), () => console.log('Location service listening'));
}

export default app;
