import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || 'AIzaSyCMeoQ4uLuq-Afg8WXSkwyyYhlh-PEyHLw',
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || 'yomy-26030.firebaseapp.com',
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || 'yomy-26030',
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) || 'yomy-26030.firebasestorage.app',
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || '338767716652',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || '1:338767716652:web:7b9f99e7e9977bf8958c89',
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
)

export const firebaseApp = isFirebaseConfigured
  ? (getApps()[0] ?? initializeApp(firebaseConfig))
  : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null

export { firebaseConfig }
