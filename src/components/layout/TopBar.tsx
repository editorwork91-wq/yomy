import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Clapperboard, MessageCircle, Settings, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BrandMark from '@/components/layout/BrandMark'
import { LANGUAGE_LABELS, type YomyLanguage } from '@/lib/i18n'

type TopBarProps = {
  title?: string
  showBack?: boolean
  showLogo?: boolean
  right?: React.ReactNode
}

export default function TopBar({ title, showBack, showLogo = false, right }: TopBarProps) {
  const navigate = useNavigate()
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
  }

  return (
    <header
      className="sticky top-0 z-40 border-b border-border/55 bg-background/72 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/65 shadow-[0_8px_30px_rgba(0,0,0,.045)]"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex items-center justify-between h-[3.35rem] px-3 sm:px-4 max-w-lg mx-auto yomy-ios-press">
        <div className="flex items-center gap-2.5 min-w-0">
          {showBack && (
            <Button variant="ghost" size="icon" className="size-8.5 rounded-full hover:bg-muted/70" onClick={() => navigate(-1)} aria-label={copy.back}>
              <ChevronLeft className={isArabic ? 'size-5 rotate-180' : 'size-5'} />
            </Button>
          )}
          {showLogo && (
            <Link to="/" className="group inline-flex items-center gap-2 rounded-xl px-1 py-1 transition-transform duration-200 active:scale-[0.98]" aria-label="Yomy">
              <span className="relative inline-flex size-7 items-center justify-center overflow-hidden rounded-[9px] bg-black ring-1 ring-white/10 shadow-[0_0_20px_rgba(168,85,247,0.22)]">
                <BrandMark size={24} className="scale-[1.08]" />
              </span>
              <span className="text-[1.35rem] leading-none font-semibold tracking-[-0.055em] bg-gradient-to-r from-violet-500 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                {language === 'ar' ? 'يومي' : 'Yomy'}
              </span>
            </Link>
          )}
          {title && !showLogo && <h1 className="text-lg font-semibold truncate">{title}</h1>}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {right || (
            showLogo && (
              <>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/fedo" aria-label={copy.fedo} title={copy.fedo}><Clapperboard className="size-[1.15rem] stroke-[1.65]" /></Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/settings" aria-label={copy.settings} title={copy.settings}><Settings className="size-5 stroke-[1.7]" /></Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/messages" aria-label={copy.messages} title={copy.messages}><MessageCircle className="size-5 stroke-[1.7]" /></Link>
                </Button>
              </>
            )
          )}
        </div>
      </div>
    </header>
  )
}
