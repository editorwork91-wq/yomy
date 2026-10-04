import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth'
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase'
import { supabase } from '@/lib/supabase'

let verifier: RecaptchaVerifier | null = null
let confirmation: ConfirmationResult | null = null

function authOrThrow() {
  if (!firebaseAuth || !isFirebaseConfigured) {
    throw new Error('FIREBASE_PHONE_AUTH_NOT_CONFIGURED')
  }
  return firebaseAuth
}

export function resetFirebasePhoneVerification() {
  confirmation = null
  if (verifier) {
    try {
      verifier.clear()
    } catch {
      // The verifier may already have been detached from the DOM.
    }
  }
  verifier = null
  if (firebaseAuth) void signOut(firebaseAuth).catch(() => undefined)
}

export async function startFirebasePhoneVerification(
  phone: string,
  buttonElement: HTMLElement,
  language: string,
) {
  const auth = authOrThrow()
  resetFirebasePhoneVerification()

  auth.languageCode = language === 'ar' ? 'ar' : language

  verifier = new RecaptchaVerifier(auth, buttonElement, {
    size: 'invisible',
    'expired-callback': () => {
      // Force a fresh challenge on the next attempt.
      if (verifier) {
        try {
          verifier.clear()
        } catch {
          // no-op
        }
      }
      verifier = null
    },
  })

  confirmation = await signInWithPhoneNumber(auth, phone, verifier)
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
