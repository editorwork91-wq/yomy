import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth'
import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase'
import { supabase } from '@/lib/supabase'

let verifier: RecaptchaVerifier | null = null
let confirmation: ConfirmationResult | null = null
let verifierAnchor: HTMLElement | null = null

type NativeListenerHandle = { remove: () => Promise<void> }
type NativeStartWaiter = {
  resolve: (automaticallyVerified: boolean) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  settled: boolean
}

let nativeVerificationId: string | null = null
let nativeAutoVerified = false
let nativeFailureMessage: string | null = null
let nativeListeners: NativeListenerHandle[] = []
let nativeStartWaiter: NativeStartWaiter | null = null

function authOrThrow() {
  if (!firebaseAuth || !isFirebaseConfigured) {
    throw new Error('FIREBASE_PHONE_AUTH_NOT_CONFIGURED')
  }
  return firebaseAuth
}

function asError(error: unknown, fallback = 'PHONE_VERIFICATION_FAILED') {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return new Error(String((error as { message?: unknown }).message || fallback))
  }
  return new Error(fallback)
}

function settleNativeStart(automaticallyVerified: boolean, error?: Error) {
  const waiter = nativeStartWaiter
  if (!waiter || waiter.settled) return
  waiter.settled = true
  clearTimeout(waiter.timeout)
  nativeStartWaiter = null
  if (error) waiter.reject(error)
  else waiter.resolve(automaticallyVerified)
}

async function removeNativeListeners() {
  const current = nativeListeners
  nativeListeners = []
  await Promise.all(current.map(listener => listener.remove().catch(() => undefined)))
}

function clearVerifier() {
  if (!verifier) return
  try { verifier.clear() } catch {}
  verifier = null
  verifierAnchor = null
}

async function signOutTemporaryFirebaseUser() {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut().catch(() => undefined)
  } else if (firebaseAuth) {
    await signOut(firebaseAuth).catch(() => undefined)
  }
}

export function resetFirebasePhoneVerification() {
  confirmation = null
  clearVerifier()
  if (nativeStartWaiter) settleNativeStart(false, new Error('PHONE_VERIFICATION_CANCELLED'))
  nativeVerificationId = null
  nativeAutoVerified = false
  nativeFailureMessage = null
  void removeNativeListeners()
  void signOutTemporaryFirebaseUser()
}

async function getVerifier(anchor: HTMLElement, language: string) {
  const auth = authOrThrow()
  if (verifier && verifierAnchor === anchor) return verifier

  clearVerifier()
  auth.languageCode = language === 'ar' ? 'ar' : language

  verifier = new RecaptchaVerifier(auth, anchor, {
    size: 'invisible',
    callback: () => undefined,
    'expired-callback': () => {
      confirmation = null
      clearVerifier()
    },
  })

  verifierAnchor = anchor
  return verifier
}

async function startNativePhoneVerification(phone: string, language: string) {
  // Native Firebase Phone Auth handles Android/iOS verification without
  // relying on a WebView's localhost origin or Web reCAPTCHA.
  await removeNativeListeners()
  await FirebaseAuthentication.signOut().catch(() => undefined)
  nativeVerificationId = null
  nativeAutoVerified = false
  nativeFailureMessage = null

  const startPromise = new Promise<boolean>((resolve, reject) => {
    const timeout = setTimeout(() => {
      settleNativeStart(false, new Error('PHONE_VERIFICATION_TIMEOUT'))
    }, 90000)
    nativeStartWaiter = { resolve, reject, timeout, settled: false }
  })

  try {
    await FirebaseAuthentication.setLanguageCode({ languageCode: language === 'ar' ? 'ar' : language })

    nativeListeners.push(await FirebaseAuthentication.addListener('phoneCodeSent', event => {
      nativeVerificationId = event.verificationId
      nativeAutoVerified = false
      settleNativeStart(false)
    }))

    nativeListeners.push(await FirebaseAuthentication.addListener('phoneVerificationCompleted', () => {
      nativeAutoVerified = true
      nativeVerificationId = null
      nativeFailureMessage = null
      settleNativeStart(true)
    }))

    nativeListeners.push(await FirebaseAuthentication.addListener('phoneVerificationFailed', event => {
      nativeFailureMessage = event.message || 'PHONE_VERIFICATION_FAILED'
      if (!nativeVerificationId && !nativeAutoVerified) {
        settleNativeStart(false, new Error(nativeFailureMessage))
      }
    }))

    // timeout: 0 disables Android SMS auto-retrieval. Instant verification
    // can still complete through phoneVerificationCompleted.
    void FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: phone, timeout: 0 })
      .catch(error => settleNativeStart(false, asError(error)))

    return { automaticallyVerified: await startPromise }
  } catch (error) {
    settleNativeStart(false, asError(error))
    await removeNativeListeners()
    throw asError(error)
  }
}

export async function startFirebasePhoneVerification(
  phone: string,
  buttonElement: HTMLElement,
  language: string,
): Promise<{ automaticallyVerified: boolean }> {
  if (Capacitor.isNativePlatform()) {
    return startNativePhoneVerification(phone, language)
  }

  const auth = authOrThrow()
  const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : ''
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    throw new Error('PHONE_AUTH_REQUIRES_HOSTED_DOMAIN')
  }

  const appVerifier = await getVerifier(buttonElement, language)
  confirmation = await signInWithPhoneNumber(auth, phone, appVerifier)
  return { automaticallyVerified: false }
}

async function verifyTokenAndCreateNonce(
  idToken: string,
  firebaseUid: string,
  phone: string,
) {
  const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
    body: { action: 'verify_firebase_signup', phone, firebase_id_token: idToken },
  })

  if (error || data?.error || !data?.nonce) {
    throw new Error(data?.error || error?.message || 'PHONE_VERIFICATION_FAILED')
  }

  return { nonce: String(data.nonce), firebaseUid, phone }
}

export async function confirmFirebasePhoneVerification(
  code: string,
  phone: string,
) {
  if (Capacitor.isNativePlatform()) {
    if (nativeFailureMessage && !nativeVerificationId && !nativeAutoVerified) {
      throw new Error(nativeFailureMessage)
    }

    if (!nativeAutoVerified) {
      if (!nativeVerificationId) throw new Error('PHONE_VERIFICATION_NOT_STARTED')
      // On an invalid code, preserve the verification ID so the user can retry.
      await FirebaseAuthentication.confirmVerificationCode({
        verificationId: nativeVerificationId,
        verificationCode: code,
      })
    }

    const { user } = await FirebaseAuthentication.getCurrentUser()
    const verifiedPhone = user?.phoneNumber || ''
    if (!user || verifiedPhone !== phone) {
      await signOutTemporaryFirebaseUser()
      nativeVerificationId = null
      nativeAutoVerified = false
      throw new Error('PHONE_TOKEN_MISMATCH')
    }

    const { token } = await FirebaseAuthentication.getIdToken({ forceRefresh: true })
    try {
      const result = await verifyTokenAndCreateNonce(token, user.uid, phone)
      await signOutTemporaryFirebaseUser()
      nativeVerificationId = null
      nativeAutoVerified = false
      nativeFailureMessage = null
      await removeNativeListeners()
      return result
    } catch (error) {
      await signOutTemporaryFirebaseUser()
      nativeVerificationId = null
      nativeAutoVerified = false
      nativeFailureMessage = null
      await removeNativeListeners()
      throw error
    }
  }

  const auth = authOrThrow()
  if (!confirmation) throw new Error('PHONE_VERIFICATION_NOT_STARTED')

  // Firebase keeps a ConfirmationResult alive after an invalid-code response,
  // allowing the user to retry without requesting another SMS.
  const result = await confirmation.confirm(code)
  const verifiedPhone = result.user.phoneNumber || ''
  if (verifiedPhone !== phone) {
    await signOut(auth).catch(() => undefined)
    confirmation = null
    throw new Error('PHONE_TOKEN_MISMATCH')
  }

  const idToken = await result.user.getIdToken(true)
  try {
    const nonceResult = await verifyTokenAndCreateNonce(idToken, result.user.uid, phone)
    await signOut(auth).catch(() => undefined)
    confirmation = null
    return { ...nonceResult, phone: verifiedPhone }
  } catch (error) {
    await signOut(auth).catch(() => undefined)
    confirmation = null
    throw error
  }
}
