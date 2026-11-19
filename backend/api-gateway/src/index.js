import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

if (isProduction) {
  if (!allowedOrigins.length || allowedOrigins.includes('*')) {
    throw new Error('Production requires explicit HTTPS origins in CORS_ORIGINS.');
  }
  for (const origin of allowedOrigins) {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin) {
      throw new Error('Every production CORS_ORIGINS entry must be an HTTPS origin without a path.');
    }
  }
}

const routes = [
  ['/auth', 'AUTH_SERVICE_URL'],
  ['/users', 'USER_SERVICE_URL'],
  ['/academic', 'ACADEMIC_SERVICE_URL'],
  ['/attendance', 'ATTENDANCE_SERVICE_URL'],
  ['/voice', 'VOICE_SERVICE_URL'],
  ['/location', 'LOCATION_SERVICE_URL'],
  ['/imports', 'IMPORT_SERVICE_URL'],
  ['/reports', 'REPORT_SERVICE_URL'],
];

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
]);

app.disable('x-powered-by');
app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed'));
    },
    credentials: true,
  })
);

app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || randomUUID();
  res.set('x-request-id', req.requestId);
  next();
});

// Global Rate Limiting: 500 requests per minute
app.use(rateLimit({ windowMs: 60_000, limit: 500, standardHeaders: 'draft-8', legacyHeaders: false }));

// Health Check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() }));

// Proxy routing to microservices
for (const [prefix, environmentKey] of routes) {
  app.use(prefix, async (req, res) => {
    const rawTarget = process.env[environmentKey];
    if (!rawTarget) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `El microservicio (${prefix}) no está configurado o no se encuentra disponible.`,
          requestId: req.requestId,
        },
      });
    }

    try {
      const base = new URL(rawTarget);
      if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Unsupported upstream protocol.');

      const subPath = req.originalUrl.slice(prefix.length) || '/';
      const cleanSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
      const upstreamUrl = new URL(base.pathname.replace(/\/$/, '') + cleanSubPath, base.origin);

      const headers = new Headers();
      for (const name of ['accept', 'authorization', 'content-type', 'x-request-id', 'x-idempotency-key']) {
        const value = req.get(name);
        if (value) headers.set(name, name === 'x-request-id' ? req.requestId : value);
      }

      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const isImportOrReport = prefix === '/imports' || prefix === '/reports';

      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        signal: AbortSignal.timeout(isImportOrReport ? 30000 : 8000), // Extended timeout for PDF and Excel processing
        redirect: 'manual',
        cache: 'no-store',
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        if (!hopByHop.has(name.toLowerCase())) res.setHeader(name, value);
      });

      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch (error) {
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      res.status(timeout ? 504 : 502).json({
        error: {
          code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILURE',
          message: 'No fue posible completar la solicitud con el servicio.',
          requestId: req.requestId,
        },
      });
    }
  });
}

app.use((error, req, res, _next) => {
  const status = error.message === 'Origin not allowed' ? 403 : 500;
  res.status(status).json({
    error: {
      code: 'GATEWAY_ERROR',
      message: 'No fue posible completar la solicitud en el API Gateway.',
      requestId: req.requestId,
    },
  });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.API_GATEWAY_PORT || 4000);
  app.listen(port, () => console.log(`API Gateway listening on port ${port}`));
}

export default app;
