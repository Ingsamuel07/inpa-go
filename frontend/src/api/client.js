import * as SessionStorage from '../auth/storage.js';
import { getApiBaseUrl } from './config.js';

const ACCESS_KEY = 'inpago.access-token';
const REFRESH_KEY = 'inpago.refresh-token';
const USER_KEY = 'inpago.user';
const QUEUE_INDEX_KEY = 'inpago.write-queue.index';
const QUEUE_ENTRY_PREFIX = 'inpago.write-queue.entry.';
const CACHE_PREFIX = 'inpago.read-cache.';
const MAX_PENDING_WRITES = 20;
const MAX_QUEUE_ENTRY_CHARS = 1600;
const MAX_IMPORT_BASE64_CHARS = 1000000;
const IMPORT_CHUNK_CHARS = 1200;
const CACHE_CHUNK_CHARS = 500;
const MAX_QUEUE_ENTRY_BYTES = 1800;
const MAX_CACHE_CHARS = 100000;
let refreshPromise = null;
let queueSyncPromise = null;
const queueListeners = new Set();

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const base = getApiBaseUrl();
      const token = await SessionStorage.getItemAsync(REFRESH_KEY);
      if (!base || !token) throw new Error('Tu sesión terminó. Inicia sesión de nuevo.');
      const response = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Tu sesión terminó.');
      await Promise.all([
        SessionStorage.setItemAsync(ACCESS_KEY, payload.accessToken),
        SessionStorage.setItemAsync(REFRESH_KEY, payload.refreshToken),
      ]);
      return payload.accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function createQueueId() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `pending-${Date.now().toString(36)}-${randomPart}`;
}

async function cacheStorageKey(path, body) {
  const storedUser = await SessionStorage.getItemAsync(USER_KEY);
  const userId = storedUser ? JSON.parse(storedUser)?.id || 'anonymous' : 'anonymous';
  const value = `${userId}:${path}:${body === undefined ? '' : JSON.stringify(body)}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `${CACHE_PREFIX}${(hash >>> 0).toString(36)}`;
}

function utf8ByteLength(value) {
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}/gi, 'x').length;
}

async function cacheReadResponse(path, body, payload) {
  const key = await cacheStorageKey(path, body);
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_CACHE_CHARS) return;
  const metadataKey = `${key}.meta`;
  const oldMetadata = await SessionStorage.getItemAsync(metadataKey);
  const oldCount = oldMetadata ? JSON.parse(oldMetadata).count || 0 : 0;
  const count = Math.ceil(serialized.length / CACHE_CHUNK_CHARS);
  for (let index = 0; index < count; index += 1) {
    await SessionStorage.setItemAsync(
      `${key}.part.${index}`,
      serialized.slice(index * CACHE_CHUNK_CHARS, (index + 1) * CACHE_CHUNK_CHARS)
    );
  }
  await SessionStorage.setItemAsync(metadataKey, JSON.stringify({ count }));
  for (let index = count; index < oldCount; index += 1) {
    await SessionStorage.deleteItemAsync(`${key}.part.${index}`);
  }
}

async function readCachedResponse(path, body) {
  const key = await cacheStorageKey(path, body);
  const metadata = await SessionStorage.getItemAsync(`${key}.meta`);
  if (!metadata) return null;
  const { count } = JSON.parse(metadata);
  if (!Number.isInteger(count) || count < 0 || count > MAX_CACHE_CHARS) {
    throw new Error('La copia local de lectura está dañada.');
  }
  const parts = await Promise.all(
    Array.from({ length: count }, (_, index) => SessionStorage.getItemAsync(`${key}.part.${index}`))
  );
  if (parts.some((part) => part === null)) throw new Error('Falta parte de una copia local.');
  return JSON.parse(parts.join(''));
}

async function offlineRead(path, body) {
  const cached = await readCachedResponse(path, body);
  if (cached === null) {
    throw new Error('No hay conexión con el servidor y no existe una copia local de esta información.');
  }
  return applyPendingWrites(path, cached, body);
}

async function getQueueIds() {
  const value = await SessionStorage.getItemAsync(QUEUE_INDEX_KEY);
  if (!value) return [];
  const ids = JSON.parse(value);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error('La cola de sincronización local está dañada.');
  }
  return ids;
}

async function readPendingWrites() {
  const ids = await getQueueIds();
  const entries = await Promise.all(ids.map(async (id) => {
    const value = await SessionStorage.getItemAsync(`${QUEUE_ENTRY_PREFIX}${id}`);
    if (!value) throw new Error('Falta una operación pendiente en el almacenamiento local.');
    return JSON.parse(value);
  }));
  return entries;
}

async function publishQueueState() {
  const entries = await readPendingWrites();
  const state = {
    pendingCount: entries.length,
    failedCount: entries.filter((entry) => entry.status === 'failed').length,
    syncing: Boolean(queueSyncPromise),
    lastError: entries.find((entry) => entry.error)?.error || '',
  };
  queueListeners.forEach((listener) => listener(state));
  return state;
}

export async function getPendingWriteState() {
  return publishQueueState();
}

export function subscribeToPendingWrites(listener) {
  queueListeners.add(listener);
  publishQueueState().then(listener).catch(() => listener({
    pendingCount: 0,
    failedCount: 0,
    syncing: false,
    lastError: 'No fue posible leer la cola local.',
  }));
  return () => queueListeners.delete(listener);
}

function isQueueableWrite(path, method) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  return !(
    path.startsWith('/auth/') ||
    path === '/users/profiles/lookup' ||
    path === '/location/validate' ||
    path === '/voice/match' ||
    /\/attendance\/sessions\/[^/]+\/check-in(?:\?|$)/.test(path)
  );
}

async function enqueueWrite(path, method, body, headers) {
  const storedUser = await SessionStorage.getItemAsync(USER_KEY);
  if (!storedUser) throw new Error('Inicia sesión para guardar operaciones pendientes.');
  const user = JSON.parse(storedUser);
  if (!user?.id || String(user.id).startsWith('demo-')) {
    throw new Error('Las cuentas de demostración no se sincronizan con Neon. Inicia sesión con una cuenta institucional.');
  }

  const ids = await getQueueIds();
  if (ids.length >= MAX_PENDING_WRITES) {
    throw new Error(`La cola offline está llena (${MAX_PENDING_WRITES} operaciones). Conéctate para sincronizar antes de continuar.`);
  }
  const id = createQueueId();
  const entry = {
    id,
    userId: user.id,
    path,
    method: method.toUpperCase(),
    body: body === undefined ? null : body,
    headers: Object.fromEntries(Object.entries(headers || {}).filter(([key]) => key.toLowerCase() !== 'authorization')),
    createdAt: new Date().toISOString(),
    status: 'pending',
    error: '',
  };
  if (path === '/imports/upload' && method.toUpperCase() === 'POST' && typeof body?.fileBase64 === 'string') {
    if (body.fileBase64.length > MAX_IMPORT_BASE64_CHARS) {
      throw new Error('El archivo supera el límite offline. Conéctate a internet para importarlo.');
    }
    const chunks = [];
    for (let offset = 0; offset < body.fileBase64.length; offset += IMPORT_CHUNK_CHARS) {
      chunks.push(body.fileBase64.slice(offset, offset + IMPORT_CHUNK_CHARS));
    }
    entry.payloadPartCount = chunks.length;
    entry.body = { ...body, fileBase64: undefined };
    for (let index = 0; index < chunks.length; index += 1) {
      await SessionStorage.setItemAsync(`${QUEUE_ENTRY_PREFIX}${id}.part.${index}`, chunks[index]);
    }
    entry.body.fileBase64 = null;
  }
  const serialized = JSON.stringify(entry);
  if (serialized.length > MAX_QUEUE_ENTRY_CHARS || utf8ByteLength(serialized) > MAX_QUEUE_ENTRY_BYTES) {
    for (let index = 0; index < (entry.payloadPartCount || 0); index += 1) {
      await SessionStorage.deleteItemAsync(`${QUEUE_ENTRY_PREFIX}${id}.part.${index}`);
    }
    throw new Error('Esta operación es demasiado grande para guardarse offline. Conéctate a internet e inténtalo de nuevo.');
  }

  await SessionStorage.setItemAsync(`${QUEUE_ENTRY_PREFIX}${id}`, serialized);
  try {
    await SessionStorage.setItemAsync(QUEUE_INDEX_KEY, JSON.stringify([...ids, id]));
  } catch (error) {
    await SessionStorage.deleteItemAsync(`${QUEUE_ENTRY_PREFIX}${id}`);
    for (let index = 0; index < (entry.payloadPartCount || 0); index += 1) {
      await SessionStorage.deleteItemAsync(`${QUEUE_ENTRY_PREFIX}${id}.part.${index}`);
    }
    throw error;
  }
  await publishQueueState();
  return entry;
}

function emailPreview(fullName) {
  const parts = String(fullName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (['prof', 'profesor', 'profesora', 'dr', 'dra', 'doctor', 'doctora', 'ing', 'lic'].includes(parts[0])) {
    parts.shift();
  }
  if (!parts.length) return '';
  return `${parts[0]}.${parts[parts.length - 1] || parts[0]}@uninpahu.edu.co`;
}

function makeQueuedResult(entry) {
  const { path, method, id } = entry;
  const body = entry.body || {};
  if (method === 'POST' && /^\/users\/(students|teachers|admins)$/.test(path)) {
    const role = path.endsWith('/teachers') ? 'teacher' : path.endsWith('/admins') ? 'admin' : 'student';
    return {
      id,
      institutional_email: role === 'admin' ? body.email : emailPreview(body.fullName),
      email: role === 'admin' ? body.email : emailPreview(body.fullName),
      role,
      active: true,
      profile: { full_name: body.fullName, institutional_code: body.institutionalCode },
      pendingSync: true,
    };
  }
  if (method === 'POST' && path === '/academic/courses') {
    return { id, code: body.code, name: body.name, active: true, pendingSync: true };
  }
  if (method === 'POST' && path === '/academic/groups') {
    return {
      id,
      course_id: body.courseId,
      code: body.code,
      term: body.term,
      active: true,
      pendingSync: true,
    };
  }
  if (method === 'POST' && path === '/attendance/sessions') {
    return { id, group_id: body.groupId, status: 'open', starts_at: entry.createdAt, pendingSync: true };
  }
  if (method === 'PATCH' && /\/attendance\/sessions\/[^/]+\/(pause|resume|close)$/.test(path)) {
    const [, sessionId, action] = path.match(/\/attendance\/sessions\/([^/]+)\/(pause|resume|close)$/);
    return { id: sessionId, status: { pause: 'paused', resume: 'open', close: 'closed' }[action], pendingSync: true };
  }
  if (method === 'PUT' && /\/attendance\/sessions\/[^/]+\/records$/.test(path)) {
    return { student_user_id: body.studentUserId, status: body.status, pendingSync: true };
  }
  if (method === 'PATCH' && /^\/users\/[^/]+\/status$/.test(path)) {
    return { id: path.split('/')[2], active: body.active, pendingSync: true };
  }
  if (method === 'POST' && path === '/imports/upload') {
    return {
      batchId: id,
      fileName: body.fileName || 'archivo.xlsx',
      status: 'pending',
      totalRows: 0,
      acceptedRows: 0,
      rejectedRows: 0,
      errors: [],
      pendingSync: true,
    };
  }
  return { id, pendingSync: true };
}

function replaceReference(value, oldId, newId) {
  if (typeof value === 'string') return value === oldId ? newId : value.split(oldId).join(newId);
  if (Array.isArray(value)) return value.map((item) => replaceReference(item, oldId, newId));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReference(item, oldId, newId)]));
}

async function removeSyncedEntry(entry, result) {
  const ids = await getQueueIds();
  const remainingIds = ids.filter((id) => id !== entry.id);
  const createdId = result?.id || result?.user_id || result?.profile?.user_id;
  for (const id of remainingIds) {
    const key = `${QUEUE_ENTRY_PREFIX}${id}`;
    const serialized = await SessionStorage.getItemAsync(key);
    if (!serialized) continue;
    const pending = JSON.parse(serialized);
    const rewritten = {
      ...pending,
      path: createdId ? replaceReference(pending.path, entry.id, createdId) : pending.path,
      body: createdId ? replaceReference(pending.body, entry.id, createdId) : pending.body,
    };
    await SessionStorage.setItemAsync(key, JSON.stringify(rewritten));
  }
  await SessionStorage.setItemAsync(QUEUE_INDEX_KEY, JSON.stringify(remainingIds));
  await SessionStorage.deleteItemAsync(`${QUEUE_ENTRY_PREFIX}${entry.id}`);
  for (let index = 0; index < (entry.payloadPartCount || 0); index += 1) {
    await SessionStorage.deleteItemAsync(`${QUEUE_ENTRY_PREFIX}${entry.id}.part.${index}`);
  }
}

async function markWriteFailed(entry, error) {
  const failed = { ...entry, status: 'failed', error: error.message || 'No fue posible sincronizar la operación.' };
  await SessionStorage.setItemAsync(`${QUEUE_ENTRY_PREFIX}${entry.id}`, JSON.stringify(failed));
  await publishQueueState();
}

export async function syncPendingWrites({ retryFailed = false } = {}) {
  if (queueSyncPromise) return queueSyncPromise;
  queueSyncPromise = (async () => {
    const entries = await readPendingWrites();
    const storedUser = await SessionStorage.getItemAsync(USER_KEY);
    const user = storedUser ? JSON.parse(storedUser) : null;
    if (!user?.id || String(user.id).startsWith('demo-')) return;

    for (const queuedEntry of entries) {
      const currentValue = await SessionStorage.getItemAsync(`${QUEUE_ENTRY_PREFIX}${queuedEntry.id}`);
      if (!currentValue) continue;
      const entry = JSON.parse(currentValue);
      if (entry.userId !== user.id) continue;
      if (entry.status === 'failed') {
        if (!retryFailed) break;
        entry.status = 'pending';
        entry.error = '';
        await SessionStorage.setItemAsync(`${QUEUE_ENTRY_PREFIX}${entry.id}`, JSON.stringify(entry));
      }
      const base = getApiBaseUrl();
      let token = await SessionStorage.getItemAsync(ACCESS_KEY);
      let requestBody = entry.body;
      if (entry.payloadPartCount) {
        const chunks = await Promise.all(
          Array.from({ length: entry.payloadPartCount }, (_, index) =>
            SessionStorage.getItemAsync(`${QUEUE_ENTRY_PREFIX}${entry.id}.part.${index}`)
          )
        );
        if (chunks.some((chunk) => chunk === null)) {
          await markWriteFailed(entry, new Error('Falta parte del archivo importado en el almacenamiento local.'));
          break;
        }
        requestBody = { ...entry.body, fileBase64: chunks.join('') };
      }
      const send = () => fetch(`${base}${entry.path}`, {
        method: entry.method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json',
          ...entry.headers,
          'x-idempotency-key': entry.id,
        },
        body: requestBody === null ? undefined : JSON.stringify(requestBody),
      });
      try {
        let response = await send();
        if (response.status === 401) {
          token = await refreshSession();
          response = await send();
        }
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          const error = new Error(result?.error?.message || 'No fue posible sincronizar la operación pendiente.');
          if (response.status >= 400 && response.status < 500) await markWriteFailed(entry, error);
          else {
            await SessionStorage.setItemAsync(`${QUEUE_ENTRY_PREFIX}${entry.id}`, JSON.stringify({
              ...entry,
              error: error.message,
            }));
            await publishQueueState();
          }
          break;
        }
        await removeSyncedEntry(entry, result);
        await publishQueueState();
      } catch (error) {
        await SessionStorage.setItemAsync(`${QUEUE_ENTRY_PREFIX}${entry.id}`, JSON.stringify({
          ...entry,
          error: error.message || 'Sin conexión; se reintentará automáticamente.',
        }));
        await publishQueueState();
        break;
      }
    }
  })().finally(() => {
    queueSyncPromise = null;
    publishQueueState().catch(() => {});
  });
  await publishQueueState();
  return queueSyncPromise;
}

async function applyPendingWrites(path, result, requestBody) {
  const storedUser = await SessionStorage.getItemAsync(USER_KEY);
  const userId = storedUser ? JSON.parse(storedUser)?.id : null;
  const entries = (await readPendingWrites()).filter((entry) => entry.userId === userId);
  if (path === '/users/profiles/lookup' && Array.isArray(result)) {
    const userIds = requestBody?.userIds || [];
    const users = entries
      .filter((entry) => entry.method === 'POST' && /^\/users\/(students|teachers)$/.test(entry.path))
      .map(makeQueuedResult)
      .filter((user) => userIds.includes(user.id))
      .map((user) => ({
        user_id: user.id,
        full_name: user.profile.full_name,
        institutional_code: user.profile.institutional_code,
      }));
    return [...users, ...result];
  }
  if (path === '/users' && Array.isArray(result)) {
    const users = [...result];
    for (const entry of entries) {
      if (entry.method === 'POST' && /^\/users\/(students|teachers|admins)$/.test(entry.path)) {
        const pending = makeQueuedResult(entry);
        if (!users.some((user) => user.id === pending.id)) users.unshift(pending);
      } else if (entry.method === 'PATCH' && entry.path.startsWith('/users/') && entry.path.endsWith('/status')) {
        const target = users.find((user) => user.id === entry.path.split('/')[2]);
        if (target) target.active = entry.body?.active;
      }
    }
    return users;
  }
  if (path === '/academic/courses' && Array.isArray(result)) {
    return [...entries.filter((entry) => entry.method === 'POST' && entry.path === path).map(makeQueuedResult), ...result];
  }
  if (path === '/academic/groups' && Array.isArray(result)) {
    const queuedCourses = entries.filter((entry) => entry.method === 'POST' && entry.path === '/academic/courses');
    const pendingGroups = entries
      .filter((entry) => entry.method === 'POST' && entry.path === path)
      .map((entry) => {
        const group = makeQueuedResult(entry);
        const course = queuedCourses.find((item) => item.id === entry.body?.courseId);
        return {
          ...group,
          course_name: course?.body?.name || 'Asignatura pendiente',
          course_code: course?.body?.code || '—',
        };
      });
    return [...pendingGroups, ...result];
  }
  const userPath = path.match(/^\/users\/([^/?]+)$/);
  if (userPath && result === null) {
    const userEntry = entries.find((entry) => entry.id === userPath[1] && entry.method === 'POST');
    return userEntry ? makeQueuedResult(userEntry) : result;
  }
  if (path.startsWith('/academic/groups/') && path.endsWith('/students') && Array.isArray(result)) {
    const groupId = path.split('/')[3];
    const students = [...result];
    for (const entry of entries) {
      if (entry.method === 'POST' && entry.path === '/academic/enrollments' && entry.body?.groupId === groupId) {
        if (!students.some((student) => student.studentId === entry.body.studentUserId)) {
          students.push({ studentId: entry.body.studentUserId, pendingSync: true });
        }
      }
    }
    return students;
  }
  const attendanceRecordsPath = path.match(/^\/attendance\/sessions\/([^/]+)\/records$/);
  if (attendanceRecordsPath && Array.isArray(result)) {
    const records = [...result];
    for (const entry of entries) {
      if (entry.method === 'PUT' && entry.path === path) {
        const index = records.findIndex((record) => record.student_user_id === entry.body?.studentUserId);
        const pending = makeQueuedResult(entry);
        if (index >= 0) records[index] = pending;
        else records.push(pending);
      }
    }
    return records;
  }
  if (path.startsWith('/attendance/sessions') && path.includes('groupId=') && Array.isArray(result)) {
    const groupId = new URLSearchParams(path.split('?')[1] || '').get('groupId');
    const sessions = [...result];
    for (const entry of entries) {
      if (entry.method === 'POST' && entry.path === '/attendance/sessions' && entry.body?.groupId === groupId) {
        sessions.unshift(makeQueuedResult(entry));
      }
      const match = entry.path.match(/^\/attendance\/sessions\/([^/]+)\/(pause|resume|close)$/);
      if (entry.method === 'PATCH' && match) {
        const target = sessions.find((session) => session.id === match[1]);
        if (target) target.status = { pause: 'paused', resume: 'open', close: 'closed' }[match[2]];
      }
    }
    return sessions;
  }
  if (path === '/imports/batches' && Array.isArray(result)) {
    const pending = entries.filter((entry) => entry.method === 'POST' && entry.path === '/imports/upload').map((entry) => {
      const item = makeQueuedResult(entry);
      return { id: item.batchId, file_name: item.fileName, status: item.status, total_rows: 0, accepted_rows: 0, rejected_rows: 0, created_at: entry.createdAt, pendingSync: true };
    });
    return [...pending, ...result];
  }
  return result;
}

export async function apiRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const base = getApiBaseUrl();

  if (isQueueableWrite(path, method)) {
    await syncPendingWrites();
    const storedUser = await SessionStorage.getItemAsync(USER_KEY);
    const userId = storedUser ? JSON.parse(storedUser)?.id : null;
    const unresolved = (await readPendingWrites()).filter((entry) => entry.userId === userId);
    if (unresolved.length) {
      const entry = await enqueueWrite(path, method, body, headers);
      return makeQueuedResult(entry);
    }
  }

  const send = (token) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let token = await SessionStorage.getItemAsync(ACCESS_KEY);

  let response;
  try {
    response = await send(token);
  } catch (networkError) {
    if (isQueueableWrite(path, method)) {
      const entry = await enqueueWrite(path, method, body, headers);
      return makeQueuedResult(entry);
    }
    if (path === '/users/profiles/lookup' && method.toUpperCase() === 'POST') {
      return offlineRead(path, body);
    }
    if (method.toUpperCase() === 'GET') {
      return offlineRead(path, body);
    }
    throw networkError;
  }

  if (response.status === 401) {
    token = await refreshSession();
    response = await send(token);
  }
  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status >= 500 && isQueueableWrite(path, method)) {
      const entry = await enqueueWrite(path, method, body, headers);
      return makeQueuedResult(entry);
    }
    if (response.status >= 500 && method.toUpperCase() === 'GET') {
      return offlineRead(path, body);
    }
    if (response.status >= 500 && path === '/users/profiles/lookup' && method.toUpperCase() === 'POST') {
      return offlineRead(path, body);
    }
    throw new Error(payload?.error?.message || 'No fue posible completar la solicitud.');
  }
  if (method.toUpperCase() === 'GET' || path === '/users/profiles/lookup') {
    try {
      await cacheReadResponse(path, body, payload);
    } catch (error) {
      console.warn('No fue posible guardar la copia offline:', error.message);
    }
    return applyPendingWrites(path, payload, body);
  }
  return payload;
}
