import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Clapperboard, MessageCircle, Settings, ChevronLeft, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const { profile } = useAuth()
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
  }
  const username = profile?.username || 'Yomy'
  const profileTarget = profile?.username ? '/profile/' + profile.username : '/'

  if (showLogo) {
    return (
      <header className="yomy-topbar sticky top-0 z-40 border-b border-border/55 bg-background/72 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/65 shadow-[0_8px_30px_rgba(0,0,0,.045)]">
        <div className="grid h-[3.55rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-2.5 sm:px-3 max-w-lg mx-auto yomy-ios-press" dir="ltr">
          <div className="min-w-0 justify-self-start">
            <Link
              to={profileTarget}
              className="group inline-flex max-w-full items-center gap-1.5 rounded-full px-1.5 py-1 transition-transform duration-200 active:scale-[0.98]"
              aria-label={copy.profile}
              title={copy.profile}
              dir={isArabic ? 'rtl' : 'ltr'}
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted ring-1 ring-border/70">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">{username[0]?.toUpperCase() || 'Y'}</span>
                )}
              </span>
              <span className="hidden max-w-[5.5rem] truncate text-[13px] font-semibold sm:inline">{username}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Link>
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
