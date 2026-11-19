import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from './auth-context.js';

const BIOMETRIC_KEY = 'inpago.biometric-enabled';
const homeByRole = { admin: '/admin', teacher: '/teacher', student: '/student' };

export default function RoleDashboard({ role, title }) {
  const router = useRouter();
  const { user, signOut, enableBiometrics } = useAuth();
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) router.replace('/login');
    else if (user.role !== role) router.replace(homeByRole[user.role] || '/login');
    SecureStore.getItemAsync(BIOMETRIC_KEY).then((value) => setBiometricEnabled(value === 'true'));
  }, [user, role, router]);

  async function handleEnableBiometrics() {
    setBusy(true);
    setMessage('');
    try { setBiometricEnabled(await enableBiometrics()); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }

  if (!user || user.role !== role) return <View style={styles.page}><ActivityIndicator color="#F0440B" /></View>;
  return <View style={styles.page}>
    <Text style={styles.brand}>Inpa_<Text style={styles.accent}>Go</Text></Text>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.copy}>{user.email}</Text>
    {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
    <Pressable onPress={handleSignOut} style={styles.button}><Text style={styles.buttonText}>Cerrar sesión</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({ page:{flex:1,justifyContent:'center',padding:28,backgroundColor:'#F5F7FA'},brand:{fontSize:18,fontWeight:'800',color:'#07152F',marginBottom:22},accent:{color:'#F0440B'},title:{fontSize:28,fontWeight:'800',color:'#07152F'},copy:{marginTop:12,color:'#64748B'},secondary:{borderWidth:1,borderColor:'#07152F',padding:15,borderRadius:12,alignItems:'center',marginTop:24},secondaryText:{color:'#07152F',fontWeight:'700'},button:{backgroundColor:'#F0440B',padding:15,borderRadius:12,alignItems:'center',marginTop:12},buttonText:{color:'#FFF',fontWeight:'700'},message:{color:'#B42318',marginTop:12} });