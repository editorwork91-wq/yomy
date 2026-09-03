import { Link, useNavigate } from 'react-router-dom'
import { MessageCircle, Settings } from 'lucide-react'
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

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2.5 min-w-0">
          {showBack && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-full hover:bg-muted/70"
              onClick={() => navigate(-1)}
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
          )}
          {showLogo && (
            <Link to="/" className="group inline-flex items-center gap-2.5 rounded-xl px-1.5 py-1 transition-transform duration-200 active:scale-[0.98]">
              <span className="relative inline-flex size-8 items-center justify-center overflow-hidden rounded-[10px] bg-black ring-1 ring-white/10 shadow-[0_0_20px_rgba(168,85,247,0.22)]">
                <BrandMark size={28} className="scale-[1.16]" />
              </span>
              <span className="text-[1.55rem] leading-none font-semibold tracking-[-0.055em] bg-gradient-to-r from-violet-500 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                Yomy
              </span>
            </Link>
          )}
          {title && !showLogo && (
            <h1 className="text-lg font-semibold truncate">{title}</h1>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {right || (
            showLogo && (
              <>
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
      </div>
    </header>
  )
}
