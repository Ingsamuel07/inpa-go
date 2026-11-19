import { Platform } from 'react-native';

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;

export function getApiBaseUrl() {
  const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
  const value = typeof configuredApiUrl === 'string' ? configuredApiUrl.trim() : '';

  if (!value) {
    if (isDevelopment && Platform.OS === 'web') return 'http://localhost:4000';
    throw new Error('Configura EXPO_PUBLIC_API_URL con la URL pública HTTPS del API.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL debe ser una URL absoluta válida.');
  }
  if (url.username || url.password) {
    throw new Error('No incluyas credenciales dentro de EXPO_PUBLIC_API_URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('EXPO_PUBLIC_API_URL debe usar HTTP o HTTPS.');
  }

  const localHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  if (!isDevelopment && (url.protocol !== 'https:' || localHosts.includes(url.hostname))) {
    throw new Error('Producción requiere una URL pública HTTPS; no puede apuntar a localhost.');
  }
  if (isDevelopment && Platform.OS !== 'web' && localHosts.includes(url.hostname)) {
    throw new Error('En móvil usa la IP local de tu computador para EXPO_PUBLIC_API_URL, no localhost.');
  }

  return value.replace(/\/+$/, '');
}
