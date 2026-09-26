import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Clapperboard, MessageCircle, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BrandMark from '@/components/layout/BrandMark'

type TopBarProps = {
  title?: string
  showBack?: boolean
  showLogo?: boolean
  right?: React.ReactNode
}

export default function TopBar({ title, showBack, showLogo = false, right }: TopBarProps) {
  const navigate = useNavigate()
  const [language, setLanguage] = useState(document.documentElement.lang || 'en')
  useEffect(() => {
    const sync = () => setLanguage(document.documentElement.lang || 'en')
    window.addEventListener('yomy-language-changed', sync)
    return () => window.removeEventListener('yomy-language-changed', sync)
  }, [])

  return (
    <header className="yomy-topbar sticky top-0 z-40 border-b border-border/45">
      <div className="relative flex items-center h-14 px-2.5 max-w-lg mx-auto">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {showBack && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-full hover:bg-muted/70"
              onClick={() => navigate(-1)}
              aria-label="Back"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
          )}
          {title && !showLogo && (
            <h1 className="text-lg font-semibold truncate">{title}</h1>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-1 justify-end">
          {right || (
            showLogo && (
              <>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/fedo" aria-label="Fedo" title="Fedo">
                    <Clapperboard className="size-5 stroke-[1.7]" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/settings" aria-label="Settings">
                    <Settings className="size-5 stroke-[1.7]" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-muted/70" asChild>
                  <Link to="/messages" aria-label="Messages">
                    <MessageCircle className="size-5 stroke-[1.7]" />
                  </Link>
                </Button>
              </>
            )
          )}
        </div>
        {showLogo && (
          <Link to="/" className="yomy-topbar-brand group absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" aria-label="YOMY home">
            <span className="yomy-topbar-logo">
              <BrandMark size={29} className="scale-[1.12]" />
            </span>
            <span className="yomy-topbar-wordmark">{language === 'ar' ? 'يومي' : 'YOMY'}</span>
          </Link>
        )}
      </div>
    </header>
  )
}
