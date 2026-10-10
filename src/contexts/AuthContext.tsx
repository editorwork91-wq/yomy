import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { OnboardingState, Profile } from '@/lib/supabase'
import { applyYomyFontScale, applyYomyLanguage, systemTimezone } from '@/lib/i18n'
import {
  MAX_SAVED_ACCOUNTS, flushAccountStore, initializeAccountStore, readSavedAccounts,
  saveAccountSession, updateSavedAccountProfile, touchSavedAccount,
  removeSavedAccount as removeStoredAccount, type SavedAccount,
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
  signOut: () => Promise<void>
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
    setProfile(profileResult.data)
    setOnboarding(onboardingResult.data)
    if (profileResult.data) setSavedAccounts(updateSavedAccountProfile(userId, profileResult.data))
    applyProfilePreferences(profileResult.data)
  }

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id)
  }

  const switchAccount = async (userId: string) => {
    if (user?.id === userId) return
    await initializeAccountStore()
    const target = readSavedAccounts().find(account => account.userId === userId)
    if (!target) throw new Error('SAVED_ACCOUNT_NOT_FOUND')
    const { error } = await supabase.auth.setSession({ access_token: target.accessToken, refresh_token: target.refreshToken })
    if (error) throw error
    setSavedAccounts(touchSavedAccount(userId))
  }

  const beginAddAccount = async () => {
    await initializeAccountStore()
    const currentAccounts = readSavedAccounts()
    const activeIsSaved = Boolean(session?.user && currentAccounts.some(account => account.userId === session.user.id))
    if (!activeIsSaved && currentAccounts.length >= MAX_SAVED_ACCOUNTS) throw new Error('ACCOUNT_LIMIT_REACHED')
    if (session) setSavedAccounts(saveAccountSession(session))
    await flushAccountStore()
    if (readSavedAccounts().length >= MAX_SAVED_ACCOUNTS) throw new Error('ACCOUNT_LIMIT_REACHED')
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
  }

  const forgetAccount = (userId: string) => {
    if (user?.id === userId) throw new Error('CANNOT_REMOVE_ACTIVE_ACCOUNT')
    setSavedAccounts(removeStoredAccount(userId))
  }

  useEffect(() => {
    if (!localStorage.getItem('yomy-timezone')) localStorage.setItem('yomy-timezone', systemTimezone())
    let active = true

    const handleSession = async (event: string, nextSession: Session | null) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      if (nextSession?.user) {
        await initializeAccountStore()
        const known = readSavedAccounts().some(account => account.userId === nextSession.user.id)
        if (event === 'SIGNED_IN' && !known && readSavedAccounts().length >= MAX_SAVED_ACCOUNTS) {
          void supabase.auth.signOut({ scope: 'local' })
          setSession(null)
          setUser(null)
          setProfile(null)
          setOnboarding(null)
          setSavedAccounts(readSavedAccounts())
          setLoading(false)
          return
        }
        setSavedAccounts(saveAccountSession(nextSession))
        void fetchProfile(nextSession.user.id)
      } else {
        setProfile(null)
        setOnboarding(null)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Do storage I/O outside Supabase's auth callback to avoid blocking auth.
      void initializeAccountStore()
        .then(() => handleSession(event, nextSession))
        .catch(() => {
          setSession(nextSession)
          setUser(nextSession?.user ?? null)
          if (!nextSession?.user) {
            setProfile(null)
            setOnboarding(null)
          }
        })
    })

    void initializeAccountStore()
      .then(async () => {
        if (!active) return
        setSavedAccounts(readSavedAccounts())
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        if (!active) return
        await handleSession('INITIAL_SESSION', currentSession)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    if (user) {
      setSavedAccounts(removeStoredAccount(user.id))
      await flushAccountStore()
    }
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
