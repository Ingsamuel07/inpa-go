import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const web = Platform.OS === 'web';

function browserStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis.sessionStorage !== 'undefined') {
    return globalThis.sessionStorage;
  }
  throw new Error('Almacenamiento del navegador no disponible.');
}

export function getItemAsync(key) {
  return web ? Promise.resolve(browserStorage().getItem(key)) : SecureStore.getItemAsync(key);
}

export function setItemAsync(key, value) {
  return web ? Promise.resolve(browserStorage().setItem(key, value)) : SecureStore.setItemAsync(key, value);
}

export function deleteItemAsync(key) {
  return web ? Promise.resolve(browserStorage().removeItem(key)) : SecureStore.deleteItemAsync(key);
}
