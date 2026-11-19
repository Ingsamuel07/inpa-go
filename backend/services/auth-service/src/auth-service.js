import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getAuthConfig } from './config.js';
import {
  createRefreshSession,
  createUserAccount,
  findActiveSession,
  findActiveUserByEmail,
  findValidRefreshSession,
  findUserByIdempotencyKey,
  institutionalEmailExists,
  findUserAccount,
  listUserAccounts,
  revokeRefreshSession,
  setUserAccountActive,
  updateUserPassword,
} from './auth-repository.js';
import { generateUniqueInstitutionalEmail } from './institutional-email.js';

const hash = (t) => createHash('sha256').update(t).digest('hex');
const publicUser = (u) => ({ id: u.id, email: u.institutional_email, role: u.role });

function makeAccessToken(user, sessionId) {
  const c = getAuthConfig();
  return jwt.sign({ role: user.role, sid: sessionId }, c.accessSecret, {
    subject: user.id,
    expiresIn: c.accessTtl,
    issuer: 'inpa-go-auth',
  });
}

async function makeRefreshToken(user) {
  const c = getAuthConfig();
  const token = randomBytes(48).toString('base64url');
  const sessionId = await createRefreshSession({
    userId: user.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + c.refreshDays * 86400000).toISOString(),
  });
  return { token, sessionId };
}

async function makeSession(user) {
  const refresh = await makeRefreshToken(user);
  return {
    user: publicUser(user),
    accessToken: makeAccessToken(user, refresh.sessionId),
    refreshToken: refresh.token,
    expiresIn: 900,
  };
}

export async function signIn({ identifier, password }) {
  getAuthConfig();
  const u = await findActiveUserByEmail(identifier);
  if (!u || !await bcrypt.compare(password, u.password_hash)) {
    throw Object.assign(new Error('Credenciales inválidas. Revisa tu correo institucional y contraseña.'), {
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  }
  return makeSession(u);
}

export async function renew(token) {
  getAuthConfig();
  const h = hash(token);
  const s = await findValidRefreshSession(h);
  if (!s || !await revokeRefreshSession(h)) {
    throw Object.assign(new Error('La sesión expiró o ya fue renovada.'), {
      status: 401,
      code: 'INVALID_SESSION',
    });
  }
  return makeSession({ id: s.user_id, institutional_email: s.institutional_email, role: s.role });
}

export async function signOut(token) {
  getAuthConfig();
  await revokeRefreshSession(hash(token));
}

export async function validateAccess(token) {
  const c = getAuthConfig();
  let claims;
  try {
    claims = jwt.verify(token, c.accessSecret, { issuer: 'inpa-go-auth' });
  } catch {
    throw Object.assign(new Error('Token no válido.'), { status: 401, code: 'INVALID_TOKEN' });
  }
  const user = await findActiveSession(claims.sid, claims.sub);
  if (!user) {
    throw Object.assign(new Error('La sesión terminó o fue revocada.'), {
      status: 401,
      code: 'INVALID_SESSION',
    });
  }
  return publicUser(user);
}

export async function provision({ email, fullName, password, role, idempotencyKey }) {
  if (!['admin', 'teacher', 'student'].includes(role)) {
    throw Object.assign(new Error('Rol institucional no válido.'), { status: 400, code: 'INVALID_ROLE' });
  }
  if (idempotencyKey) {
    const existing = await findUserByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  if (role !== 'admin' && fullName) {
    const baseEmail = await generateUniqueInstitutionalEmail(fullName, institutionalEmailExists);
    const [localPart, domain] = baseEmail.split('@');
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const candidate = `${localPart.replace(/\d+$/, '')}${suffix === 1 ? '' : suffix}@${domain}`;
      try {
        return await createUserAccount({ email: candidate, passwordHash, role, idempotencyKey });
      } catch (error) {
        if (error.code !== '23505') throw error;
        const existing = await findUserByIdempotencyKey(idempotencyKey);
        if (existing) return existing;
        if (!await institutionalEmailExists(candidate)) throw error;
      }
    }
    throw Object.assign(new Error('No fue posible asignar un correo institucional único.'), {
      status: 409,
      code: 'EMAIL_COLLISION_LIMIT',
    });
  }
  if (!email) {
    throw Object.assign(new Error('Se requiere un correo institucional para esta cuenta.'), {
      status: 400,
      code: 'INVALID_EMAIL',
    });
  }
  try {
    return await createUserAccount({ email, passwordHash, role, idempotencyKey });
  } catch (error) {
    const existing = error.code === '23505' ? await findUserByIdempotencyKey(idempotencyKey) : null;
    if (existing) return existing;
    if (error.code === '23505') {
      throw Object.assign(new Error('Ya existe una cuenta registrada con ese correo institucional.'), {
        status: 409,
        code: 'EMAIL_EXISTS',
      });
    }
    throw error;
  }
}

// User Registration with Profile linking (RF01)
export async function registerUser({ email, password, role, fullName, institutionalCode }) {
  const account = await provision({ email, password, role });
  
  // Notify user service or create profile
  const userUrl = process.env.USER_SERVICE_URL;
  if (userUrl && process.env.AUTH_INTERNAL_TOKEN) {
    try {
      // User service profiles directory creation
      const internalToken = process.env.AUTH_INTERNAL_TOKEN;
      await fetch(new URL('/internal/profiles', userUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${internalToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: account.id, fullName, institutionalCode, role }),
      }).catch(() => {});
    } catch {}
  }

  return makeSession(account);
}

// Password Change / Reset
export async function changePassword({ email, currentPassword, newPassword }) {
  const u = await findActiveUserByEmail(email);
  if (!u || !await bcrypt.compare(currentPassword, u.password_hash)) {
    throw Object.assign(new Error('La contraseña actual no es correcta.'), {
      status: 401,
      code: 'INVALID_CURRENT_PASSWORD',
    });
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  const updated = await updateUserPassword({ email, newPasswordHash: newHash });
  return { message: 'Contraseña actualizada exitosamente.', email: updated.institutional_email };
}

export async function resetPassword({ email, newPassword }) {
  const u = await findActiveUserByEmail(email);
  if (!u) {
    throw Object.assign(new Error('No existe una cuenta activa con ese correo institucional.'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  const updated = await updateUserPassword({ email, newPasswordHash: newHash });
  return { message: 'Contraseña restablecida exitosamente.', email: updated.institutional_email };
}

export const accounts = () => listUserAccounts();
export const account = (id) => findUserAccount(id);
export const setActive = (id, active) => setUserAccountActive(id, active);
