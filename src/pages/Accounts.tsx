import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, LogIn, Plus, Trash2, UsersRound } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useYomyLanguage } from '@/lib/i18n'
import { MAX_SAVED_ACCOUNTS } from '@/lib/accountSwitcher'
import { getPostAuthRoute } from '@/lib/authRouting'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function Accounts() {
  const navigate = useNavigate()
  const { user, savedAccounts, switchAccount, beginAddAccount, forgetAccount } = useAuth()
  const { language } = useYomyLanguage()
  const rtl = language === 'ar'
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const copy = {
    en: { title: 'Accounts', subtitle: 'Switch between accounts saved on this device.', current: 'Current account', switch: 'Switch', add: 'Add account', limit: 'You can save up to 5 accounts on this device.', remove: 'Remove from this device', saved: 'Saved accounts', deviceOnly: 'Account sessions stay on this device. Passwords are never saved here.' },
    ar: { title: 'الحسابات', subtitle: 'بدّل بين الحسابات المحفوظة على هذا الجهاز.', current: 'الحساب الحالي', switch: 'تبديل', add: 'إضافة حساب', limit: 'يمكنك حفظ 5 حسابات كحد أقصى على هذا الجهاز.', remove: 'إزالة من هذا الجهاز', saved: 'الحسابات المحفوظة', deviceOnly: 'تظل جلسات الحسابات على هذا الجهاز، ولا نحفظ كلمات المرور.' },
    de: { title: 'Konten', subtitle: 'Wechsle zwischen den auf diesem Gerät gespeicherten Konten.', current: 'Aktuelles Konto', switch: 'Wechseln', add: 'Konto hinzufügen', limit: 'Auf diesem Gerät können bis zu 5 Konten gespeichert werden.', remove: 'Von diesem Gerät entfernen', saved: 'Gespeicherte Konten', deviceOnly: 'Sitzungen bleiben auf diesem Gerät. Passwörter werden nicht gespeichert.' },
    fr: { title: 'Comptes', subtitle: 'Passez entre les comptes enregistrés sur cet appareil.', current: 'Compte actuel', switch: 'Changer', add: 'Ajouter un compte', limit: 'Vous pouvez enregistrer jusqu’à 5 comptes sur cet appareil.', remove: 'Retirer de cet appareil', saved: 'Comptes enregistrés', deviceOnly: 'Les sessions restent sur cet appareil. Les mots de passe ne sont jamais enregistrés.' },
    es: { title: 'Cuentas', subtitle: 'Cambia entre las cuentas guardadas en este dispositivo.', current: 'Cuenta actual', switch: 'Cambiar', add: 'Añadir cuenta', limit: 'Puedes guardar hasta 5 cuentas en este dispositivo.', remove: 'Quitar de este dispositivo', saved: 'Cuentas guardadas', deviceOnly: 'Las sesiones permanecen en este dispositivo. No guardamos contraseñas.' },
  } as const
  const t = copy[language]

  const handleSwitch = async (userId: string) => {
    if (userId === user?.id) return
    setBusyId(userId)
    try {
      await switchAccount(userId)
      toast.success(rtl ? 'تم تبديل الحساب.' : 'Account switched.')
      navigate(await getPostAuthRoute(), { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch account. Sign in again to refresh this saved account.')
    } finally {
      setBusyId(null)
    }
  }

  const handleAdd = async () => {
    if (adding) return
    setAdding(true)
    try {
      await beginAddAccount()
      navigate('/login?addAccount=1', { replace: true })
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'ACCOUNT_LIMIT_REACHED'
        ? (rtl ? 'وصلت إلى الحد الأقصى وهو 5 حسابات.' : 'You have reached the 5-account limit.')
        : (error instanceof Error ? error.message : 'Could not add account.'))
    } finally {
      setAdding(false)
    }
  }

  const handleForget = (userId: string) => {
    try {
      forgetAccount(userId)
      toast.success(rtl ? 'تمت إزالة الحساب من هذا الجهاز.' : 'Account removed from this device.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove account.')
    }
  }

  return <div className="yomy-glass-page min-h-dvh pb-20">
    <TopBar title={t.title} showBack />
    <main className="mx-auto w-full max-w-lg space-y-4 px-4 py-5">
      <section className="yomy-ios-panel overflow-hidden border-white/10">
        <div className="flex items-center gap-3 border-b border-border/60 p-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><UsersRound className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{t.saved} <span className="text-xs font-normal text-muted-foreground">({savedAccounts.length}/{MAX_SAVED_ACCOUNTS})</span></h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>
        <div className="space-y-1 p-2">
          {savedAccounts.length === 0 ? <p className="px-3 py-5 text-center text-sm text-muted-foreground">{rtl ? 'لا توجد حسابات محفوظة بعد.' : 'No saved accounts yet.'}</p> : savedAccounts.map(account => {
            const active = account.userId === user?.id
            const title = account.fullName || account.username || account.email || 'YOMY'
            return <div key={account.userId} className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-muted/35">
              <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted ring-1 ring-border/70">
                {account.avatarUrl ? <img src={account.avatarUrl} alt="" className="size-full object-cover" /> : <span className="font-semibold">{title[0]?.toUpperCase() || 'Y'}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{title}</p>
                <p className="truncate text-xs text-muted-foreground">{account.email || '@' + account.username}</p>
                {active && <p className="mt-0.5 text-[11px] font-medium text-primary">{t.current}</p>}
              </div>
              {active ? <span className="inline-flex items-center gap-1 text-xs text-primary"><Check className="size-4" />{t.current}</span> : <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="outline" className="rounded-xl" disabled={busyId !== null} onClick={() => void handleSwitch(account.userId)}><LogIn className="mr-1 size-3.5" />{busyId === account.userId ? (rtl ? 'جارٍ التبديل…' : 'Switching…') : t.switch}</Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-xl text-muted-foreground" title={t.remove} aria-label={t.remove} onClick={() => handleForget(account.userId)}><Trash2 className="size-4" /></Button>
              </div>}
            </div>
          })}
        </div>
      </section>
      <section className="yomy-ios-panel space-y-3 p-4">
        <Button className="h-12 w-full rounded-2xl" onClick={() => void handleAdd()} disabled={adding || savedAccounts.length >= MAX_SAVED_ACCOUNTS}>
          <Plus className="mr-2 size-4" />{adding ? (rtl ? 'جارٍ فتح الحساب…' : 'Opening account…') : t.add}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">{t.limit}</p>
        <p className="text-[11px] leading-5 text-muted-foreground">{t.deviceOnly}</p>
      </section>
    </main>
    <BottomNav />
  </div>
}
