import { createProfile, findProfile, listProfiles, setProfileActive } from './user-repository.js';

async function authRequest(path, options = {}) {
  const baseUrl = process.env.AUTH_SERVICE_URL;
  const serviceToken = process.env.AUTH_INTERNAL_TOKEN;
  if (!baseUrl || !serviceToken) throw new Error('Auth service URL and internal token are required.');
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload?.error?.message || 'Auth service request failed.');
    error.status = response.status;
    error.code = payload?.error?.code || 'AUTH_SERVICE_ERROR';
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export async function createTeacher({ email, password, fullName, institutionalCode }) {
  const account = await authRequest('/internal/users', {
    method: 'POST', body: JSON.stringify({ email, password, role: 'teacher' }),
  });
  try {
    const profile = await createProfile({ userId: account.id, fullName, institutionalCode, profileType: 'teacher' });
    return { ...account, ...profile };
  } catch (error) {
    await authRequest(`/internal/users/${account.id}/deactivate`, { method: 'PATCH' }).catch(() => {});
    throw error;
  }
}

export async function listUsers() {
  const [accounts, profiles] = await Promise.all([
    authRequest('/internal/users'), listProfiles(),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.user_id, profile]));
  return accounts.map((account) => ({ ...account, profile: profileById.get(account.id) || null }));
}

export async function getUser(userId) {
  const [account, profile] = await Promise.all([
    authRequest(`/internal/users/${userId}`), findProfile(userId),
  ]);
  return { ...account, profile };
}

export async function setUserActive(userId, active) {
  if (!active) {
    await authRequest(`/internal/users/${userId}/deactivate`, { method: 'PATCH' });
    return setProfileActive(userId, false);
  }
  const profile = await setProfileActive(userId, true);
  return profile;
}