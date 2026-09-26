import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isPossiblePhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js'
import { ChevronDown } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PhoneNumberFieldProps = {
  value: string
  onChange: (value: string) => void
  defaultCountry?: CountryCode
  disabled?: boolean
  id?: string
  placeholder?: string
  className?: string
}

function flagForCountry(country: string) {
  return country
    .toUpperCase()
    .replace(/[A-Z]/g, char => String.fromCodePoint(char.charCodeAt(0) + 127397))
}

function asciiDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
}

function compactDigits(value: string) {
  return asciiDigits(value).replace(/\D/g, '')
}

function countryName(country: CountryCode, locale: string) {
  try {
    if (typeof Intl !== 'undefined' && 'DisplayNames' in Intl) {
      const displayNames = new Intl.DisplayNames([locale || 'en'], { type: 'region' })
      return displayNames.of(country) || country
    }
  } catch {
    // Use the ISO country code as a resilient fallback in old WebViews.
  }
  return country
}

function countryFromValue(value: string, fallback: CountryCode) {
  const parsed = parsePhoneNumberFromString(value)
  return parsed?.country || fallback
}

export function isPossibleInternationalPhone(value: string) {
  return Boolean(value && isPossiblePhoneNumber(value))
}

export default function PhoneNumberField({
  value,
  onChange,
  defaultCountry = 'EG',
  disabled = false,
  id = 'phone-number',
  placeholder = 'Phone number',
  className,
}: PhoneNumberFieldProps) {
  const locale = typeof document !== 'undefined'
    ? document.documentElement.lang || navigator.language || 'en'
    : 'en'
  const [country, setCountry] = useState<CountryCode>(() => countryFromValue(value, defaultCountry))
  const [displayValue, setDisplayValue] = useState('')
  const lastEmittedValue = useRef(value)

  const countries = useMemo(() => {
    return [...getCountries()].sort((a, b) =>
      countryName(a, locale).localeCompare(countryName(b, locale), locale),
    )
  }, [locale])

  useEffect(() => {
    if (value === lastEmittedValue.current) return
    lastEmittedValue.current = value

    if (!value) {
      setDisplayValue('')
      return
    }

    const parsed = parsePhoneNumberFromString(value)
    const nextCountry = parsed?.country || defaultCountry
    setCountry(nextCountry)

    if (parsed?.nationalNumber) {
      setDisplayValue(new AsYouType(nextCountry).input(parsed.nationalNumber))
    } else {
      setDisplayValue(value.replace(/^\+/, ''))
    }
  }, [value, defaultCountry])

  const emit = (nextValue: string) => {
    lastEmittedValue.current = nextValue
    onChange(nextValue)
  }

  const handleCountryChange = (nextCountry: CountryCode) => {
    setCountry(nextCountry)
    const digits = compactDigits(displayValue)

    if (!digits) {
      emit('')
      return
    }

    const formatter = new AsYouType(nextCountry)
    const formatted = formatter.input(digits)
    const parsed = formatter.getNumber()

    setDisplayValue(formatted)
    emit(parsed?.number || `+${getCountryCallingCode(nextCountry)}${digits}`)
  }

  const handleNumberChange = (rawValue: string) => {
    const trimmed = rawValue.trimStart()
    const rawDigits = compactDigits(rawValue)

    if (!rawDigits) {
      setDisplayValue('')
      emit('')
      return
    }

    if (trimmed.startsWith('+')) {
      const international = `+${rawDigits}`
      const parsed = parsePhoneNumberFromString(international)

      if (parsed?.country) {
        setCountry(parsed.country)
        setDisplayValue(new AsYouType(parsed.country).input(parsed.nationalNumber))
        emit(parsed.number)
      } else {
        setDisplayValue(international)
        emit(international)
      }
      return
    }

    const formatter = new AsYouType(country)
    const formatted = formatter.input(rawDigits)
    const parsed = formatter.getNumber()

    setDisplayValue(formatted)
    emit(parsed?.number || `+${getCountryCallingCode(country)}${rawDigits}`)
  }

  return (
    <div className={cn('flex min-w-0 gap-2', className)}>
      <Select value={country} onValueChange={value => handleCountryChange(value as CountryCode)} disabled={disabled}>
        <SelectTrigger
          id={`${id}-country`}
          aria-label="Country"
          className="h-10 w-[122px] shrink-0 rounded-xl px-2.5"
        >
          <SelectValue>
            <span className="flex items-center gap-1.5">
              <span className="text-base leading-none">{flagForCountry(country)}</span>
              <span className="text-xs font-semibold text-muted-foreground">+{getCountryCallingCode(country)}</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[min(60vh,420px)]">
          {countries.map(item => (
            <SelectItem key={item} value={item}>
              <span className="flex w-full items-center gap-2">
                <span className="w-6 text-center text-base leading-none">{flagForCountry(item)}</span>
                <span className="min-w-0 flex-1 truncate">{countryName(item, locale)}</span>
                <span className="text-xs text-muted-foreground">+{getCountryCallingCode(item)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        value={displayValue}
        onChange={event => handleNumberChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-10 min-w-0 flex-1 rounded-xl"
      />
    </div>
  )
}
