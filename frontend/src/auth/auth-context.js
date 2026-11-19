import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SessionStorage from './storage.js';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState, Platform } from 'react-native';
import { subscribeToPendingWrites, syncPendingWrites } from '../api/client.js';
import { getApiBaseUrl } from '../api/config.js';

const AuthContext = createContext(null);
const ACCESS_KEY = 'inpago.access-token';
const REFRESH_KEY = 'inpago.refresh-token';
const USER_KEY = 'inpago.user';
const BIOMETRIC_KEY = 'inpago.biometric-enabled';

function isDemoAccount(user) {
  return String(user?.id || '').startsWith('demo-');
}

async function persistSession(session) {
  await Promise.all([
    SessionStorage.setItemAsync(ACCESS_KEY, session.accessToken),
    SessionStorage.setItemAsync(REFRESH_KEY, session.refreshToken),
    SessionStorage.setItemAsync(USER_KEY, JSON.stringify(session.user)),
  ]);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [offlineSync, setOfflineSync] = useState({
    pendingCount: 0,
    failedCount: 0,
    syncing: false,
    lastError: '',
  });

  useEffect(() => subscribeToPendingWrites(setOfflineSync), []);

  useEffect(() => {
    if (user && !isDemoAccount(user)) {
      syncPendingWrites().catch((error) => {
        setOfflineSync((state) => ({ ...state, lastError: error.message }));
      });
    }

    const onForeground = (state) => {
      if (state === 'active') {
        syncPendingWrites().catch((error) => {
          setOfflineSync((current) => ({ ...current, lastError: error.message }));
        });
      }
    };
    const appStateSubscription = AppState.addEventListener('change', onForeground);
    const onOnline = () => {
      syncPendingWrites().catch((error) => {
        setOfflineSync((current) => ({ ...current, lastError: error.message }));
      });
    };
    const supportsOnlineEvents =
      typeof window !== 'undefined' && typeof window.addEventListener === 'function';
    if (supportsOnlineEvents) window.addEventListener('online', onOnline);
    return () => {
      appStateSubscription.remove();
      if (supportsOnlineEvents && typeof window.removeEventListener === 'function') {
        window.removeEventListener('online', onOnline);
      }
    };
  }, [user?.id]);

  // Rehidratar sesión guardada al abrir la app
  useEffect(() => {
    async function rehydrateSession() {
      try {
        const storedUser = await SessionStorage.getItemAsync(USER_KEY);
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
          if (isDemoAccount(parsed)) {
            await Promise.all([
              SessionStorage.deleteItemAsync(ACCESS_KEY),
              SessionStorage.deleteItemAsync(REFRESH_KEY),
              SessionStorage.deleteItemAsync(USER_KEY),
              SessionStorage.deleteItemAsync(BIOMETRIC_KEY),
            ]);
          } else {
            setUser(parsed);
          }
        }
      } catch (e) {
        console.warn('Error rehidratando sesión:', e);
      } finally {
        setInitializing(false);
      }
    }
    rehydrateSession();
  }, []);

  async function signIn(identifier, password) {
    const apiUrl = getApiBaseUrl();
    setLoading(true);
    const cleanEmail = identifier.trim().toLowerCase();

    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: cleanEmail, password }),
      });

      const session = await response.json();
      if (!response.ok) {
        throw new Error(session?.error?.message || 'Credenciales inválidas.');
      }
      await persistSession(session);
      setUser(session.user);
      return session.user;
    } catch (error) {
      if (error instanceof TypeError || error.message?.toLowerCase().includes('fetch')) {
        throw new Error('No fue posible conectar con el API. Verifica la URL pública y la conexión a internet.');
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function register(data) {
    const apiUrl = getApiBaseUrl();
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });

      const session = await response.json();
      if (!response.ok) {
        throw new Error(session?.error?.message || 'Fallo al registrar usuario.');
      }
      await persistSession(session);
      setUser(session.user);
      return session.user;
    } catch (networkError) {
      if (networkError instanceof TypeError || networkError.message?.toLowerCase().includes('fetch')) {
        throw new Error('El registro requiere conexión para confirmar el alta en Neon. Vuelve a intentarlo cuando tengas internet.');
      }
      throw networkError;
    } finally {
      setLoading(false);
    }
  }

  async function resetOrChangePassword({ email, currentPassword, newPassword }) {
    const apiUrl = getApiBaseUrl();
    setLoading(true);
    try {
      const endpoint = currentPassword ? '/auth/change-password' : '/auth/reset-password';
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase(), currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Fallo al actualizar contraseña.');
      }
      return data;
    } catch (error) {
      throw error instanceof TypeError
        ? new Error('Se requiere conexión para actualizar la contraseña.')
        : error;
    } finally {
      setLoading(false);
    }
  }

  // Activar biometría real en el dispositivo
  async function enableBiometrics() {
    // 1. En Web (PC): WebAuthn o aviso de simulación
    if (Platform.OS === 'web') {
      await SessionStorage.setItemAsync(BIOMETRIC_KEY, 'true');
      return true;
    }

    // 2. En Móvil Real (Android / iOS):
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      throw new Error('Este dispositivo no posee sensor biométrico de huella o rostro.');
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      throw new Error('No tienes huellas o rostro registrados en los ajustes de seguridad de tu teléfono. Registra una huella en Android/iOS primero.');
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Vincular huella dactilar para INPAHU-GO',
      cancelLabel: 'Cancelar',
      disableDeviceFallback: false,
    });

    if (!result.success) {
      throw new Error('Verificación biométrica cancelada o no reconocida.');
    }

    await SessionStorage.setItemAsync(BIOMETRIC_KEY, 'true');
    return true;
  }

  // Iniciar sesión con biometría real
  async function signInWithBiometrics() {
    // 1. En Móvil (Android/iOS): Sensor biométrico nativo real
    if (Platform.OS !== 'web') {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        throw new Error('Este celular no tiene lector de huella/rostro.');
      }
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        throw new Error('Debes configurar tu huella en los Ajustes del celular antes de usarla en la app.');
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Identifícate con tu huella digital para INPAHU-GO',
        cancelLabel: 'Usar contraseña',
        disableDeviceFallback: false,
      });

      if (!result.success) {
        throw new Error('Huella no reconocida o verificación cancelada.');
      }
    }

    // 2. Si el sensor físico aprobó la identidad (o en Web se tiene sesión previa guardada):
    const storedUser = await SessionStorage.getItemAsync(USER_KEY);
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      if (isDemoAccount(parsed)) {
        await Promise.all([
          SessionStorage.deleteItemAsync(ACCESS_KEY),
          SessionStorage.deleteItemAsync(REFRESH_KEY),
          SessionStorage.deleteItemAsync(USER_KEY),
          SessionStorage.deleteItemAsync(BIOMETRIC_KEY),
        ]);
        throw new Error('Las sesiones de demostración fueron eliminadas. Inicia sesión con tu cuenta institucional.');
      }
      setUser(parsed);
      return parsed;
    }

    // Si aún no había ninguna sesión guardada en este dispositivo:
    throw new Error('Para usar tu huella dactilar, primero debes iniciar sesión una vez con tu correo y contraseña en este dispositivo.');
  }

  async function signOut() {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    const refreshToken = await SessionStorage.getItemAsync(REFRESH_KEY);
    try {
      if (apiUrl && refreshToken) {
        await fetch(`${apiUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {});
      }
    } finally {
      await Promise.all([
        SessionStorage.deleteItemAsync(ACCESS_KEY),
        SessionStorage.deleteItemAsync(REFRESH_KEY),
        SessionStorage.deleteItemAsync(USER_KEY),
      ]);
      setUser(null);
    }
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      initializing,
      offlineSync,
      syncPendingWrites,
      signIn,
      register,
      resetOrChangePassword,
      signInWithBiometrics,
      enableBiometrics,
      signOut,
    }),
    [user, loading, initializing, offlineSync]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
