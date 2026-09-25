import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase'

let registeredForSession = false

declare global {
  interface Window {
    YomyHuaweiPush?: {
      requestToken: () => void
      getToken: () => string
      isAvailable: () => boolean
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function registerNativePush(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false

  const bridge = window.YomyHuaweiPush
  if (!bridge || !bridge.isAvailable()) return false

  if (!registeredForSession) {
    registeredForSession = true
    try {
      bridge.requestToken()
    } catch (error) {
      console.warn('Huawei Push token request failed:', error)
    }
  }

  let token = ''
  for (let i = 0; i < 24; i += 1) {
    try {
      token = bridge.getToken() || ''
    } catch {
      token = ''
    }
    if (token) break
    await sleep(250)
  }

  if (!token) {
    console.warn('Huawei Push token is not available yet')
    return false
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase.from('native_push_tokens').upsert({
    user_id: user.id,
    platform: 'huawei',
    token,
    user_agent: navigator.userAgent.slice(0, 512),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,token' })

  if (error) {
    console.warn('Huawei push token save failed:', error.message)
    return false
  }

  return true
}
