const DEFAULT_PUBLIC_APP_URL = 'https://yomy-sandy.vercel.app'

function readConfiguredPublicUrl() {
  const value = String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim()
  if (!value) return DEFAULT_PUBLIC_APP_URL
  return value.replace(/\/+$/, '')
}

export function isLocalWebOrigin() {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0'
}

export function getPublicAppOrigin() {
  if (typeof window !== 'undefined' && !isLocalWebOrigin()) {
    return window.location.origin
  }
  return readConfiguredPublicUrl()
}

export function getPublicAppUrl(path = '/') {
  return new URL(path.replace(/^\//, '/'), getPublicAppOrigin() + '/').toString()
}

