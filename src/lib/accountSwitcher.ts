import type { Session } from '@supabase/supabase-js'

export const MAX_SAVED_ACCOUNTS = 5
const ACCOUNT_VAULT_KEY = 'yomy-account-sessions-v1'

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

function readRawAccounts(): SavedAccount[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_VAULT_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is SavedAccount =>
      Boolean(item && typeof item.userId === 'string' &&
        typeof item.accessToken === 'string' && typeof item.refreshToken === 'string')
    )
  } catch {
    return []
  }
}

function writeAccounts(accounts: SavedAccount[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ACCOUNT_VAULT_KEY, JSON.stringify(accounts.slice(0, MAX_SAVED_ACCOUNTS)))
  } catch {
    // Keep authentication usable even when browser storage is restricted.
  }
}

export function readSavedAccounts(): SavedAccount[] {
  return readRawAccounts().sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_SAVED_ACCOUNTS)
}

export function saveAccountSession(session: Session): SavedAccount[] {
  const existing = readRawAccounts()
  const old = existing.find(item => item.userId === session.user.id)
  if (!old && existing.length >= MAX_SAVED_ACCOUNTS) return readSavedAccounts()

  const metadata = session.user.user_metadata || {}
  const email = session.user.email || old?.email || ''
  const username = String(metadata.username || old?.username || email.split('@')[0] || 'yomy_user')
  const fullName = String(metadata.full_name || metadata.name || old?.fullName || '')
  const avatarUrl = String(metadata.avatar_url || metadata.picture || old?.avatarUrl || '')
  const now = Date.now()
  const account: SavedAccount = {
    userId: session.user.id, email, username, fullName, avatarUrl,
    accessToken: session.access_token, refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null, createdAt: old?.createdAt || now, lastUsedAt: now,
  }
  writeAccounts([account, ...existing.filter(item => item.userId !== session.user.id)])
  return readSavedAccounts()
}

export function updateSavedAccountProfile(
  userId: string,
  profile: { username?: string | null; full_name?: string | null; avatar_url?: string | null },
): SavedAccount[] {
  const current = readRawAccounts()
  if (!current.some(item => item.userId === userId)) return readSavedAccounts()
  writeAccounts(current.map(item => item.userId !== userId ? item : {
    ...item,
    username: profile.username || item.username,
    fullName: profile.full_name || item.fullName,
    avatarUrl: profile.avatar_url || item.avatarUrl,
  }))
  return readSavedAccounts()
}

export function touchSavedAccount(userId: string): SavedAccount[] {
  const now = Date.now()
  writeAccounts(readRawAccounts().map(item => item.userId === userId ? { ...item, lastUsedAt: now } : item))
  return readSavedAccounts()
}

export function removeSavedAccount(userId: string): SavedAccount[] {
  writeAccounts(readRawAccounts().filter(item => item.userId !== userId))
  return readSavedAccounts()
}
