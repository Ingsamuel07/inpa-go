import jwt from 'jsonwebtoken';
const cache = new Map();
const CACHE_MS = 3000;
export async function authenticate(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token || !process.env.JWT_ACCESS_SECRET || !process.env.AUTH_SERVICE_URL) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Inicia sesión para continuar.' } });
  let claims;
  try { claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { issuer: 'inpa-go-auth' }); }
  catch { return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'La sesión no es válida.' } }); }
  const cached = cache.get(claims.sid);
  if (cached && cached.until > Date.now()) {
    if (!cached.user) return res.status(401).json({ error: { code: 'INVALID_SESSION', message: 'La sesión terminó.' } });
    req.auth = { ...claims, role: cached.user.role }; return next();
  }
  try {
    const response = await fetch(`${process.env.AUTH_SERVICE_URL.replace(/\/$/, '')}/introspect`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1800) });
    if (response.status === 401) { cache.set(claims.sid, { user: null, until: Date.now() + CACHE_MS }); return res.status(401).json({ error: { code: 'INVALID_SESSION', message: 'La sesión terminó.' } }); }
    if (!response.ok) throw new Error('Auth service unavailable');
    const data = await response.json(); cache.set(claims.sid, { user: data.user, until: Date.now() + CACHE_MS }); req.auth = { ...claims, role: data.user.role }; return next();
  } catch { return res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'No se pudo validar la sesión. Intenta de nuevo.' } }); }
}
export function requireRoles(...roles) { return (req, res, next) => { if (!req.auth || !roles.includes(req.auth.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No tienes permiso para esta operación.' } }); return next(); }; }