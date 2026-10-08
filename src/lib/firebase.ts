import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

/**
 * Firebase Web configuration is intentionally safe to ship to clients.
 * Environment variables remain the preferred override for hosted builds.
 * The baked-in values below prevent native Capacitor APKs from silently
 * losing Firebase functionality when CI has no VITE_FIREBASE_* variables.
 *
 * Do not put server credentials, service-account JSON, or private keys here.
 */
const fallbackFirebaseConfig = {
  apiKey: 'AIzaSyCMeoQ4uLuq-Afg8WXSkwyyYhlh-PEyHLw',
  authDomain: 'yomy-26030.firebaseapp.com',
  projectId: 'yomy-26030',
  storageBucket: 'yomy-26030.firebasestorage.app',
  messagingSenderId: '338767716652',
  appId: '1:338767716652:web:7b9f99e7e9977bf8958c89',
}

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || fallbackFirebaseConfig.apiKey,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || fallbackFirebaseConfig.authDomain,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || fallbackFirebaseConfig.projectId,
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) || fallbackFirebaseConfig.storageBucket,
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || fallbackFirebaseConfig.messagingSenderId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || fallbackFirebaseConfig.appId,
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
)

export const firebaseApp = isFirebaseConfigured
  ? (getApps().find(app => app.options.projectId === firebaseConfig.projectId) ?? initializeApp(firebaseConfig))
  : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null

export { firebaseConfig }
