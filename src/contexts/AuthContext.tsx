import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { OnboardingState, Profile } from '@/lib/supabase'
import { applyYomyFontScale, applyYomyLanguage, systemTimezone } from '@/lib/i18n'
import {
  MAX_SAVED_ACCOUNTS, flushAccountStore, initializeAccountStore, readSavedAccounts,
  saveAccountSession, updateSavedAccountProfile, touchSavedAccount,
  removeSavedAccount as removeStoredAccount, markPendingAddAccount, consumePendingAddAccount,
  type SavedAccount,
} from '@/lib/accountSwitcher'

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  onboarding: OnboardingState | null
  loading: boolean
  savedAccounts: SavedAccount[]
  canAddAccount: boolean
  switchAccount: (userId: string) => Promise<void>
  beginAddAccount: () => Promise<void>
  forgetAccount: (userId: string) => void
  signOut: (keepAccount?: boolean) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  session: null, user: null, profile: null, onboarding: null, loading: true,
  savedAccounts: [], canAddAccount: true, switchAccount: async () => {},
  beginAddAccount: async () => {}, forgetAccount: () => {}, signOut: async () => {}, refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() => readSavedAccounts())

  const applyProfilePreferences = (nextProfile: Profile | null) => {
    if (!nextProfile) {
      const storedLanguage = localStorage.getItem('yomy-language') as 'en' | 'ar' | 'de' | 'fr' | 'es' | null
      const storedScale = Number(localStorage.getItem('yomy-font-scale') || 1)
      applyYomyLanguage(storedLanguage || 'en')
      applyYomyFontScale(storedScale)
      return
    }
    applyYomyLanguage(nextProfile.language || 'en')
    applyYomyFontScale(nextProfile.font_scale || 1)
  }

  const fetchProfile = async (userId: string) => {
    const [profileResult, onboardingResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('user_onboarding').select('*').eq('user_id', userId).maybeSingle(),
    ])

    // A previous user's profile query may finish after a fast account switch.
    // Never let late data from that request overwrite the newly active account.
    const { data: { session: liveSession } } = await supabase.auth.getSession()
    if (liveSession?.user.id !== userId) return

    setProfile(profileResult.data)
    setOnboarding(onboardingResult.data)
    if (profileResult.data) setSavedAccounts(updateSavedAccountProfile(userId, profileResult.data))
    applyProfilePreferences(profileResult.data)
  }

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id)
  }

  const switchAccount = async (userId: string) => {
    await initializeAccountStore()
    const target = readSavedAccounts().find(account => account.userId === userId)
    if (!target) throw new Error('SAVED_ACCOUNT_NOT_FOUND')

    // Capture the freshest active credentials before replacing the one Supabase
    // client session. Inactive sessions are held in the account vault.
    const { data: currentData, error: currentError } = await supabase.auth.getSession()
    if (currentError) throw currentError
    if (currentData.session && currentData.session.user.id !== userId) {
      setSavedAccounts(saveAccountSession(currentData.session))
      await flushAccountStore()
    }

    const { data, error } = await supabase.auth.setSession({
      access_token: target.accessToken,
      refresh_token: target.refreshToken,
    })
    if (error) {
      if (/refresh token|invalid token|session not found|already used/i.test(error.message)) {
        throw new Error('SAVED_ACCOUNT_REAUTH_REQUIRED')
      }
      throw error
    }
    if (data.session) setSavedAccounts(saveAccountSession(data.session))
    setSavedAccounts(touchSavedAccount(userId))
    await flushAccountStore()
  }

  const beginAddAccount = async () => {
    await initializeAccountStore()
    const currentAccounts = readSavedAccounts()
    const activeIsSaved = Boolean(session?.user && currentAccounts.some(account => account.userId === session.user.id))
    if (!activeIsSaved && currentAccounts.length >= MAX_SAVED_ACCOUNTS) throw new Error('ACCOUNT_LIMIT_REACHED')
    if (session) setSavedAccounts(saveAccountSession(session))
    await flushAccountStore()
    if (readSavedAccounts().length >= MAX_SAVED_ACCOUNTS) throw new Error('ACCOUNT_LIMIT_REACHED')
    // Do not call signOut here: Supabase revokes the refresh token for the
    // local session, which would make the just-saved account impossible to
    // restore. The login route enters explicit add-account mode instead.
    markPendingAddAccount()
  }

  const forgetAccount = (userId: string) => {
    if (user?.id === userId) throw new Error('CANNOT_REMOVE_ACTIVE_ACCOUNT')
    setSavedAccounts(removeStoredAccount(userId))
  }

  useEffect(() => {
    if (!localStorage.getItem('yomy-timezone')) localStorage.setItem('yomy-timezone', systemTimezone())
    let active = true

    const handleSession = async (nextSession: Session | null, event: string) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      if (nextSession?.user) {
        await initializeAccountStore()
        const known = readSavedAccounts().some(account => account.userId === nextSession.user.id)
        // INITIAL_SESSION and TOKEN_REFRESHED must not consume the add-account
        // intent. Only a genuine sign-in can complete that flow.
        const hasPendingAddIntent = event === 'SIGNED_IN' ? consumePendingAddAccount() : false
        const explicitlyAddingAccount = !known && hasPendingAddIntent

        if (!known && explicitlyAddingAccount && readSavedAccounts().length >= MAX_SAVED_ACCOUNTS) {
          void supabase.auth.signOut({ scope: 'local' })
          setSession(null)
          setUser(null)
          setProfile(null)
          setOnboarding(null)
          setSavedAccounts(readSavedAccounts())
          setLoading(false)
          return
        }

        // Update tokens for previously saved accounts. Only add an unknown
        // account automatically when the user explicitly used “Add account”.
        if (known || explicitlyAddingAccount) {
          setSavedAccounts(saveAccountSession(nextSession))
        } else {
          setSavedAccounts(readSavedAccounts())
        }
        void fetchProfile(nextSession.user.id)
      } else {
        setProfile(null)
        setOnboarding(null)
      }
    }

    // Serialize auth notifications. A rapid SIGNED_IN/TOKEN_REFRESHED sequence
    // must not let an older session overwrite the newly selected account.
    let authEventQueue: Promise<void> = Promise.resolve()
    const enqueueSession = (event: string, nextSession: Session | null) => {
      authEventQueue = authEventQueue.then(async () => {
        await initializeAccountStore()
        await handleSession(nextSession, event)
      }).catch(() => {
        setSession(nextSession)
        setUser(nextSession?.user ?? null)
        if (!nextSession?.user) {
          setProfile(null)
          setOnboarding(null)
        }
      })
      return authEventQueue
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Defer storage/database operations outside Supabase's callback.
      void enqueueSession(event, nextSession)
    })

    void initializeAccountStore()
      .then(async () => {
        if (!active) return
        setSavedAccounts(readSavedAccounts())
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        if (!active) return
        await enqueueSession('INITIAL_SESSION', currentSession)
        if (active) setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async (keepAccount = false) => {
    await initializeAccountStore()

    if (session?.user) {
      const isAlreadySaved = readSavedAccounts().some(account => account.userId === session.user.id)
      if (keepAccount && !isAlreadySaved && readSavedAccounts().length >= MAX_SAVED_ACCOUNTS) {
        throw new Error('ACCOUNT_LIMIT_REACHED')
      }
      if (keepAccount) {
        // Saving an account is not a server sign-out. Keep its refresh token
        // valid and let the account picker switch sessions from the login page.
        setSavedAccounts(saveAccountSession(session))
        if (profile) setSavedAccounts(updateSavedAccountProfile(session.user.id, profile))
        await flushAccountStore()
        return
      }

      removeStoredAccount(session.user.id)
      setSavedAccounts(readSavedAccounts())
      await flushAccountStore()
    }

    // This branch means "don't save this account"; its current refresh token
    // is intentionally revoked and the account is removed from this device.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
    setProfile(null)
    setOnboarding(null)
  }

  return <AuthContext.Provider value={{
    session, user, profile, onboarding, loading, savedAccounts,
    canAddAccount: savedAccounts.length < MAX_SAVED_ACCOUNTS,
    switchAccount, beginAddAccount, forgetAccount, signOut, refreshProfile,
  }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
