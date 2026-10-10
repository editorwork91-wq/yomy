import { Capacitor } from '@capacitor/core'

export type YomyPlatform = 'ios' | 'android' | 'web'
export type YomyRenderer = 'modern' | 'legacy'

export type YomyPlatformInfo = {
  platform: YomyPlatform
  isHuawei: boolean
  hasGooglePlayServices: boolean
  hasHuaweiMobileServices: boolean
  renderer: YomyRenderer
}

type NativeDeviceBridge = {
  isHuawei?: () => boolean
  hasGooglePlayServices?: () => boolean
  hasHuaweiMobileServices?: () => boolean
}

function nativeBridge(): NativeDeviceBridge | null {
  try {
    const bridge = (window as Window & { YomyDevice?: NativeDeviceBridge }).YomyDevice
    return bridge || null
  } catch {
    return null
  }
}

export function detectYomyPlatform(): YomyPlatformInfo {
  const platform = Capacitor.getPlatform() as YomyPlatform
  const ua = navigator.userAgent || ''
  const bridge = nativeBridge()
  const isHuawei = bridge?.isHuawei?.() ?? /HUAWEI|HONOR/i.test(ua)
  const hasGms = bridge?.hasGooglePlayServices?.() ?? false
  const hasHms = bridge?.hasHuaweiMobileServices?.() ?? /HUAWEI|HONOR/i.test(ua)

  const renderer: YomyRenderer = (() => {
    try {
      const supportsColorMix = typeof CSS !== 'undefined' && CSS.supports('background', 'color-mix(in srgb, white 50%, transparent)')
      const supportsBackdrop = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'blur(1px)')
      return supportsColorMix && supportsBackdrop ? 'modern' : 'legacy'
    } catch {
      return 'legacy'
    }
  })()

  return {
    platform: platform === 'ios' || platform === 'android' ? platform : 'web',
    isHuawei,
    hasGooglePlayServices: hasGms,
    hasHuaweiMobileServices: hasHms,
    renderer,
  }
}

export function applyYomyPlatformAttributes(info: YomyPlatformInfo) {
  const root = document.documentElement
  root.dataset.yomyPlatform = info.platform
  root.dataset.yomyHuawei = String(info.isHuawei)
  root.dataset.yomyGms = String(info.hasGooglePlayServices)
  root.dataset.yomyHms = String(info.hasHuaweiMobileServices)
  root.dataset.yomyRenderer = info.renderer
}
