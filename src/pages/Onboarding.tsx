import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CountryCode } from 'libphonenumber-js'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileText,
  ImagePlus,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useYomyLanguage } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  COUNTRY_CODES,
  COUNTRY_NAMES,
  countryFlag,
  detectCountryFromDevice,
  isSupportedCountry,
  normalizePhoneInput,
} from '@/lib/phone'
import {
  confirmFirebasePhoneVerification,
  resetFirebasePhoneVerification,
  startFirebasePhoneVerification,
} from '@/lib/firebasePhone'

type Step = 'phone' | 'name' | 'photo' | 'agreement'
const LEGAL_VERSION = '2026-10-08'

const STEP_ORDER: Step[] = ['phone', 'name', 'photo', 'agreement']

function splitFullName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

function phoneErrorMessage(error: unknown, rtl = false) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : ''
  const message = error instanceof Error ? error.message : ''

  if (message.includes('PHONE_ACCOUNT_LIMIT_REACHED')) {
    return rtl
      ? 'هذا الرقم مرتبط بالفعل بحسابين على YOMY، ولا يمكن استخدامه لحساب ثالث.'
      : 'This phone number can be verified for up to two YOMY accounts only.'
  }
  if (message.includes('PHONE_AUTH_REQUIRES_HOSTED_DOMAIN')) {
    return rtl
      ? 'يجب التحقق من الرقم عبر عنوان YOMY الآمن على الإنترنت، وليس localhost.'
      : 'SMS verification must be completed from YOMY’s secure web address, not localhost.'
  }
  if (message.includes('FIREBASE_PHONE_AUTH_NOT_CONFIGURED')) {
    return rtl
      ? 'التحقق عبر الرسائل غير متاح مؤقتًا. يمكنك تخطي إضافة الرقم والمتابعة.'
      : 'Phone verification is temporarily unavailable. You can continue without a phone number.'
  }
  if (code === 'auth/invalid-phone-number') return rtl ? 'رقم الهاتف غير صالح.' : 'The phone number is not valid.'
  if (code === 'auth/too-many-requests') return rtl ? 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.' : 'Too many attempts. Please wait and try again later.'
  if (code === 'auth/quota-exceeded') return rtl ? 'تم بلوغ حد الرسائل مؤقتًا. حاول لاحقًا.' : 'The SMS quota has been reached. Please try again later.'
  if (code === 'auth/captcha-check-failed') return rtl ? 'تعذر إكمال فحص الأمان. حاول مرة أخرى.' : 'The security check could not be completed. Please try again.'
  return message || (rtl ? 'فشل التحقق من رقم الهاتف.' : 'Phone verification failed.')
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { user, profile, onboarding, refreshProfile } = useAuth()
  const { language } = useYomyLanguage()
  const rtl = language === 'ar'

  const sendPhoneAnchorRef = useRef<HTMLButtonElement>(null)
  const attemptedLocationRef = useRef(false)

  const initialStep = useMemo<Step>(() => {
    if (onboarding?.completed) return 'agreement'
    return STEP_ORDER.includes((onboarding?.step || 'phone') as Step)
      ? onboarding!.step as Step
      : 'phone'
  }, [onboarding])

  const [step, setStep] = useState<Step>(initialStep)
  const [saving, setSaving] = useState(false)

  const nameSeed = useMemo(() => {
    const draft = splitFullName(onboarding?.first_name && onboarding?.last_name
      ? `${onboarding.first_name} ${onboarding.last_name}`
      : onboarding?.first_name || onboarding?.last_name || '')
    if (draft.first || draft.last) return draft
    const profileName = splitFullName(profile?.full_name || '')
    if (profileName.first || profileName.last) return profileName
    const metaName = typeof user?.user_metadata?.full_name === 'string'
      ? splitFullName(user.user_metadata.full_name)
      : typeof user?.user_metadata?.name === 'string'
        ? splitFullName(user.user_metadata.name)
        : { first: '', last: '' }
    return metaName
  }, [onboarding, profile, user])

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  const savedCountry = localStorage.getItem('yomy-phone-country') || 'EG'
  const [country, setCountry] = useState<CountryCode>(
    isSupportedCountry(savedCountry) ? savedCountry : 'EG',
  )
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [phoneState, setPhoneState] = useState<'idle' | 'sending' | 'code' | 'verifying' | 'verified'>(
    profile?.phone_e164 ? 'verified' : 'idle',
  )
  const [detectingLocation, setDetectingLocation] = useState(false)

  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || '')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const [agreement, setAgreement] = useState(false)
  const [readMoreOpen, setReadMoreOpen] = useState(false)

  useEffect(() => {
    setStep(initialStep)
  }, [initialStep])

  useEffect(() => {
    setFirstName(nameSeed.first)
    setLastName(nameSeed.last)
  }, [nameSeed])

  useEffect(() => {
    setAvatarPreview(profile?.avatar_url || '')
  }, [profile?.avatar_url])

  useEffect(() => {
    return () => resetFirebasePhoneVerification()
  }, [])

  if (!user || !profile || !onboarding) {
    return <div className="min-h-dvh flex items-center justify-center"><Spinner className="size-7" /></div>
  }

  const index = STEP_ORDER.indexOf(step)
  const progress = ((index + 1) / STEP_ORDER.length) * 100
  const parsedPhone = normalizePhoneInput(phone, country)
  const normalizedPhone = parsedPhone.e164

  const t = {
    en: {
      welcome: 'Welcome to YOMY',
      subtitle: 'A few quick steps, then you’re ready.',
      phoneTitle: 'Add your phone number',
      phoneSub: 'Your number helps protect your account. It stays optional.',
      phoneNext: 'Verify & continue',
      skip: 'Skip for now',
      codeTitle: 'Enter the code',
      codeSub: 'We sent a verification code to',
      verify: 'Verify',
      resend: 'Send again',
      nameTitle: 'What should we call you?',
      nameSub: 'Use your real name or the name people know you by.',
      first: 'First name',
      last: 'Last name',
      photoTitle: 'Add a profile photo',
      photoSub: 'Show the people you know that it’s you.',
      camera: 'Camera',
      gallery: 'Choose from gallery',
      photoSkip: 'Skip for now',
      agreementTitle: 'Your YOMY agreement',
      agreementSub: 'Before you enter the community, know what YOMY expects from all of us.',
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      community: 'Community Guidelines',
      trust: 'Respect, authenticity, privacy, and safety come first.',
      finish: 'Agree & enter YOMY',
      next: 'Next',
      back: 'Back',
      detect: 'Use my location',
      detected: 'Country detected',
      phoneHint: 'Type your local number and YOMY will format the international number.',
      invalidPhone: 'Enter a valid phone number for the selected country.',
      support: 'Supported: Egypt, United States, and European countries.',
      nameRequired: 'Enter your first name to continue.',
      legalRequired: 'Please review and accept the YOMY agreement.',
      uploadFailed: 'Photo upload failed.',
      saved: 'Saved',
      ready: 'You’re all set.',
      agreementLead: 'Please take a moment to review what YOMY is asking you to accept and what you can expect from the service.',
      readMore: 'Read more',
      readMoreTitle: 'Before you agree to YOMY',
      readMoreBody: 'YOMY is built around clear communication, privacy, account security, and respectful participation. By continuing, you confirm that you have reviewed the Terms of Service, Privacy Policy, and Community Guidelines in the version shown below.',
      reviewTerms: 'Open the full documents',
      close: 'Close',
    },
    ar: {
      welcome: 'أهلًا بك في YOMY',
      subtitle: 'خطوات بسيطة وسريعة، وبعدها تصبح جاهزًا.',
      phoneTitle: 'أضف رقم هاتفك',
      phoneSub: 'يساعد رقمك على حماية حسابك، لكنه يظل اختياريًا.',
      phoneNext: 'تحقق وتابع',
      skip: 'تخطي الآن',
      codeTitle: 'أدخل رمز التحقق',
      codeSub: 'أرسلنا رمز التحقق إلى',
      verify: 'تحقق',
      resend: 'إرسال مرة أخرى',
      nameTitle: 'ما الاسم الذي نستخدمه؟',
      nameSub: 'استخدم اسمك الحقيقي أو الاسم الذي يعرفك به الناس.',
      first: 'الاسم الأول',
      last: 'اسم العائلة',
      photoTitle: 'أضف صورة لحسابك',
      photoSub: 'ساعد معارفك على معرفة أن هذا حسابك.',
      camera: 'الكاميرا',
      gallery: 'اختيار من المعرض',
      photoSkip: 'تخطي الآن',
      agreementTitle: 'اتفاقية YOMY',
      agreementSub: 'قبل دخولك للمجتمع، تعرّف على ما نتوقعه منك وما يمكنك توقعه منا.',
      terms: 'شروط الاستخدام',
      privacy: 'سياسة الخصوصية',
      community: 'إرشادات المجتمع',
      trust: 'الاحترام والأصالة والخصوصية والأمان أولًا.',
      finish: 'أوافق وأدخل YOMY',
      next: 'التالي',
      back: 'رجوع',
      detect: 'استخدم موقعي',
      detected: 'تم تحديد البلد',
      phoneHint: 'اكتب الرقم محليًا وسيحوّله YOMY تلقائيًا للصيغة الدولية.',
      invalidPhone: 'أدخل رقمًا صحيحًا للبلد المحدد.',
      support: 'الدول المدعومة: مصر والولايات المتحدة والدول الأوروبية.',
      nameRequired: 'أدخل اسمك الأول للمتابعة.',
      legalRequired: 'راجع اتفاقية YOMY ووافق عليها للمتابعة.',
      uploadFailed: 'تعذر رفع الصورة.',
      saved: 'تم الحفظ',
      ready: 'أنت جاهز الآن.',
      agreementLead: 'قبل الموافقة، خذ لحظة لمراجعة ما تطلبه منك YOMY وما يمكنك توقعه من الخدمة.',
      readMore: 'اقرأ المزيد',
      readMoreTitle: 'قبل أن توافق على YOMY',
      readMoreBody: 'صمّمنا YOMY ليقوم على وضوح التواصل والخصوصية وأمان الحساب والاستخدام المحترم. بمتابعة التسجيل، تؤكد أنك راجعت شروط الاستخدام وسياسة الخصوصية وإرشادات المجتمع وفق الإصدار الموضح أدناه.',
      reviewTerms: 'فتح المستندات الكاملة',
      close: 'إغلاق',
    },
  }[rtl ? 'ar' : 'en']

  const updateStep = async (next: Step) => {
    setSaving(true)
    const { error } = await supabase
      .from('user_onboarding')
      .update({ step: next })
      .eq('user_id', user.id)
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return false
    }
    await refreshProfile()
    setStep(next)
    return true
  }

  const detectCountry = async () => {
    if (detectingLocation) return
    setDetectingLocation(true)
    try {
      const detected = await detectCountryFromDevice()
      if (!detected) {
        toast.error(rtl ? 'تعذر تحديد البلد تلقائيًا.' : 'Could not determine your country automatically.')
        return
      }
      setCountry(detected)
      localStorage.setItem('yomy-phone-country', detected)
      if (phone) setPhone(normalizePhoneInput(phone, detected).display)
      toast.success(`${countryFlag(detected)} ${COUNTRY_NAMES[detected]} ${t.detected}`)
    } finally {
      setDetectingLocation(false)
    }
  }

  const attachVerifiedPhone = async (phoneToAttach: string, nonce: string) => {
    const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
      body: { action: 'attach_verified_phone', phone: phoneToAttach, nonce },
    })
    if (error || data?.error) throw new Error(data?.error || error?.message || 'PHONE_ATTACH_FAILED')
    setPhoneState('verified')
    await refreshProfile()
    toast.success(rtl ? 'تم توثيق رقم الهاتف.' : 'Phone verified.')
  }

  const startPhone = async () => {
    if (!normalizedPhone) {
      toast.error(t.invalidPhone)
      return
    }
    if (!isSupportedCountry(parsedPhone.country)) {
      toast.error(t.support)
      return
    }
    if (!sendPhoneAnchorRef.current) return
    setPhoneState('sending')
    try {
      const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
        body: { action: 'check_phone_signup', phone: normalizedPhone },
      })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'PHONE_VERIFICATION_UNAVAILABLE')
      const started = await startFirebasePhoneVerification(normalizedPhone, sendPhoneAnchorRef.current, language)
      if (started.automaticallyVerified) {
        setPhoneState('verifying')
        const verified = await confirmFirebasePhoneVerification('', normalizedPhone)
        await attachVerifiedPhone(normalizedPhone, verified.nonce)
        return
      }
      setPhoneState('code')
      setCode('')
      toast.success(rtl ? 'تم إرسال رمز التحقق.' : 'Verification code sent.')
    } catch (error) {
      resetFirebasePhoneVerification()
      setPhoneState('idle')
      toast.error(phoneErrorMessage(error, rtl))
    }
  }

  const verifyPhone = async () => {
    if (!/^\\d{4,10}$/.test(code.trim()) || !normalizedPhone) return
    setPhoneState('verifying')
    try {
      const verified = await confirmFirebasePhoneVerification(code.trim(), normalizedPhone)
      await attachVerifiedPhone(normalizedPhone, verified.nonce)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setPhoneState(
        message === 'PHONE_TOKEN_MISMATCH' || message === 'PHONE_VERIFICATION_NOT_STARTED'
          ? 'idle'
          : 'code',
      )
      toast.error(phoneErrorMessage(error, rtl))
    }
  }

  const selectCountry = (next: CountryCode) => {
    resetFirebasePhoneVerification()
    setCountry(next)
    localStorage.setItem('yomy-phone-country', next)
    setPhone(normalizePhoneInput(phone, next).display)
    setPhoneState('idle')
    setCode('')
  }

  const saveNames = async () => {
    if (!firstName.trim()) {
      toast.error(t.nameRequired)
      return
    }
    setSaving(true)
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
    const [{ error: profileError }, { error: onboardingError }] = await Promise.all([
      supabase.from('profiles').update({ full_name: fullName }).eq('id', user.id),
      supabase.from('user_onboarding').update({
        first_name: firstName.trim().slice(0, 60),
        last_name: lastName.trim().slice(0, 60),
        step: 'photo',
      }).eq('user_id', user.id),
    ])
    setSaving(false)
    if (profileError || onboardingError) {
      toast.error((profileError || onboardingError)?.message || 'Could not save your name.')
      return
    }
    await refreshProfile()
    setStep('photo')
  }

  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t.uploadFailed)
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(rtl ? 'حجم الصورة يجب ألا يتجاوز 5MB.' : 'Please choose an image no larger than 5MB.')
      return
    }
    setUploadingPhoto(true)
    try {
      const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'
      const path = `${user.id}/avatar.${extension}`
      const { error: uploadError } = await supabase.storage.from('profile-avatars').upload(path, file, {
        upsert: true,
        cacheControl: '3600',
        contentType: file.type,
      })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('profile-avatars').getPublicUrl(path)
      const { error: profileError } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', user.id)
      if (profileError) throw profileError
      setAvatarPreview(data.publicUrl)
      await refreshProfile()
      toast.success(t.saved)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.uploadFailed)
    } finally {
      setUploadingPhoto(false)
    }
  }

  const finishAgreement = async () => {
    if (!agreement) {
      toast.error(t.legalRequired)
      return
    }
    setSaving(true)
    const acceptedAt = new Date().toISOString()
    const { error } = await supabase
      .from('user_onboarding')
      .update({
        step: 'complete',
        completed: true,
        legal_terms_accepted: true,
        legal_privacy_accepted: true,
        legal_community_accepted: true,
        legal_version: LEGAL_VERSION,
        legal_accepted_at: acceptedAt,
        completed_at: acceptedAt,
      })
      .eq('user_id', user.id)
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    await refreshProfile()
    toast.success(t.ready)
    navigate('/', { replace: true })
  }

  const nextFromPhone = async () => {
    if (phoneState === 'code' || phoneState === 'verifying') return
    if (normalizedPhone && phoneState !== 'verified') {
      await startPhone()
      return
    }
    await updateStep('name')
  }

  return (
    <div className="yomy-glass-page min-h-dvh px-4 py-5 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-lg flex-col">
        <header className="flex items-center justify-between gap-3 py-2">
          <button
            type="button"
            onClick={() => index > 0 && setStep(STEP_ORDER[index - 1])}
            disabled={index === 0 || saving || uploadingPhoto}
            className="yomy-ios-press inline-flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card/45 disabled:invisible"
            aria-label={t.back}
          >
            {rtl ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}
          </button>

          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3.5 text-primary" />
              <span className="text-[11px] font-bold tracking-[.28em] text-primary">YOMY</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{index + 1} / {STEP_ORDER.length}</p>
          </div>

          <div className="size-10" />
        </header>

        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted/60">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-400 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <div className="pointer-events-none absolute left-1/2 top-24 hidden size-48 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl sm:block" />

        <main className="yomy-ios-panel flex-1 overflow-hidden border-white/10">
          {step === 'phone' && (
            <section className="flex h-full flex-col">
              <div className="px-6 pb-4 pt-7 text-center">
                <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary">
                  <MapPin className="size-7" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">{t.phoneTitle}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.phoneSub}</p>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-5">
                <div className="flex gap-2">
                  <select
                    value={country}
                    onChange={e => selectCountry(e.target.value as CountryCode)}
                    className="h-12 w-[7.8rem] rounded-2xl border border-border/70 bg-background/55 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    aria-label="Country"
                  >
                    {COUNTRY_CODES.map(item => (
                      <option key={item.code} value={item.code}>
                        {countryFlag(item.code)} {item.dial}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={phone}
                    onChange={e => {
                      resetFirebasePhoneVerification()
                      setPhone(normalizePhoneInput(e.target.value, country).display)
                      setPhoneState('idle')
                      setCode('')
                    }}
                    onFocus={() => {
                      if (attemptedLocationRef.current) return
                      attemptedLocationRef.current = true
                      void detectCountry()
                    }}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={country === 'EG' ? '010 1234 5678' : 'Phone number'}
                    className="h-12 rounded-2xl bg-background/55"
                  />
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/35 p-3 text-xs leading-5 text-muted-foreground">
                  <p>{t.phoneHint}</p>
                  <p className="mt-1">{t.support}</p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-2xl"
                  disabled={detectingLocation}
                  onClick={() => void detectCountry()}
                >
                  <MapPin className="mr-2 size-4" />
                  {detectingLocation ? '…' : t.detect}
                </Button>

                {phoneState === 'verified' && profile.phone_e164 ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
                      <Check className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{rtl ? 'رقم موثق' : 'Phone verified'}</p>
                      <p className="truncate text-xs text-muted-foreground">{profile.phone_e164}</p>
                    </div>
                  </div>
                ) : phoneState === 'code' || phoneState === 'verifying' ? (
                  <div className="space-y-3 rounded-2xl border border-border/60 bg-background/35 p-4">
                    <div>
                      <p className="text-sm font-semibold">{t.codeTitle}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t.codeSub} {normalizedPhone}</p>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={code}
                        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        className="h-11 rounded-xl"
                      />
                      <Button
                        type="button"
                        className="h-11 rounded-xl"
                        disabled={phoneState === 'verifying' || code.trim().length < 4}
                        onClick={() => void verifyPhone()}
                      >
                        {phoneState === 'verifying' ? <Spinner className="size-4" /> : t.verify}
                      </Button>
                    </div>
                    <button type="button" className="text-xs font-semibold text-primary" onClick={() => { resetFirebasePhoneVerification(); setPhoneState('idle') }}>
                      {rtl ? 'تغيير الرقم' : 'Change number'}
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    className="h-12 w-full rounded-2xl"
                    disabled={!normalizedPhone || phoneState === 'sending'}
                    onClick={() => void nextFromPhone()}
                  >
                    {phoneState === 'sending' ? <Spinner className="size-4" /> : t.phoneNext}
                  </Button>
                )}
              </div>

              <div className="border-t border-border/60 p-5">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full rounded-2xl text-muted-foreground"
                  disabled={saving}
                  onClick={() => void updateStep('name')}
                >
                  {t.skip}
                </Button>
              </div>
            </section>
          )}

          {step === 'name' && (
            <section className="flex h-full flex-col">
              <div className="px-6 pb-5 pt-8 text-center">
                <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary">
                  <Users className="size-7" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">{t.nameTitle}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.nameSub}</p>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="first-name" className="text-xs font-semibold">{t.first}</label>
                    <Input id="first-name" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} className="h-12 rounded-2xl bg-background/55" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="last-name" className="text-xs font-semibold">{t.last}</label>
                    <Input id="last-name" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} className="h-12 rounded-2xl bg-background/55" />
                  </div>
                </div>
              </div>
              <div className="border-t border-border/60 p-5">
                <Button type="button" className="h-12 w-full rounded-2xl" disabled={saving} onClick={() => void saveNames()}>
                  {saving ? <Spinner className="size-4" /> : <>{t.next}<ArrowRight className="ml-2 size-4" /></>}
                </Button>
              </div>
            </section>
          )}

          {step === 'photo' && (
            <section className="flex h-full flex-col">
              <div className="px-6 pb-5 pt-8 text-center">
                <div className="relative mx-auto mb-5 flex size-24 items-center justify-center">
                  <Avatar className="size-24 ring-1 ring-border">
                    <AvatarImage src={avatarPreview} />
                    <AvatarFallback className="bg-primary/10 text-2xl font-bold">{(firstName || user.email || 'Y')[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                    <Camera className="size-4" />
                  </span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight">{t.photoTitle}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.photoSub}</p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-6">
                <label className="yomy-ios-press flex cursor-pointer items-center gap-3 rounded-2xl border border-border/60 bg-background/45 p-4">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Camera className="size-5" /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{t.camera}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{rtl ? 'التقاط صورة الآن' : 'Take a photo now'}</span>
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={uploadingPhoto}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) void uploadPhoto(file)
                      e.currentTarget.value = ''
                    }}
                  />
                </label>

                <label className="yomy-ios-press flex cursor-pointer items-center gap-3 rounded-2xl border border-border/60 bg-background/45 p-4">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><ImagePlus className="size-5" /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{t.gallery}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{rtl ? 'اختر صورة من جهازك' : 'Choose an existing photo'}</span>
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingPhoto}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) void uploadPhoto(file)
                      e.currentTarget.value = ''
                    }}
                  />
                </label>

                {uploadingPhoto && (
                  <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-background/35 p-3 text-xs text-muted-foreground">
                    <Spinner className="size-4" /> {rtl ? 'جارٍ رفع الصورة…' : 'Uploading photo…'}
                  </div>
                )}
              </div>

              <div className="border-t border-border/60 p-5 space-y-2">
                <Button type="button" className="h-12 w-full rounded-2xl" disabled={uploadingPhoto || saving} onClick={() => void updateStep('agreement')}>
                  {t.next}<ArrowRight className="ml-2 size-4" />
                </Button>
                <Button type="button" variant="ghost" className="h-10 w-full rounded-2xl text-muted-foreground" disabled={uploadingPhoto || saving} onClick={() => void updateStep('agreement')}>
                  {t.photoSkip}
                </Button>
              </div>
            </section>
          )}

          {step === 'agreement' && (
            <section className="flex h-full flex-col">
              <div className="px-6 pb-4 pt-7 text-center">
                <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary">
                  <ShieldCheck className="size-7" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">{t.agreementTitle}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.agreementSub}</p>
              </div>

              <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{t.agreementTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.agreementLead}</p>
                    <button
                      type="button"
                      className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/55 px-3.5 py-2 text-xs font-semibold text-primary shadow-sm transition-colors hover:bg-background/75"
                      onClick={() => setReadMoreOpen(true)}
                    >
                      <FileText className="size-3.5" />
                      {t.readMore}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-5">
                {[
                  { icon: FileText, title: t.terms, body: rtl ? 'استخدم YOMY بشكل قانوني، واحترم حسابات الآخرين ومحتواهم وحقوقهم.' : 'Use YOMY lawfully and respect other people, their accounts, content, and rights.', href: '/terms' },
                  { icon: ShieldCheck, title: t.privacy, body: rtl ? 'نوضح ما نعالجه من معلومات ولماذا، ونمنحك أدوات للتحكم في خصوصيتك.' : 'We explain what information YOMY processes and give you meaningful privacy controls.', href: '/privacy' },
                  { icon: Users, title: t.community, body: rtl ? 'لا تنمر أو تهديد أو انتحال أو احتيال أو إساءة استخدام للمنصة.' : 'No harassment, threats, impersonation, fraud, or abusive use of the platform.', href: '/community-guidelines' },
                ].map(item => {
                  const Icon = item.icon
                  return (
                    <a
                      key={item.title}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="yomy-ios-press block rounded-2xl border border-border/60 bg-background/40 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{item.title}</span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.body}</span>
                        </span>
                      </div>
                    </a>
                  )
                })}

                <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ShieldCheck className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{t.trust}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {rtl
                          ? 'نريد مساحة اجتماعية تشعرك بالراحة والسرعة والثقة. تعامل مع الآخرين كما تريد أن يُتعامل معك.'
                          : 'YOMY should feel fast, human, safe, and welcoming. Treat people the way you expect to be treated.'}
                      </p>
                    </div>
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 bg-background/55 p-4">
                  <Checkbox checked={agreement} onCheckedChange={value => setAgreement(value === true)} className="mt-0.5 shrink-0" />
                  <span className="text-xs leading-5">
                    {rtl
                      ? 'أوافق على شروط استخدام YOMY وسياسة الخصوصية وإرشادات المجتمع.'
                      : 'I agree to the YOMY Terms of Service, Privacy Policy, and Community Guidelines.'}
                  </span>
                </label>
              </div>

              <div className="border-t border-border/60 p-5">
                <Button type="button" className="h-12 w-full rounded-2xl" disabled={!agreement || saving} onClick={() => void finishAgreement()}>
                  {saving ? <Spinner className="size-4" /> : <>{t.finish}<ArrowRight className="ml-2 size-4" /></>}
                </Button>
              </div>
            </section>
          )}
        <Dialog open={readMoreOpen} onOpenChange={setReadMoreOpen}>
          <DialogContent dir={rtl ? "rtl" : "ltr"} className="yomy-ios-panel max-h-[82dvh] overflow-y-auto border-white/10 p-0 sm:max-w-lg">
            <DialogHeader className="px-6 pb-2 pt-6">
              <DialogTitle className="text-xl tracking-tight">{t.readMoreTitle}</DialogTitle>
              <DialogDescription className="text-sm leading-6">{t.readMoreBody}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-6 pb-2">
              <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                <p className="text-sm font-semibold">{t.terms}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {rtl ? "ستعرف قواعد استخدام الخدمة ومسؤوليتك عن حسابك ومحتواك، ومتى قد نقيّد ميزات أو حسابات لحماية المجتمع." : "Understand the rules for using YOMY, your responsibility for your account and content, and when access or features may be restricted to protect the community."}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                <p className="text-sm font-semibold">{t.privacy}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {rtl ? "تعرف ما المعلومات التي قد نعالجها، ولماذا نستخدمها، وكيف تبقى خيارات الخصوصية والوصول والتصحيح والحذف متاحة بحسب الميزة والقانون." : "Learn what information YOMY may process, why it is used, and what privacy, access, correction, or deletion choices may be available to you."}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                <p className="text-sm font-semibold">{t.community}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {rtl ? "المطلوب هو الاحترام وعدم التهديد أو التنمر أو الانتحال أو الاحتيال أو إساءة استخدام المنصة." : "Participation must be respectful: no harassment, threats, impersonation, fraud, or abusive use of the platform."}
                </p>
              </div>
            </div>

            <DialogFooter className="flex-col px-6 pb-6 pt-3 sm:flex-row">
              <div className="flex flex-1 flex-wrap gap-2">
                <a href="/terms" className="text-xs font-semibold text-primary underline-offset-4 hover:underline">{t.terms}</a>
                <a href="/privacy" className="text-xs font-semibold text-primary underline-offset-4 hover:underline">{t.privacy}</a>
                <a href="/community-guidelines" className="text-xs font-semibold text-primary underline-offset-4 hover:underline">{t.community}</a>
              </div>
              <Button type="button" className="rounded-2xl" onClick={() => setReadMoreOpen(false)}>{t.close}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        </main>

        <div className="pt-3 text-center text-[10px] text-muted-foreground">
          {t.welcome} · {t.subtitle}
        </div>

        <button
          ref={sendPhoneAnchorRef}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 pointer-events-none"
        />
      </div>
    </div>
  )
}
