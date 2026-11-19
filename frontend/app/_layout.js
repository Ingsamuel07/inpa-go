import { Stack } from 'expo-router';
import { AuthProvider } from '../src/auth/auth-context.js';
import PendingSyncBanner from '../src/api/pending-sync-banner.js';
import { View } from 'react-native';

export default function RootLayout() {
  return (
    <AuthProvider>
      <View style={{ flex: 1 }}>
        <PendingSyncBanner />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F5F7FA' } }} />
      </View>
    </AuthProvider>
  );
}