import { createClient } from 'npm:@supabase/supabase-js@2'

const mainUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const firebaseWebApiKey = Deno.env.get('FIREBASE_WEB_API_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })

const admin = createClient(mainUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function normalizePhone(value: string) {
  const digits = value
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))

  const phone = digits
    .replace(/[\s().-]/g, '')
    .replace(/[^+\d]/g, '')

  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : ''
}

async function saveNonce(phone: string) {
  const nonce = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
  const { error } = await admin.from('phone_verification_nonces').insert({
    phone_e164: phone,
    nonce,
    purpose: 'signup',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (error) throw error
  return nonce
}

async function verifyFirebasePhoneToken(idToken: string, expectedPhone: string) {
  if (!firebaseWebApiKey) throw new Error('FIREBASE_PHONE_AUTH_NOT_CONFIGURED')
  if (!idToken) throw new Error('FIREBASE_ID_TOKEN_MISSING')

  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
      encodeURIComponent(firebaseWebApiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  )

  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const errorObject = result.error && typeof result.error === 'object'
      ? result.error as Record<string, unknown>
      : {}
    const message = typeof errorObject.message === 'string'
      ? errorObject.message
      : 'INVALID_ID_TOKEN'
    throw new Error('FIREBASE_' + message.slice(0, 120))
  }

  const users = Array.isArray(result.users)
    ? result.users as Array<Record<string, unknown>>
    : []
  const firebaseUser = users[0]
  const firebasePhone = typeof firebaseUser?.phoneNumber === 'string'
    ? normalizePhone(firebaseUser.phoneNumber)
    : ''

  if (!firebaseUser || firebaseUser.disabled === true) throw new Error('FIREBASE_USER_INVALID')
  if (!firebasePhone || firebasePhone !== expectedPhone) throw new Error('PHONE_TOKEN_MISMATCH')

  return {
    firebaseUid: typeof firebaseUser.localId === 'string' ? firebaseUser.localId : '',
    phone: firebasePhone,
  }
}

async function getAuthenticatedUser(req: Request) {
  const header = req.headers.get('authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('AUTH_REQUIRED')

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new Error('AUTH_REQUIRED')
  return data.user
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const body = await req.json().catch(() => ({}))
  const action = typeof body?.action === 'string' ? body.action : ''
  const phone = typeof body?.phone === 'string' ? normalizePhone(body.phone) : ''

  try {
    if (!['check_phone_signup', 'verify_firebase_signup', 'attach_verified_phone', 'create_account'].includes(action)) {
      return json(400, { error: 'Invalid action' })
    }
    if (!phone) return json(400, { error: 'Use an E.164 phone number, for example +2010...' })

    if (action === 'check_phone_signup') {
      const { count, error } = await admin.from('account_phone_links')
        .select('user_id', { count: 'exact', head: true })
        .eq('phone_e164', phone)

      if (error) throw error
      if ((count || 0) >= 2) return json(409, { error: 'PHONE_ACCOUNT_LIMIT_REACHED' })

      return json(200, { ok: true, can_verify: true })
    }

    if (action === 'verify_firebase_signup') {
      const firebaseIdToken = typeof body?.firebase_id_token === 'string'
        ? body.firebase_id_token.trim()
        : ''

      const verified = await verifyFirebasePhoneToken(firebaseIdToken, phone)
      const { count, error: countError } = await admin.from('account_phone_links')
        .select('user_id', { count: 'exact', head: true })
        .eq('phone_e164', phone)

      if (countError) throw countError
      if ((count || 0) >= 2) return json(409, { error: 'PHONE_ACCOUNT_LIMIT_REACHED' })

      const nonce = await saveNonce(phone)

      return json(200, {
        ok: true,
        verified: true,
        nonce,
        firebase_uid: verified.firebaseUid,
        phone: verified.phone,
      })
    }

    if (action === 'attach_verified_phone') {
      const user = await getAuthenticatedUser(req)
      const nonce = typeof body?.nonce === 'string' ? body.nonce.trim() : ''
      if (!nonce) return json(400, { error: 'PHONE_VERIFICATION_EXPIRED' })

      const { error: claimError } = await admin.rpc('claim_verified_phone', {
        p_user_id: user.id,
        p_phone_e164: phone,
        p_nonce: nonce,
      })

      if (claimError) throw claimError
      return json(200, { ok: true, phone_verified: true, phone })
    }

    if (action === 'create_account') {
      const nonce = typeof body?.nonce === 'string' ? body.nonce.trim() : ''
      const email = typeof body?.email === 'string'
        ? body.email.trim().toLowerCase()
        : ''
      const password = typeof body?.password === 'string' ? body.password : ''
      const username = typeof body?.username === 'string'
        ? body.username.trim().toLowerCase()
        : ''
      const fullName = typeof body?.full_name === 'string'
        ? body.full_name.trim().slice(0, 120)
        : ''
      const legalTermsAccepted = body?.legal_terms_accepted === true
      const legalPrivacyAccepted = body?.legal_privacy_accepted === true
      const legalVersion = typeof body?.legal_version === 'string'
        ? body.legal_version.slice(0, 32)
        : ''
      const legalAcceptedAt = typeof body?.legal_accepted_at === 'string'
        ? body.legal_accepted_at
        : ''

      if (!nonce) return json(400, { error: 'PHONE_VERIFICATION_EXPIRED' })
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'Invalid email' })
      if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters' })
      if (!/^[a-z0-9_.]{3,30}$/.test(username)) return json(400, { error: 'Invalid username' })
      if (!legalTermsAccepted || !legalPrivacyAccepted || !legalVersion) {
        return json(400, { error: 'LEGAL_CONSENT_REQUIRED' })
      }

      const { data: existing } = await admin.from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle()

      if (existing) return json(409, { error: 'USERNAME_TAKEN' })

      const { count } = await admin.from('account_phone_links')
        .select('user_id', { count: 'exact', head: true })
        .eq('phone_e164', phone)

      if ((count || 0) >= 2) return json(409, { error: 'PHONE_ACCOUNT_LIMIT_REACHED' })

      const { data: userData, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          full_name: fullName,
          phone_number: phone,
          phone_verified: true,
          legal_terms_accepted: legalTermsAccepted,
          legal_privacy_accepted: legalPrivacyAccepted,
          legal_version: legalVersion,
          legal_accepted_at: legalAcceptedAt || new Date().toISOString(),
        },
      })

      if (error || !userData.user) throw error || new Error('ACCOUNT_CREATE_FAILED')

      try {
        // claim_verified_phone consumes the nonce atomically after validating it.
        const { error: claimError } = await admin.rpc('claim_verified_phone', {
          p_user_id: userData.user.id,
          p_phone_e164: phone,
          p_nonce: nonce,
        })
        if (claimError) throw claimError
      } catch (error) {
        await admin.auth.admin.deleteUser(userData.user.id)
        throw error
      }

      return json(200, { ok: true, user_id: userData.user.id })
    }

    return json(400, { error: 'Unsupported action' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ACCOUNT_AUTH_FAILED'
    const status =
      message === 'AUTH_REQUIRED' || message === 'NOT_YOUR_ACCOUNT'
        ? 401
        : message === 'PHONE_ACCOUNT_LIMIT_REACHED'
          ? 409
          : message === 'FIREBASE_PHONE_AUTH_NOT_CONFIGURED'
            ? 503
            : message === 'PHONE_VERIFICATION_EXPIRED'
              || message === 'PHONE_TOKEN_MISMATCH'
              || message === 'LEGAL_CONSENT_REQUIRED'
              ? 400
              : 500

    console.error('Yomy account auth error:', message)
    return json(status, { error: message })
  }
})
