import { Capacitor } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { Session } from '@supabase/supabase-js'

export const MAX_SAVED_ACCOUNTS = 5
const ACCOUNT_VAULT_KEY = 'yomy-account-sessions-v1'
const NATIVE_STORAGE_PREFIX = 'com.yomy.app.account-switcher'

export type SavedAccount = {
  userId: string
  email: string
  username: string
  fullName: string
  avatarUrl: string
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  createdAt: number
  lastUsedAt: number
}

let accountCache: SavedAccount[] = []
let initialized = false
let nativeStorageReady = false
let initializePromise: Promise<SavedAccount[]> | null = null
let persistQueue: Promise<void> = Promise.resolve()

function sortAccounts(accounts: SavedAccount[]) {
  return [...accounts].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_SAVED_ACCOUNTS)
}

function parseAccounts(raw: string | null): SavedAccount[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SavedAccount =>
      Boolean(item && typeof item.userId === 'string' &&
        typeof item.accessToken === 'string' && typeof item.refreshToken === 'string')
    ).slice(0, MAX_SAVED_ACCOUNTS)
  } catch {
    return []
  }
}

function readLegacyLocalAccounts(): SavedAccount[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return parseAccounts(localStorage.getItem(ACCOUNT_VAULT_KEY))
  } catch {
    return []
  }
}

/**
 * Call once before account/session hydration. On native devices the vault is
 * stored through Android Keystore / Apple Keychain, not in browser localStorage.
 * Browser builds use their existing same-origin storage model.
 */
export function initializeAccountStore(): Promise<SavedAccount[]> {
  if (initialized) return Promise.resolve(readSavedAccounts())
  if (initializePromise) return initializePromise

  initializePromise = (async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await SecureStorage.setKeyPrefix(NATIVE_STORAGE_PREFIX)
        const stored = parseAccounts(await SecureStorage.getItem(ACCOUNT_VAULT_KEY))
        nativeStorageReady = true

        if (stored.length) {
          accountCache = stored
        } else {
          // One-time migration for accounts saved by an earlier YOMY build.
          const legacy = readLegacyLocalAccounts()
          accountCache = legacy
          if (legacy.length) {
            await SecureStorage.setItem(ACCOUNT_VAULT_KEY, JSON.stringify(sortAccounts(legacy)))
          }
        }
        try { localStorage.removeItem(ACCOUNT_VAULT_KEY) } catch {}
      } catch {
        // Never write additional-account refresh tokens to web storage on native.
        // Keep any legacy entries only in memory so authentication can continue.
        nativeStorageReady = false
        accountCache = readLegacyLocalAccounts()
      }
    } else {
      accountCache = readLegacyLocalAccounts()
    }

    initialized = true
    return readSavedAccounts()
  })().finally(() => {
    initializePromise = null
  })

  return initializePromise
}

function persistAccountCache() {
  if (!initialized) return

  const run = async () => {
    const payload = JSON.stringify(sortAccounts(accountCache))
    if (Capacitor.isNativePlatform()) {
      if (!nativeStorageReady) return
      await SecureStorage.setItem(ACCOUNT_VAULT_KEY, payload)
      try { localStorage.removeItem(ACCOUNT_VAULT_KEY) } catch {}
      return
    }

    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(ACCOUNT_VAULT_KEY, payload) } catch {}
    }
  }

  // Serialize writes so a late write cannot overwrite a more recent account list.
  persistQueue = persistQueue.then(run, run).catch(() => undefined)
}

export async function flushAccountStore() {
  await persistQueue
}

export function isAccountStoreReady() {
  return initialized && (!Capacitor.isNativePlatform() || nativeStorageReady)
}

export function readSavedAccounts(): SavedAccount[] {
  return sortAccounts(accountCache)
}

export function saveAccountSession(session: Session): SavedAccount[] {
  const existing = accountCache
  const old = existing.find(item => item.userId === session.user.id)
  if (!old && existing.length >= MAX_SAVED_ACCOUNTS) return readSavedAccounts()

  const metadata = session.user.user_metadata || {}
  const email = session.user.email || old?.email || ''
  const username = String(metadata.username || old?.username || email.split('@')[0] || 'yomy_user')
  const fullName = String(metadata.full_name || metadata.name || old?.fullName || '')
  const avatarUrl = String(metadata.avatar_url || metadata.picture || old?.avatarUrl || '')
  const now = Date.now()
  const account: SavedAccount = {
    userId: session.user.id,
    email,
    username,
    fullName,
    avatarUrl,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    createdAt: old?.createdAt || now,
    lastUsedAt: now,
  }
  accountCache = [account, ...existing.filter(item => item.userId !== session.user.id)]
  persistAccountCache()
  return readSavedAccounts()
}

export function updateSavedAccountProfile(
  userId: string,
  profile: { username?: string | null; full_name?: string | null; avatar_url?: string | null },
): SavedAccount[] {
  if (!accountCache.some(item => item.userId === userId)) return readSavedAccounts()
  accountCache = accountCache.map(item => item.userId !== userId ? item : {
    ...item,
    username: profile.username || item.username,
    fullName: profile.full_name || item.fullName,
    avatarUrl: profile.avatar_url || item.avatarUrl,
  })
  persistAccountCache()
  return readSavedAccounts()
}

export function touchSavedAccount(userId: string): SavedAccount[] {
  const now = Date.now()
  accountCache = accountCache.map(item => item.userId === userId ? { ...item, lastUsedAt: now } : item)
  persistAccountCache()
  return readSavedAccounts()
}

export function removeSavedAccount(userId: string): SavedAccount[] {
  accountCache = accountCache.filter(item => item.userId !== userId)
  persistAccountCache()
  return readSavedAccounts()
}
