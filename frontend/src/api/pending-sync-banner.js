import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/auth-context.js';

export default function PendingSyncBanner() {
  const { offlineSync, syncPendingWrites, user } = useAuth();
  if (!offlineSync.pendingCount) return null;

  const needsSameAccount = !user || String(user.id).startsWith('demo-');
  return (
    <View style={styles.banner}>
      <View style={styles.message}>
        <Text style={styles.title}>
          {offlineSync.pendingCount} cambio{offlineSync.pendingCount === 1 ? '' : 's'} pendiente{offlineSync.pendingCount === 1 ? '' : 's'} de sincronización
        </Text>
        <Text style={styles.detail}>
          {offlineSync.failedCount
            ? `${offlineSync.failedCount} requiere${offlineSync.failedCount === 1 ? '' : 'n'} revisión. ${offlineSync.lastError}`
            : offlineSync.lastError || (needsSameAccount
              ? 'Inicia sesión con la misma cuenta institucional para enviarlos a Neon.'
              : 'Se enviarán a Neon cuando haya conexión.')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={offlineSync.syncing || needsSameAccount}
        onPress={() => syncPendingWrites({ retryFailed: true })}
        style={({ pressed }) => [styles.button, (pressed || offlineSync.syncing || needsSameAccount) && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{offlineSync.syncing ? 'Sincronizando…' : 'Sincronizar'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#FFF7ED',
    borderBottomWidth: 1,
    borderBottomColor: '#FDBA74',
  },
  message: { flex: 1 },
  title: { color: '#9A3412', fontSize: 13, fontWeight: '800' },
  detail: { color: '#7C2D12', fontSize: 11, marginTop: 3 },
  button: { backgroundColor: '#EA580C', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
});
