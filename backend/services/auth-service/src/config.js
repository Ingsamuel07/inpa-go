export function getAuthConfig() {
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  if (!process.env.AUTH_DATABASE_URL) throw new Error('AUTH_DATABASE_URL is required.');
  if (!accessSecret || accessSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters.');
  return { accessSecret, accessTtl: '15m', refreshDays: 14 };
}