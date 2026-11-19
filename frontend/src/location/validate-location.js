import { Alert, Platform } from 'react-native';
import * as Location from 'expo-location';
import { apiRequest } from '../api/client.js';

function requestConsent() {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') return resolve(true);
    Alert.alert(
      'Validación de Geocerca (GPS)',
      'Inpa_Go validará tu ubicación actual respecto a las coordenadas oficiales de la sede UNINPAHU para confirmar tu presencia en el aula de clase. No se almacenan tus trayectorias personales.',
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Validar y Continuar', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

export async function validateAttendanceLocation(sessionId) {
  if (!await requestConsent()) return null;
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Se requiere permiso de GPS para comprobar que te encuentras en el campus universitario.');
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
    maximumAge: 5000,
  });

  return apiRequest('/location/validate', {
    method: 'POST',
    body: {
      sessionId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? 10,
    },
  });
}

// Student Self Check-In with GPS validation (RF09, RF10)
export async function checkInWithGps(sessionId) {
  if (!await requestConsent()) return null;
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Se requiere permiso de GPS para registrar tu asistencia en el aula.');
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
    maximumAge: 5000,
  });

  return apiRequest(`/attendance/sessions/${sessionId}/check-in`, {
    method: 'POST',
    body: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? 10,
    },
  });
}
