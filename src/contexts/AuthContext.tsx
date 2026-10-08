import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { OnboardingState, Profile } from '@/lib/supabase'
import { applyYomyFontScale, applyYomyLanguage, systemTimezone } from '@/lib/i18n'

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  onboarding: OnboardingState | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  onboarding: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [loading, setLoading] = useState(true)

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
    applyProfilePreferences(profileResult.data)
  }

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id)
  }

  useEffect(() => {
    if (!localStorage.getItem('yomy-timezone')) localStorage.setItem('yomy-timezone', systemTimezone())
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      if (nextSession?.user) {
        void fetchProfile(nextSession.user.id)
      } else {
        setProfile(null)
        setOnboarding(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setOnboarding(null)
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, onboarding, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
