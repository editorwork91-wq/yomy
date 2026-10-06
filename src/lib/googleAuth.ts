import { GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase'
import { supabase } from '@/lib/supabase'

function googleAuthErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : ''

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
      return error instanceof Error ? error.message : 'Google sign-in failed.'
  }
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

  const seed = makeUsernameSeed({
    email: user.email,
    displayName: fullName,
  })

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

export async function signInWithGoogle() {
  if (!firebaseAuth || !isFirebaseConfigured) {
    throw new Error('FIREBASE_GOOGLE_AUTH_NOT_CONFIGURED')
  }

  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  try {
    const result = await signInWithPopup(firebaseAuth, provider)
    const credential = GoogleAuthProvider.credentialFromResult(result)
    const googleIdToken = credential?.idToken

    if (!googleIdToken) {
      throw new Error('GOOGLE_ID_TOKEN_MISSING')
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: googleIdToken,
    })

    if (error) throw error
    if (!data.user) throw new Error('GOOGLE_SUPABASE_USER_MISSING')

    await ensureGoogleProfile(data.user)
    return data
  } catch (error) {
    throw new Error(googleAuthErrorMessage(error))
  } finally {
    await firebaseSignOut(firebaseAuth).catch(() => undefined)
  }
}
