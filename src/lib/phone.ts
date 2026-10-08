import {
  AsYouType,
  getCountryCallingCode,
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max'

export const SUPPORTED_COUNTRIES = [
  'AT','BE','BG','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR','HU',
  'IE','IS','IT','LI','LT','LU','LV','MC','MD','ME','MK','MT','NL','NO','PL','PT',
  'RO','RS','SE','SI','SK','SM','UA','VA','AL','AD','BA','BY','TR',
  'EG','US',
] as CountryCode[]

const SUPPORTED_SET = new Set<string>(SUPPORTED_COUNTRIES)

export const COUNTRY_NAMES: Record<string, string> = {
  AL:'Albania', AD:'Andorra', AT:'Austria', BA:'Bosnia & Herzegovina', BE:'Belgium',
  BY:'Belarus', BG:'Bulgaria', HR:'Croatia', CY:'Cyprus', CZ:'Czechia', DK:'Denmark',
  EE:'Estonia', FI:'Finland', FR:'France', DE:'Germany', GR:'Greece', HU:'Hungary',
  IS:'Iceland', IE:'Ireland', IT:'Italy', LV:'Latvia', LI:'Liechtenstein',
  LT:'Lithuania', LU:'Luxembourg', MT:'Malta', MD:'Moldova', MC:'Monaco',
  ME:'Montenegro', NL:'Netherlands', MK:'North Macedonia', NO:'Norway',
  PL:'Poland', PT:'Portugal', RO:'Romania', SM:'San Marino', RS:'Serbia',
  SK:'Slovakia', SI:'Slovenia', ES:'Spain', SE:'Sweden', CH:'Switzerland',
  TR:'Türkiye', UA:'Ukraine', GB:'United Kingdom', VA:'Vatican City',
  EG:'Egypt', US:'United States',
}

export const COUNTRY_CODES = SUPPORTED_COUNTRIES
  .filter(code => getCountries().includes(code))
  .map(code => ({
    code,
    name: COUNTRY_NAMES[code] || code,
    dial: '+' + getCountryCallingCode(code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

export function countryFlag(country: string) {
  return country
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .map(ch => String.fromCodePoint(127397 + ch.charCodeAt(0)))
    .join('')
}

export function normalizePhoneInput(value: string, defaultCountry: CountryCode) {
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0)
    )
    .replace(/[‐‑‒–—−]/g, '-')

  const cleaned = normalized.replace(/[^+\d]/g, '')
  const international = cleaned.startsWith('00') ? '+' + cleaned.slice(2) : cleaned
  const parsed = parsePhoneNumberFromString(international, defaultCountry)

  if (!parsed || !SUPPORTED_SET.has(parsed.country || '')) {
    return { e164: '', country: defaultCountry, display: formatPhoneDisplay(value, defaultCountry) }
  }

  const valid = parsed.isPossible() && parsed.isValid()
  return {
    e164: valid ? parsed.number : '',
    country: parsed.country,
    display: formatPhoneDisplay(value, parsed.country),
  }
}

export function formatPhoneDisplay(value: string, country: CountryCode) {
  const input = value.trim()
  if (!input) return ''
  const asYouType = new AsYouType(country)
  return asYouType.input(
    input
      .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0)),
  )
}

export async function detectCountryFromDevice(): Promise<CountryCode | null> {
  if (typeof navigator === 'undefined') return null

  let coordinates: { latitude: number; longitude: number } | null = null

  if ('geolocation' in navigator) {
    try {
      coordinates = await new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          position => resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
          reject,
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60 * 1000 },
        )
      })
    } catch {
      coordinates = null
    }
  }

  const params = new URLSearchParams({ localityLanguage: 'en' })
  if (coordinates) {
    params.set('latitude', String(coordinates.latitude))
    params.set('longitude', String(coordinates.longitude))
  }

  try {
    const response = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?' + params.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const data = await response.json() as { countryCode?: string }
    const code = String(data.countryCode || '').toUpperCase()
    return SUPPORTED_SET.has(code) ? code as CountryCode : null
  } catch {
    return null
  }
}

export function isSupportedCountry(country: string | undefined | null): country is CountryCode {
  return Boolean(country && SUPPORTED_SET.has(country))
}
