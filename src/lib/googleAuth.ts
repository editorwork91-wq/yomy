import { Capacitor } from '@capacitor/core'
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase'
import { supabase } from '@/lib/supabase'
import { getLocalSafeAuthUrl, isLocalWebOrigin, isMobileBrowser } from '@/lib/appOrigin'

function googleAuthErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : ''
  const message = error instanceof Error ? error.message : ''

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled.'
    case 'auth/popup-blocked':
      return 'The Google sign-in window was blocked. Please allow pop-ups and try again.'
    case 'auth/unauthorized-domain':
      return 'This Yomy domain is not authorized for Google sign-in in Firebase.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled in Firebase yet.'
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet connection and try again.'
    default:
      if (/provider.*not.*enabled|unsupported.*provider/i.test(message)) {
        return 'Google is not enabled in Supabase Auth yet.'
      }
      return message || 'Google sign-in failed.'
  }
}

function authOrThrow() {
  if (!firebaseAuth || !isFirebaseConfigured) {
    throw new Error('FIREBASE_GOOGLE_AUTH_NOT_CONFIGURED')
  }
  return firebaseAuth
}

function makeUsernameSeed(user: { email?: string | null; displayName?: string | null }) {
  const source = user.email?.split('@')[0] || user.displayName || 'yomyuser'
  const clean = source.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24)
  return clean.length >= 3 ? clean : 'yomyuser'
}

async function ensureGoogleProfile(user: {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
}) {
  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return

  const metadata = user.user_metadata || {}
  const fullName = typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string'
      ? metadata.name
      : ''
  const avatarUrl = typeof metadata.avatar_url === 'string'
    ? metadata.avatar_url
    : typeof metadata.picture === 'string'
      ? metadata.picture
      : ''

  const seed = makeUsernameSeed({ email: user.email, displayName: fullName })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = attempt === 0 ? '' : '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 5)
    const username = (seed.slice(0, Math.max(3, 30 - suffix.length)) + suffix).slice(0, 30)

    const { data: taken, error: takenError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (takenError) throw takenError
    if (taken) continue

    const { error: insertError } = await supabase.from('profiles').insert({
      id: user.id,
      username,
      full_name: fullName,
      avatar_url: avatarUrl,
      timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    })

    if (!insertError) return
    if (!/duplicate|unique/i.test(insertError.message)) throw insertError
  }

  throw new Error('Could not create a unique Yomy username for this Google account.')
}

async function exchangeGoogleCredential(credential: { idToken?: string | null }) {
  const googleIdToken = credential.idToken
  if (!googleIdToken) throw new Error('GOOGLE_ID_TOKEN_MISSING')

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: googleIdToken,
  })

  if (error) throw error
  if (!data.user) throw new Error('GOOGLE_SUPABASE_USER_MISSING')

  await ensureGoogleProfile(data.user)
  return data
}

export function isNativeGoogleAuth() {
  return Capacitor.isNativePlatform()
}

export async function signInWithGoogle(options: { signup?: boolean } = {}) {
  // A phone browser cannot resolve its own `localhost` back to the computer
  // running the local preview. Move the OAuth hand-off to the hosted YOMY
  // surface automatically; the hosted page then completes Google normally.
  if (!Capacitor.isNativePlatform() && isLocalWebOrigin() && isMobileBrowser()) {
    const target = options.signup ? '/signup' : '/login'
    const mode = options.signup ? 'signup' : 'login'
    window.location.assign(getLocalSafeAuthUrl(target, mode))
    return null
  }

  const auth = authOrThrow()

  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  try {
    if (Capacitor.isNativePlatform() || isMobileBrowser()) {
      await signInWithRedirect(auth, provider)
      return null
    }

    const result = await signInWithPopup(auth, provider)
    const credential = GoogleAuthProvider.credentialFromResult(result)
    return await exchangeGoogleCredential({
      idToken: credential?.idToken,
    })
  } catch (error) {
    await firebaseSignOut(auth).catch(() => undefined)
    throw new Error(googleAuthErrorMessage(error))
  }
}

export async function completeGoogleRedirect() {
  if (!firebaseAuth || !isFirebaseConfigured) return null
  const auth = firebaseAuth

  try {
    const result = await getRedirectResult(auth)
    if (!result) return null

    const credential = GoogleAuthProvider.credentialFromResult(result)
    return await exchangeGoogleCredential({
      idToken: credential?.idToken,
    })
  } catch (error) {
    throw new Error(googleAuthErrorMessage(error))
  } finally {
    await firebaseSignOut(auth).catch(() => undefined)
  }
}
