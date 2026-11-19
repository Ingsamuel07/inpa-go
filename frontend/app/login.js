import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as SessionStorage from '../src/auth/storage.js';
import { useAuth } from '../src/auth/auth-context.js';

const REFRESH_KEY = 'inpago.refresh-token';
const BIOMETRIC_KEY = 'inpago.biometric-enabled';

export default function LoginScreen() {
  const router = useRouter();
  const { loading, signIn, register, resetOrChangePassword, signInWithBiometrics } = useAuth();

  // Active Tab: 'login' | 'register' | 'forgot'
  const [activeTab, setActiveTab] = useState('login');

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Register form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regCode, setRegCode] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Password reset/change form state
  const [resetEmail, setResetEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Status & feedback
  const [message, setMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const cardProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Promise.all([SessionStorage.getItemAsync(REFRESH_KEY), SessionStorage.getItemAsync(BIOMETRIC_KEY)])
      .then(([token, enabled]) => setHasSavedSession(Boolean(token) && enabled === 'true'))
      .catch(() => setHasSavedSession(false));
    Animated.timing(cardProgress, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, []);

  function openRoleHome(user) {
    const route = { admin: '/admin', teacher: '/teacher', student: '/student' }[user.role];
    if (route) {
      router.replace(route);
    } else {
      setMessage('La cuenta no tiene un rol institucional habilitado.');
    }
  }

  // 1. Handle Sign In
  async function handleSignIn() {
    if (!identifier || !password) {
      setMessage('Por favor ingresa tu correo y contraseña.');
      return;
    }
    setMessage('');
    setSuccessMessage('');
    try {
      const loggedUser = await signIn(identifier, password);
      openRoleHome(loggedUser);
    } catch (error) {
      setMessage(error.message || 'Error de autenticación.');
    }
  }

  // 2. Handle Self Registration
  async function handleRegister() {
    if (!regName || !regEmail || !regCode || !regPassword) {
      setMessage('Por favor completa todos los campos del registro.');
      return;
    }
    if (regPassword.length < 8) {
      setMessage('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setMessage('');
    setSuccessMessage('');
    try {
      const newUser = await register({
        fullName: regName,
        email: regEmail,
        institutionalCode: regCode,
        password: regPassword,
      });
      setSuccessMessage('¡Registro completado exitosamente! Ingresando...');
      setTimeout(() => openRoleHome(newUser), 800);
    } catch (error) {
      setMessage(error.message || 'No fue posible completar el registro.');
    }
  }

  // 3. Handle Password Reset / Change
  async function handleResetPassword() {
    if (!resetEmail || !newPassword) {
      setMessage('Ingresa tu correo institucional y la nueva contraseña.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setMessage('Las nuevas contraseñas no coinciden.');
      return;
    }
    setMessage('');
    setSuccessMessage('');
    try {
      const res = await resetOrChangePassword({
        email: resetEmail,
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      setSuccessMessage(res.message || 'Contraseña actualizada. Ya puedes iniciar sesión.');
      setTimeout(() => {
        setIdentifier(resetEmail);
        setPassword(newPassword);
        setActiveTab('login');
      }, 1500);
    } catch (error) {
      setMessage(error.message || 'Fallo al actualizar la contraseña.');
    }
  }

  async function handleBiometricSignIn() {
    setMessage('');
    setSuccessMessage('');
    if (Platform.OS === 'web') {
      setMessage('El sensor de huella/Face ID está disponible únicamente en Android e iOS.');
      return;
    }
    try {
      const user = await signInWithBiometrics();
      if (user) openRoleHome(user);
    } catch (error) {
      setMessage(error.message || 'No fue posible validar la biometría en este dispositivo.');
    }
  }

  return (
    <View style={styles.outerWrapper}>
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Main Card (Constrained for Desktop & Beautiful on Mobile) */}
        <Animated.View
          style={[
            styles.cardContainer,
            {
              opacity: cardProgress,
              transform: [{ translateY: cardProgress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
            },
          ]}
        >
          {/* Official Logo Banner */}
          <View style={styles.logoHeader}>
            <Image
              source={require('../assets/logo.jpg')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.appSubtitle}>
              Sistema Inteligente de Validación y Asistencia Académica
            </Text>
            <Text style={styles.institutionName}>Fundación Universitaria INPAHU</Text>
          </View>

          {/* Navigation Tabs */}
          <View style={styles.tabContainer}>
            <Pressable
              style={({ pressed }) => [styles.tabButton, activeTab === 'login' && styles.tabButtonActive, pressed && styles.pressed]}
              onPress={() => {
                setActiveTab('login');
                setMessage('');
              }}
            >
              <Text style={[styles.tabButtonText, activeTab === 'login' && styles.tabButtonTextActive]}>
                Ingresar
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.tabButton, activeTab === 'register' && styles.tabButtonActive, pressed && styles.pressed]}
              onPress={() => {
                setActiveTab('register');
                setMessage('');
              }}
            >
              <Text style={[styles.tabButtonText, activeTab === 'register' && styles.tabButtonTextActive]}>
                Registro
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.tabButton, activeTab === 'forgot' && styles.tabButtonActive, pressed && styles.pressed]}
              onPress={() => {
                setActiveTab('forgot');
                setMessage('');
              }}
            >
              <Text style={[styles.tabButtonText, activeTab === 'forgot' && styles.tabButtonTextActive]}>
                Cambiar Clave
              </Text>
            </Pressable>
          </View>

          {/* Feedback Messages */}
          {!!message && (
            <View style={styles.errorAlert}>
              <Text style={styles.errorAlertText}>{message}</Text>
            </View>
          )}
          {!!successMessage && (
            <View style={styles.successAlert}>
              <Text style={styles.successAlertText}>{successMessage}</Text>
            </View>
          )}

          {/* ================================================================ */}
          {/* TAB 1: INICIAR SESIÓN */}
          {/* ================================================================ */}
          {activeTab === 'login' && (
            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Correo Institucional</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="ejemplo@uninpahu.edu.co"
                placeholderTextColor="#94A3B8"
                value={identifier}
                onChangeText={setIdentifier}
              />

              <Text style={styles.fieldLabel}>Contraseña</Text>
              <TextInput
                style={styles.input}
                placeholder="Tu contraseña institucional"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <Pressable style={styles.primaryButton} onPress={handleSignIn} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Iniciar Sesión</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* ================================================================ */}
          {/* TAB 2: REGISTRO INSTITUCIONAL */}
          {/* ================================================================ */}
          {activeTab === 'register' && (
            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Nombre Completo</Text>
              <TextInput
                style={styles.input}
                placeholder="Nombres y Apellidos"
                placeholderTextColor="#94A3B8"
                value={regName}
                onChangeText={setRegName}
              />

              <Text style={styles.fieldLabel}>Correo Institucional</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="estudiante@uninpahu.edu.co"
                placeholderTextColor="#94A3B8"
                value={regEmail}
                onChangeText={setRegEmail}
              />

              <Text style={styles.fieldLabel}>Código Institucional</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej: EST-2026-088"
                placeholderTextColor="#94A3B8"
                value={regCode}
                onChangeText={setRegCode}
              />

              <Text style={styles.fieldLabel}>Contraseña (mínimo 8 caracteres)</Text>
              <TextInput
                style={styles.input}
                placeholder="Crea una contraseña segura"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                value={regPassword}
                onChangeText={setRegPassword}
              />

              <Pressable style={styles.primaryButton} onPress={handleRegister} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Completar Registro</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* ================================================================ */}
          {/* TAB 3: CAMBIAR / RECUPERAR CONTRASEÑA */}
          {/* ================================================================ */}
          {activeTab === 'forgot' && (
            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Correo Institucional Registrado</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="correo@uninpahu.edu.co"
                placeholderTextColor="#94A3B8"
                value={resetEmail}
                onChangeText={setResetEmail}
              />

              <Text style={styles.fieldLabel}>Contraseña Actual (Opcional si es recuperación)</Text>
              <TextInput
                style={styles.input}
                placeholder="Contraseña anterior"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                value={currentPassword}
                onChangeText={setCurrentPassword}
              />

              <Text style={styles.fieldLabel}>Nueva Contraseña</Text>
              <TextInput
                style={styles.input}
                placeholder="Mínimo 8 caracteres"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
              />

              <Text style={styles.fieldLabel}>Confirmar Nueva Contraseña</Text>
              <TextInput
                style={styles.input}
                placeholder="Repite la nueva contraseña"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
              />

              <Pressable style={styles.primaryButton} onPress={handleResetPassword} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Actualizar Contraseña</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Footer note */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Inpa_Go · UNINPAHU 2026 · Protección de Datos Personales
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    flex: 1,
    backgroundColor: '#07152F', // Deep Navy Blue institutional background
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 480, // Constrained width on PC so it never stretches!
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  logoHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: 240,
    height: 70,
    marginBottom: 8,
  },
  appSubtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#07152F',
    textAlign: 'center',
    marginTop: 2,
  },
  institutionName: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  tabButtonTextActive: {
    color: '#07152F',
    fontWeight: '800',
  },
  errorAlert: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorAlertText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  successAlert: {
    backgroundColor: '#F0FDF4',
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  successAlertText: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  formSection: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: '#07152F',
    marginBottom: 12,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  roleSelectBtn: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  roleSelectBtnActive: {
    borderColor: '#F0440B',
    backgroundColor: '#FFF7ED',
  },
  roleSelectText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  roleSelectTextActive: {
    color: '#C2410C',
    fontWeight: '800',
  },
  primaryButton: {
    backgroundColor: '#F0440B', // UNINPAHU Vibrant Orange
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#F0440B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#07152F',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: '#07152F',
    fontWeight: '700',
    fontSize: 13,
  },
  footer: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },
});
