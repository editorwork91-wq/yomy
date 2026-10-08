import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth'
import { Capacitor } from '@capacitor/core'
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase'
import { supabase } from '@/lib/supabase'

let verifier: RecaptchaVerifier | null = null
let confirmation: ConfirmationResult | null = null
let verifierAnchor: HTMLElement | null = null

function authOrThrow() {
  if (!firebaseAuth || !isFirebaseConfigured) {
    throw new Error('FIREBASE_PHONE_AUTH_NOT_CONFIGURED')
  }
  return firebaseAuth
}

function assertHostedPhoneAuthEnvironment() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : ''
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
    throw new Error('PHONE_AUTH_REQUIRES_HOSTED_DOMAIN')
  }

  // A Capacitor webview normally runs from localhost. Firebase's web phone
  // auth explicitly requires an authorized hosted domain, so native builds
  // must use the hosted YOMY auth surface rather than pretending localhost
  // is a production Phone Auth origin.
  if (Capacitor.isNativePlatform() && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    throw new Error('PHONE_AUTH_REQUIRES_HOSTED_DOMAIN')
  }
}

function clearVerifier() {
  if (!verifier) return
  try { verifier.clear() } catch {}
  verifier = null
  verifierAnchor = null
}

export function resetFirebasePhoneVerification() {
  confirmation = null
  clearVerifier()
  if (firebaseAuth) void signOut(firebaseAuth).catch(() => undefined)
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

export async function startFirebasePhoneVerification(
  phone: string,
  buttonElement: HTMLElement,
  language: string,
) {
  const auth = authOrThrow()
  assertHostedPhoneAuthEnvironment()

  const appVerifier = await getVerifier(buttonElement, language)
  confirmation = await signInWithPhoneNumber(auth, phone, appVerifier)
}

export async function confirmFirebasePhoneVerification(
  code: string,
  phone: string,
) {
  const auth = authOrThrow()
  if (!confirmation) throw new Error('PHONE_VERIFICATION_NOT_STARTED')

  const result = await confirmation.confirm(code)
  const verifiedPhone = result.user.phoneNumber || ''
  if (verifiedPhone !== phone) {
    await signOut(auth).catch(() => undefined)
    throw new Error('PHONE_TOKEN_MISMATCH')
  }

  const idToken = await result.user.getIdToken(true)
  const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
    body: {
      action: 'verify_firebase_signup',
      phone,
      firebase_id_token: idToken,
    },
  })

  await signOut(auth).catch(() => undefined)
  confirmation = null

  if (error || data?.error || !data?.nonce) {
    throw new Error(data?.error || error?.message || 'PHONE_VERIFICATION_FAILED')
  }

  return {
    nonce: String(data.nonce),
    firebaseUid: result.user.uid,
    phone: verifiedPhone,
  }
}
