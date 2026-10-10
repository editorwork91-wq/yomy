import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Check, CircleUserRound, Clapperboard, MessageCircle, Plus, Settings, UsersRound, ChevronLeft, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { getPostAuthRoute } from '@/lib/authRouting'
import { MAX_SAVED_ACCOUNTS } from '@/lib/accountSwitcher'
import BrandMark from '@/components/layout/BrandMark'
import { LANGUAGE_LABELS, type YomyLanguage } from '@/lib/i18n'
import { useAuth } from '@/contexts/AuthContext'

type TopBarProps = {
  title?: string
  showBack?: boolean
  showLogo?: boolean
  right?: React.ReactNode
}

export default function TopBar({ title, showBack, showLogo = false, right }: TopBarProps) {
  const navigate = useNavigate()
  const { profile, user, savedAccounts, switchAccount, beginAddAccount } = useAuth()
  const [language, setLanguage] = useState<YomyLanguage>((document.documentElement.lang as YomyLanguage) || 'en')

  useEffect(() => {
    const sync = () => {
      const next = (document.documentElement.lang || 'en') as YomyLanguage
      if (LANGUAGE_LABELS[next]) setLanguage(next)
    }
    window.addEventListener('yomy-language-changed', sync)
    return () => window.removeEventListener('yomy-language-changed', sync)
  }, [])

  const isArabic = language === 'ar'
  const copy = {
    back: { en:'Back', ar:'رجوع', de:'Zurück', fr:'Retour', es:'Atrás' }[language],
    fedo: { en:'Fedo', ar:'فيديو', de:'Fedo', fr:'Fedo', es:'Fedo' }[language],
    settings: { en:'Settings', ar:'الإعدادات', de:'Einstellungen', fr:'Réglages', es:'Ajustes' }[language],
    messages: { en:'Messages', ar:'الرسائل', de:'Nachrichten', fr:'Messages', es:'Mensajes' }[language],
    profile: { en:'Profile', ar:'الملف الشخصي', de:'Profil', fr:'Profil', es:'Perfil' }[language],
    accounts: { en:'Accounts', ar:'الحسابات', de:'Konten', fr:'Comptes', es:'Cuentas' }[language],
    addAccount: { en:'Add account', ar:'إضافة حساب', de:'Konto hinzufügen', fr:'Ajouter un compte', es:'Añadir cuenta' }[language],
    manageAccounts: { en:'Manage accounts', ar:'إدارة الحسابات', de:'Konten verwalten', fr:'Gérer les comptes', es:'Administrar cuentas' }[language],
    accountLimit: { en:'The 5-account limit has been reached.', ar:'وصلت إلى الحد الأقصى وهو 5 حسابات.', de:'Das Limit von 5 Konten wurde erreicht.', fr:'La limite de 5 comptes est atteinte.', es:'Se alcanzó el límite de 5 cuentas.' }[language],
  }
  const username = profile?.username || 'Yomy'
  const profileTarget = profile?.username ? '/profile/' + profile.username : '/'

  const handleAccountSwitch = async (userId: string) => {
    if (userId === user?.id) return
    try {
      await switchAccount(userId)
      navigate(await getPostAuthRoute(), { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch account. Please sign in again.')
    }
  }

  const handleAddAccount = async () => {
    if (savedAccounts.length >= MAX_SAVED_ACCOUNTS) { toast.error(copy.accountLimit); return }
    try {
      await beginAddAccount()
      navigate('/login?addAccount=1', { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? (error.message === 'ACCOUNT_LIMIT_REACHED' ? copy.accountLimit : error.message) : 'Could not add account.')
    }
  }

  if (showLogo) {
    return (
      <header className="yomy-topbar sticky top-0 z-40 border-b border-border/55 bg-background/72 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/65 shadow-[0_8px_30px_rgba(0,0,0,.045)]">
        <div className="grid h-[3.55rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-2.5 sm:px-3 max-w-lg mx-auto yomy-ios-press" dir="ltr">
          <div className="min-w-0 justify-self-start">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="group inline-flex max-w-full items-center gap-1.5 rounded-full px-1.5 py-1 text-left transition-transform duration-200 active:scale-[0.98]" aria-label={copy.profile} title={copy.profile} dir={isArabic ? 'rtl' : 'ltr'}>
                  <span className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted ring-1 ring-border/70">
                    {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="size-full object-cover" /> : <span className="text-xs font-semibold text-muted-foreground">{username[0]?.toUpperCase() || 'Y'}</span>}
                  </span>
                  <span className="hidden max-w-[5.5rem] truncate text-[13px] font-semibold sm:inline">{username}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isArabic ? 'end' : 'start'} className="w-72">
                <DropdownMenuLabel>{copy.accounts} ({savedAccounts.length}/{MAX_SAVED_ACCOUNTS})</DropdownMenuLabel>
                {savedAccounts.map(account => {
                  const accountName = account.fullName || account.username || account.email || 'YOMY'
                  return <DropdownMenuItem key={account.userId} onSelect={() => void handleAccountSwitch(account.userId)} className="gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold ring-1 ring-border/70">{account.avatarUrl ? <img src={account.avatarUrl} alt="" className="size-full object-cover" /> : accountName[0]?.toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{accountName}</span><span className="block truncate text-[11px] text-muted-foreground">{account.email || '@' + account.username}</span></span>
                    {account.userId === user?.id && <Check className="size-4 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void handleAddAccount()} disabled={savedAccounts.length >= MAX_SAVED_ACCOUNTS}><Plus className="mr-2 size-4" />{copy.addAccount}</DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/accounts"><UsersRound className="mr-2 size-4" />{copy.manageAccounts}</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to={profileTarget}><CircleUserRound className="mr-2 size-4" />{copy.profile}</Link></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Link
            to="/"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-1 transition-transform duration-200 active:scale-[0.98]"
            aria-label="Yomy"
          >
            <BrandMark size={23} className="object-contain" />
            <span className="text-[1.3rem] leading-none font-semibold tracking-[-0.055em] bg-gradient-to-r from-violet-500 via-pink-500 to-orange-400 bg-clip-text text-transparent">
              {language === 'ar' ? 'يومي' : 'Yomy'}
            </span>
          </Link>

          <div className="flex min-w-0 items-center justify-end gap-0">
            {right || (
              <>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/fedo" aria-label={copy.fedo} title={copy.fedo}><Clapperboard className="size-[1.15rem] stroke-[1.65]" /></Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/settings" aria-label={copy.settings} title={copy.settings}><Settings className="size-[1.15rem] stroke-[1.65]" /></Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/messages" aria-label={copy.messages} title={copy.messages}><MessageCircle className="size-[1.15rem] stroke-[1.65]" /></Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="yomy-topbar sticky top-0 z-40 border-b border-border/55 bg-background/72 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/65 shadow-[0_8px_30px_rgba(0,0,0,.045)]">
      <div className="flex h-[3.35rem] items-center justify-between px-3 sm:px-4 max-w-lg mx-auto yomy-ios-press">
        <div className="flex min-w-0 items-center gap-2">
          {showBack && (
            <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" onClick={() => navigate(-1)} aria-label={copy.back}>
              <ChevronLeft className={isArabic ? 'size-5 rotate-180' : 'size-5'} />
            </Button>
          )}
          {title && <h1 className="truncate text-lg font-semibold">{title}</h1>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">{right}</div>
      </div>
    </header>
  )
}
