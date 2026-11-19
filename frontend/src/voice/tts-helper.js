import { Platform } from 'react-native';

export async function speak(text) {
  if (!text) return false;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-CO';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  const Speech = await import('expo-speech').catch(() => null);
  if (!Speech || typeof Speech.speak !== 'function') return false;
  Speech.stop();
  Speech.speak(text, { language: 'es-CO', rate: 1.0 });
  return true;
}
