import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { setActiveAccountId, supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { applyYomyFontScale, applyYomyLanguage, systemTimezone } from '@/lib/i18n'

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
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
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile(data)
    applyProfilePreferences(data)
    if (data) {
      try {
        const current = JSON.parse(localStorage.getItem('yomy-account-list') || '[]') as Array<{ id: string; username: string; avatar_url?: string }>
        const next = [...current.filter(item => item.id !== userId), { id: userId, username: data.username, avatar_url: data.avatar_url || '' }]
        localStorage.setItem('yomy-account-list', JSON.stringify(next.slice(-4)))
        window.dispatchEvent(new Event('yomy-account-list-changed'))
      } catch {}
    }
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        ;(async () => {
          await fetchProfile(session.user.id)
        })()
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setActiveAccountId(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
