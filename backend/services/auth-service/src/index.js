import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './auth-routes.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth-service' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(authRoutes);
app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error('auth-service request failed', { code: error.code || 'INTERNAL_ERROR' });
  res.status(status).json({ error: { code: error.code || 'INTERNAL_ERROR', message: status < 500 ? error.message : 'No fue posible procesar la solicitud.' } });
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') app.listen(Number(process.env.PORT || 4101), () => console.log('Auth service listening'));
export default app;