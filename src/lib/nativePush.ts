import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase'

let registeredForSession = false

declare global {
  interface Window {
    YomyBackground?: {
      start: (
        accessToken: string,
        refreshToken: string,
        userId: string,
        supabaseUrl: string,
        anonKey: string,
        expiresAt: number,
      ) => void
      stop: () => void
      isAvailable: () => boolean
    }
  }
}

export async function registerNativePush(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false

  const bridge = window.YomyBackground
  if (!bridge || !bridge.isAvailable()) return false

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user || !session.access_token || !session.refresh_token) return false
  if (registeredForSession) return true

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!supabaseUrl || !anonKey) return false

  try {
    bridge.start(
      session.access_token,
      session.refresh_token,
      session.user.id,
      supabaseUrl,
      anonKey,
      session.expires_at ?? 0,
    )
    registeredForSession = true
    return true
  } catch (error) {
    console.warn('Yomy Huawei background service start failed:', error)
    return false
  }
}

export function stopNativePush(): void {
  registeredForSession = false
  if (!Capacitor.isNativePlatform()) return
  try {
    window.YomyBackground?.stop()
  } catch (error) {
    console.warn('Yomy Huawei background service stop failed:', error)
  }
}
