import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
]

/** True when all required Firebase Web config keys are set in `.env`. */
export function isFirebaseConfigured() {
  const env = import.meta.env
  return REQUIRED.every((k) => Boolean(env[k] && String(env[k]).trim()))
}

function getOrInitApp() {
  if (!isFirebaseConfigured()) return null
  if (getApps().length > 0) return getApps()[0]
  const env = import.meta.env
  return initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  })
}

/**
 * Returns Firebase Auth, or `null` if env is not configured (app should not throw).
 */
export function getFirebaseAuth() {
  const app = getOrInitApp()
  if (!app) return null
  return getAuth(app)
}

/**
 * The Firebase Auth singleton for this app (`null` when `VITE_FIREBASE_*` is incomplete).
 * Prefer `getFirebaseAuth()` if you need to re-resolve after hot reload edge cases.
 */
export const auth = getFirebaseAuth()
