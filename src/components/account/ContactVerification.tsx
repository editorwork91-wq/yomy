import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, CircleAlert, Mail, Phone, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { CountryCode } from 'libphonenumber-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useYomyLanguage } from '@/lib/i18n'
import { getPublicAppUrl } from '@/lib/appOrigin'
import { COUNTRY_CODES, countryFlag, isSupportedCountry, normalizePhoneInput } from '@/lib/phone'
import { confirmFirebasePhoneVerification, resetFirebasePhoneVerification, startFirebasePhoneVerification } from '@/lib/firebasePhone'
import { clearPendingPhoneDraft, readPendingPhoneDraft, savePendingPhoneDraft } from '@/lib/phoneDraft'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

function friendlyPhoneError(error: unknown, rtl: boolean) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'PHONE_AUTH_REQUIRES_HOSTED_DOMAIN') return rtl
    ? 'إرسال SMS يحتاج فتح YOMY من عنوان HTTPS المنشور، وليس localhost.'
    : 'SMS verification needs YOMY’s published HTTPS address, not localhost.'
  if (message.includes('PHONE_ACCOUNT_LIMIT_REACHED')) return rtl
    ? 'هذا الرقم مرتبط بالفعل بحسابين، وهو الحد الأقصى المسموح.'
    : 'This number is already linked to two accounts, the maximum allowed.'
  if (message.includes('FIREBASE_PHONE_AUTH_NOT_CONFIGURED')) return rtl
    ? 'خدمة التحقق غير مكتملة الإعداد. يمكنك حفظ الرقم دون توثيق والمحاولة لاحقًا.'
    : 'Phone verification is not fully configured yet. You can save the number as unverified and try later.'
  if (message.includes('auth/too-many-requests') || message.includes('TOO_MANY_ATTEMPTS')) return rtl
    ? 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.'
    : 'Too many attempts. Please wait a little and try again.'
  if (message.includes('PHONE_VERIFICATION_TIMEOUT')) return rtl
    ? 'انتهت مهلة التحقق. أعد إرسال الرمز.'
    : 'Verification timed out. Please resend the code.'
  if (message) return message
  return rtl ? 'تعذر إكمال التحقق. حاول مرة أخرى.' : 'Verification could not be completed. Please try again.'
}

function VerificationStatus({ verified, label }: { verified: boolean; label: string }) {
  return verified
    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-500"><BadgeCheck className="size-4" />{label}</span>
    : <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500"><span className="size-2 rounded-full bg-rose-500" />{label}</span>
}

export default function ContactVerification() {
  const { user, profile, refreshProfile } = useAuth()
  const { language } = useYomyLanguage()
  const rtl = language === 'ar'
  const sendButtonRef = useRef<HTMLButtonElement>(null)

  const [pendingPhone, setPendingPhone] = useState('')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [country, setCountry] = useState<CountryCode>(() => {
    const stored = localStorage.getItem('yomy-phone-country') || 'EG'
    return isSupportedCountry(stored) ? stored : 'EG'
  })
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneMode, setPhoneMode] = useState<'idle' | 'sending' | 'code' | 'verifying'>('idle')
  const [phoneCooldown, setPhoneCooldown] = useState(0)

  const [emailOpen, setEmailOpen] = useState(false)
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeReady, setEmailCodeReady] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailCooldown, setEmailCooldown] = useState(0)

  const verifiedPhone = Boolean(profile?.phone_e164 && profile?.phone_verified_at)
  const verifiedEmail = Boolean(user?.email_confirmed_at)
  const activeEmail = user?.email || ''
  const parsedPhone = useMemo(() => normalizePhoneInput(phoneDraft, country), [phoneDraft, country])

  const copy = ({
    en: {
      title: "Personal information", subtitle: "Verification status for your contact details", email: "Email address", phone: "Phone number",
      verified: "Verified", unverified: "Not verified", notAdded: "No phone added", pending: "Pending verification",
      verifyEmail: "Verify email", managePhone: "Add or change number", emailDialog: "Verify your email",
      emailHelp: "Send a confirmation email. Enter its code here if one is included, or open the verification link in the message.",
      sendEmail: "Send confirmation email", emailCode: "Email verification code", verifyCode: "Verify", sendSms: "Send SMS code",
      phoneDialog: "Verify your phone number", phoneHelp: "Choose a country calling code or enter an international number with +. Local numbers are formatted for the selected country.",
      chooseCountry: "Country calling code", phoneNumber: "Phone number", code: "SMS verification code",
      saveUnverified: "Save without verifying", resend: "Resend code", close: "Close",
      savedUnverified: "The number was saved as unverified.", smsSent: "Verification code sent.",
      phoneSuccess: "Phone number verified successfully.", emailSent: "Confirmation email sent. Check your inbox and spam folder.",
      emailSuccess: "Email verified successfully.",
    },
    ar: {
      title: "المعلومات الشخصية", subtitle: "حالة توثيق بيانات التواصل", email: "البريد الإلكتروني", phone: "رقم الهاتف",
      verified: "موثّق", unverified: "غير موثّق", notAdded: "لم تتم إضافة رقم", pending: "رقم ينتظر التوثيق",
      verifyEmail: "توثيق البريد", managePhone: "إضافة أو تغيير الرقم", emailDialog: "تأكيد البريد الإلكتروني",
      emailHelp: "أرسل رسالة التأكيد. إذا احتوت على رمز، أدخله هنا؛ وإذا احتوت على رابط، افتحه لإتمام التوثيق.",
      sendEmail: "إرسال رسالة تأكيد", emailCode: "رمز البريد الإلكتروني", verifyCode: "تحقق", sendSms: "إرسال رمز SMS",
      phoneDialog: "توثيق رقم الهاتف", phoneHelp: "اختر مفتاح الدولة أو اكتب الرقم الدولي مع +. الأرقام المحلية تُنسّق تلقائيًا حسب الدولة المختارة.",
      chooseCountry: "الدولة ومفتاح الاتصال", phoneNumber: "رقم الهاتف", code: "رمز SMS",
      saveUnverified: "حفظ دون توثيق", resend: "إعادة إرسال الرمز", close: "إغلاق",
      savedUnverified: "تم حفظ الرقم كرقم غير موثّق.", smsSent: "تم إرسال رمز التحقق.",
      phoneSuccess: "تم توثيق رقم الهاتف بنجاح.", emailSent: "أُرسلت رسالة التأكيد. افحص البريد الوارد والرسائل غير المرغوب فيها.",
      emailSuccess: "تم توثيق البريد الإلكتروني.",
    },
    de: {
      title: "Persönliche Informationen", subtitle: "Verifizierungsstatus deiner Kontaktdaten", email: "E-Mail-Adresse", phone: "Telefonnummer",
      verified: "Verifiziert", unverified: "Nicht verifiziert", notAdded: "Keine Telefonnummer hinzugefügt", pending: "Verifizierung ausstehend",
      verifyEmail: "E-Mail bestätigen", managePhone: "Nummer hinzufügen oder ändern", emailDialog: "E-Mail bestätigen",
      emailHelp: "Sende eine Bestätigungs-E-Mail. Gib den Code hier ein, falls einer enthalten ist, oder öffne den Bestätigungslink.",
      sendEmail: "Bestätigungs-E-Mail senden", emailCode: "E-Mail-Bestätigungscode", verifyCode: "Bestätigen", sendSms: "SMS-Code senden",
      phoneDialog: "Telefonnummer bestätigen", phoneHelp: "Wähle eine Landesvorwahl oder gib eine internationale Nummer mit + ein. Lokale Nummern werden für das ausgewählte Land formatiert.",
      chooseCountry: "Landesvorwahl", phoneNumber: "Telefonnummer", code: "SMS-Bestätigungscode",
      saveUnverified: "Unbestätigt speichern", resend: "Code erneut senden", close: "Schließen",
      savedUnverified: "Die Nummer wurde als nicht verifiziert gespeichert.", smsSent: "Bestätigungscode gesendet.",
      phoneSuccess: "Telefonnummer erfolgreich bestätigt.", emailSent: "Bestätigungs-E-Mail gesendet. Prüfe auch den Spam-Ordner.",
      emailSuccess: "E-Mail erfolgreich bestätigt.",
    },
    fr: {
      title: "Informations personnelles", subtitle: "État de vérification de vos coordonnées", email: "Adresse e-mail", phone: "Numéro de téléphone",
      verified: "Vérifié", unverified: "Non vérifié", notAdded: "Aucun numéro ajouté", pending: "Vérification en attente",
      verifyEmail: "Vérifier l’e-mail", managePhone: "Ajouter ou modifier le numéro", emailDialog: "Vérifier votre e-mail",
      emailHelp: "Envoyez un e-mail de confirmation. Saisissez son code ici s’il en contient un, ou ouvrez le lien de vérification.",
      sendEmail: "Envoyer l’e-mail de confirmation", emailCode: "Code de vérification e-mail", verifyCode: "Vérifier", sendSms: "Envoyer le code SMS",
      phoneDialog: "Vérifier votre numéro", phoneHelp: "Choisissez l’indicatif du pays ou saisissez un numéro international avec +. Les numéros locaux sont formatés selon le pays sélectionné.",
      chooseCountry: "Indicatif du pays", phoneNumber: "Numéro de téléphone", code: "Code de vérification SMS",
      saveUnverified: "Enregistrer sans vérifier", resend: "Renvoyer le code", close: "Fermer",
      savedUnverified: "Le numéro a été enregistré comme non vérifié.", smsSent: "Code de vérification envoyé.",
      phoneSuccess: "Numéro de téléphone vérifié avec succès.", emailSent: "E-mail de confirmation envoyé. Vérifiez aussi les courriers indésirables.",
      emailSuccess: "Adresse e-mail vérifiée avec succès.",
    },
    es: {
      title: "Información personal", subtitle: "Estado de verificación de tus datos de contacto", email: "Correo electrónico", phone: "Número de teléfono",
      verified: "Verificado", unverified: "Sin verificar", notAdded: "No se ha añadido ningún número", pending: "Verificación pendiente",
      verifyEmail: "Verificar correo", managePhone: "Añadir o cambiar número", emailDialog: "Verifica tu correo",
      emailHelp: "Envía un correo de confirmación. Introduce aquí el código si aparece, o abre el enlace de verificación del mensaje.",
      sendEmail: "Enviar correo de confirmación", emailCode: "Código de verificación del correo", verifyCode: "Verificar", sendSms: "Enviar código SMS",
      phoneDialog: "Verifica tu número", phoneHelp: "Elige el prefijo del país o escribe un número internacional con +. Los números locales se formatean según el país seleccionado.",
      chooseCountry: "Prefijo del país", phoneNumber: "Número de teléfono", code: "Código de verificación SMS",
      saveUnverified: "Guardar sin verificar", resend: "Reenviar código", close: "Cerrar",
      savedUnverified: "El número se guardó sin verificar.", smsSent: "Código de verificación enviado.",
      phoneSuccess: "Número de teléfono verificado correctamente.", emailSent: "Correo de confirmación enviado. Revisa también la carpeta de spam.",
      emailSuccess: "Correo electrónico verificado correctamente.",
    },
  } as const)[language]

  useEffect(() => {
    if (!user?.id) return
    let active = true
    readPendingPhoneDraft(user.id).then(value => { if (active) setPendingPhone(value) }).catch(() => undefined)
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (phoneCooldown <= 0) return
    const timer = window.setTimeout(() => setPhoneCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [phoneCooldown])

  useEffect(() => {
    if (emailCooldown <= 0) return
    const timer = window.setTimeout(() => setEmailCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [emailCooldown])

  const openPhoneDialog = () => {
    const initialValue = pendingPhone || profile?.phone_e164 || ''
    const normalized = normalizePhoneInput(initialValue, country)
    if (normalized.e164 && normalized.country !== country) {
      setCountry(normalized.country)
      localStorage.setItem('yomy-phone-country', normalized.country)
    }
    setPhoneDraft(normalized.display || initialValue)
    setPhoneCode('')
    setPhoneMode('idle')
    setPhoneOpen(true)
  }

  const savePending = async (phone: string) => {
    if (!user) throw new Error('AUTH_REQUIRED')
    await savePendingPhoneDraft(user.id, phone)
    setPendingPhone(phone)
  }

  const attachVerifiedPhone = async (phone: string, nonce: string) => {
    if (!user) throw new Error('AUTH_REQUIRED')
    const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
      body: { action: 'attach_verified_phone', phone, nonce },
    })
    if (error || data?.error) throw new Error(data?.error || error?.message || 'PHONE_ATTACH_FAILED')
    await clearPendingPhoneDraft(user.id).catch(() => undefined)
    setPendingPhone('')
    await refreshProfile()
    setPhoneMode('idle')
    setPhoneOpen(false)
    toast.success(copy.phoneSuccess)
  }

  const sendPhoneCode = async () => {
    if (!user || !phoneOpen || phoneMode === 'sending' || !sendButtonRef.current) return
    const phone = parsedPhone.e164
    if (!phone) {
      toast.error(rtl ? 'أدخل رقمًا صحيحًا مع مفتاح الدولة.' : 'Enter a valid phone number with the correct country code.')
      return
    }
    if (!isSupportedCountry(parsedPhone.country)) {
      toast.error(rtl ? 'اختر دولة مدعومة.' : 'Please choose a supported country.')
      return
    }
    if (verifiedPhone && phone === profile?.phone_e164) {
      toast.success(rtl ? 'هذا الرقم موثّق بالفعل.' : 'This phone number is already verified.')
      setPhoneOpen(false)
      return
    }

    setPhoneMode('sending')
    try {
      const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
        body: { action: 'check_phone_signup', phone },
      })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'PHONE_VERIFICATION_UNAVAILABLE')
      await savePending(phone)
      localStorage.setItem('yomy-phone-country', parsedPhone.country)
      const started = await startFirebasePhoneVerification(phone, sendButtonRef.current, language)
      if (started.automaticallyVerified) {
        setPhoneMode('verifying')
        const verification = await confirmFirebasePhoneVerification('', phone)
        await attachVerifiedPhone(phone, verification.nonce)
        return
      }
      setPhoneCode('')
      setPhoneMode('code')
      setPhoneCooldown(30)
      toast.success(copy.smsSent)
    } catch (error) {
      setPhoneMode('idle')
      toast.error(friendlyPhoneError(error, rtl))
    }
  }

  const resendPhoneCode = async () => {
    if (phoneCooldown > 0 || phoneMode === 'sending' || phoneMode === 'verifying') return
    resetFirebasePhoneVerification()
    await sendPhoneCode()
  }

  const verifyPhoneCode = async () => {
    if (!parsedPhone.e164 || !/^\d{4,10}$/.test(phoneCode.trim())) return
    setPhoneMode('verifying')
    try {
      const verification = await confirmFirebasePhoneVerification(phoneCode.trim(), parsedPhone.e164)
      await attachVerifiedPhone(parsedPhone.e164, verification.nonce)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setPhoneMode(message === 'PHONE_TOKEN_MISMATCH' || message === 'PHONE_VERIFICATION_NOT_STARTED' ? 'idle' : 'code')
      toast.error(friendlyPhoneError(error, rtl))
    }
  }

  const saveWithoutVerification = async () => {
    if (!user) return
    if (!parsedPhone.e164 || !isSupportedCountry(parsedPhone.country)) {
      toast.error(rtl ? 'أدخل رقمًا صحيحًا أولًا.' : 'Enter a valid phone number first.')
      return
    }
    if (verifiedPhone && profile?.phone_e164 === parsedPhone.e164) {
      setPhoneOpen(false)
      toast.success(rtl ? 'هذا الرقم موثّق بالفعل.' : 'This number is already verified.')
      return
    }
    try {
      await savePending(parsedPhone.e164)
      localStorage.setItem('yomy-phone-country', parsedPhone.country)
      setPhoneOpen(false)
      setPhoneMode('idle')
      toast.success(copy.savedUnverified)
    } catch (error) {
      toast.error(friendlyPhoneError(error, rtl))
    }
  }

  const sendEmailConfirmation = async () => {
    if (!activeEmail || emailBusy || emailCooldown > 0) return
    setEmailBusy(true)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: activeEmail,
        options: { emailRedirectTo: getPublicAppUrl('/verify-email?email=' + encodeURIComponent(activeEmail)) },
      })
      if (error) throw error
      setEmailCodeReady(true)
      setEmailCode('')
      setEmailCooldown(60)
      toast.success(copy.emailSent)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send confirmation email.')
    } finally {
      setEmailBusy(false)
    }
  }

  const verifyEmailCode = async () => {
    if (!activeEmail || !/^\d{4,10}$/.test(emailCode.trim())) return
    setEmailBusy(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ email: activeEmail, token: emailCode.trim(), type: 'signup' })
      if (error) throw error
      setEmailOpen(false)
      toast.success(copy.emailSuccess)
    } catch {
      toast.error(rtl
        ? 'تعذر تأكيد الرمز. إذا وصلتك رسالة برابط تأكيد، افتح الرابط الموجود فيها.'
        : 'The code could not be verified. If the email contains a confirmation link, open that link instead.')
    } finally {
      setEmailBusy(false)
    }
  }

  const verifiedPhoneValue = verifiedPhone ? String(profile?.phone_e164 || '') : ''
  const displayedPhone = verifiedPhoneValue || pendingPhone
  const pendingDiffers = Boolean(verifiedPhoneValue && pendingPhone && pendingPhone !== verifiedPhoneValue)

  return (
    <>
      <section className="yomy-ios-panel space-y-3 overflow-hidden border-white/10 p-4" aria-labelledby="contact-verification-title">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 id="contact-verification-title" className="font-semibold">{copy.title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.subtitle}</p>
          </div>
        </div>
        <button type="button" onClick={() => !verifiedEmail && setEmailOpen(true)} className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/35 p-3 text-left transition-colors hover:bg-muted/40">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/65"><Mail className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{copy.email}</span><span className="mt-0.5 block truncate text-sm font-medium">{activeEmail || '—'}</span></span>
          <VerificationStatus verified={verifiedEmail} label={verifiedEmail ? copy.verified : copy.unverified} />
        </button>
        <button type="button" onClick={openPhoneDialog} className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/35 p-3 text-left transition-colors hover:bg-muted/40">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/65"><Phone className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{copy.phone}</span><span className="mt-0.5 block truncate text-sm font-medium">{displayedPhone || copy.notAdded}</span></span>
          <VerificationStatus verified={verifiedPhone} label={verifiedPhone ? copy.verified : copy.unverified} />
        </button>
        {pendingDiffers && <button type="button" onClick={openPhoneDialog} className="flex w-full items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-left text-xs"><CircleAlert className="size-4 shrink-0 text-rose-500" /><span className="min-w-0 flex-1"><span className="font-semibold">{copy.pending}: </span><span className="break-all">{pendingPhone}</span></span></button>}
        {!verifiedEmail && <Button className="h-11 w-full rounded-2xl" variant="outline" onClick={() => setEmailOpen(true)}><Mail className="mr-2 size-4" />{copy.verifyEmail}</Button>}
        <Button className="h-11 w-full rounded-2xl" variant="outline" onClick={openPhoneDialog}><Phone className="mr-2 size-4" />{copy.managePhone}</Button>
      </section>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-3xl">
          <DialogHeader><DialogTitle>{copy.emailDialog}</DialogTitle><DialogDescription>{copy.emailHelp}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm break-all">{activeEmail}</div>
            {emailCodeReady && <div className="space-y-2">
              <Label htmlFor="email-verification-code">{copy.emailCode}</Label>
              <Input id="email-verification-code" value={emailCode} onChange={event => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" className="h-12 rounded-2xl" placeholder="123456" />
              <Button className="h-11 w-full rounded-2xl" onClick={() => void verifyEmailCode()} disabled={emailBusy || !/^\d{4,10}$/.test(emailCode.trim())}>{emailBusy ? '…' : copy.verifyCode}</Button>
            </div>}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button className="h-11 w-full rounded-2xl" onClick={() => void sendEmailConfirmation()} disabled={emailBusy || emailCooldown > 0}>{emailBusy ? '…' : copy.sendEmail}{emailCooldown > 0 ? ' (' + emailCooldown + 's)' : ''}</Button>
            <Button variant="ghost" className="h-10 w-full rounded-2xl" onClick={() => setEmailOpen(false)}>{copy.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={phoneOpen} onOpenChange={open => {
        setPhoneOpen(open)
        if (!open) {
          resetFirebasePhoneVerification()
          setPhoneMode('idle')
          setPhoneCode('')
        }
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-3xl">
          <DialogHeader><DialogTitle>{copy.phoneDialog}</DialogTitle><DialogDescription>{copy.phoneHelp}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[minmax(7.5rem,auto)_minmax(0,1fr)] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="phone-country">{copy.chooseCountry}</Label>
                <select id="phone-country" value={country} onChange={event => {
                  const next = event.target.value as CountryCode
                  setCountry(next)
                  localStorage.setItem('yomy-phone-country', next)
                  setPhoneDraft(normalizePhoneInput(phoneDraft, next).display)
                  setPhoneCode('')
                  setPhoneMode('idle')
                  resetFirebasePhoneVerification()
                }} className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25">
                  {COUNTRY_CODES.map(item => <option key={item.code} value={item.code}>{countryFlag(item.code)} {item.dial}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-phone-number">{copy.phoneNumber}</Label>
                <Input id="account-phone-number" value={phoneDraft} onChange={event => {
                  const parsed = normalizePhoneInput(event.target.value, country)
                  setPhoneDraft(parsed.display)
                  if (parsed.e164 && parsed.country !== country) {
                    setCountry(parsed.country)
                    localStorage.setItem('yomy-phone-country', parsed.country)
                  }
                  setPhoneCode('')
                  setPhoneMode('idle')
                  resetFirebasePhoneVerification()
                }} inputMode="tel" autoComplete="tel" className="h-12 rounded-2xl" placeholder={country === 'EG' ? '010 1234 5678' : '+1 212 555 0100'} />
              </div>
            </div>
            {(phoneMode === 'code' || phoneMode === 'verifying') && <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/25 p-3">
              <Label htmlFor="phone-verification-code">{copy.code}</Label>
              <Input id="phone-verification-code" value={phoneCode} onChange={event => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" className="h-12 rounded-2xl" placeholder="123456" />
              <Button className="h-11 w-full rounded-2xl" onClick={() => void verifyPhoneCode()} disabled={phoneMode === 'verifying' || !/^\d{4,10}$/.test(phoneCode.trim())}>{phoneMode === 'verifying' ? '…' : copy.verifyCode}</Button>
              <Button variant="ghost" className="h-9 w-full rounded-xl" onClick={() => void resendPhoneCode()} disabled={phoneCooldown > 0 || phoneMode === 'verifying'}>{copy.resend}{phoneCooldown > 0 ? ' (' + phoneCooldown + 's)' : ''}</Button>
            </div>}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button ref={sendButtonRef} className="h-11 w-full rounded-2xl" onClick={() => void sendPhoneCode()} disabled={!parsedPhone.e164 || phoneCooldown > 0 || phoneMode === 'sending' || phoneMode === 'verifying'}>{phoneMode === 'sending' ? '…' : copy.sendSms}{phoneCooldown > 0 ? ' (' + phoneCooldown + 's)' : ''}</Button>
            <Button variant="outline" className="h-11 w-full rounded-2xl" onClick={() => void saveWithoutVerification()} disabled={!parsedPhone.e164 || phoneMode === 'sending' || phoneMode === 'verifying'}>{copy.saveUnverified}</Button>
            <Button variant="ghost" className="h-10 w-full rounded-2xl" onClick={() => setPhoneOpen(false)}>{copy.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
