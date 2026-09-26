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
  const { user, profile } = useAuth()
  const [language, setLanguage] = useState(document.documentElement.lang || 'en')
  useEffect(() => {
    const sync = () => setLanguage(document.documentElement.lang || 'en')
    window.addEventListener('yomy-language-changed', sync)
    return () => window.removeEventListener('yomy-language-changed', sync)
  }, [])

  const [accountTick, setAccountTick] = useState(0)
  const accounts = (() => {
    try {
      return JSON.parse(localStorage.getItem('yomy-account-list') || '[]') as Array<{ id: string; username: string; avatar_url?: string }>
    } catch { return [] }
  })()

  useEffect(() => {
    const sync = () => setAccountTick(value => value + 1)
    window.addEventListener('storage', sync)
    window.addEventListener('yomy-account-list-changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('yomy-account-list-changed', sync)
    }
  }, [])

  void accountTick

  return (
    <header className="yomy-topbar sticky top-0 z-40 border-b border-border/45">
      <div className="relative flex items-center h-14 px-2.5 max-w-lg mx-auto">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {showLogo && profile && user && (
            <>
              <Link to={`/profile/${profile.username}`} className="grid size-9 place-items-center rounded-full ring-2 ring-white/10 shadow-md active:scale-95 transition-transform" aria-label="Open profile">
                <Avatar className="size-8">
                  <AvatarImage src={profile.avatar_url} />
                  <AvatarFallback>{profile.username?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 gap-1 px-2 rounded-full max-w-36">
                    <Sparkles className="size-3.5 text-primary" />
                    <span className="max-w-20 truncate text-xs font-semibold">{profile.username}</span>
                    <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60 rounded-2xl p-1.5">
                  <div className="px-3 py-2 text-[10px] uppercase tracking-[.14em] text-muted-foreground">YOMY accounts</div>
                  {accounts.filter(item => item.id !== user.id).map(item => (
                    <DropdownMenuItem key={item.id} className="rounded-xl py-2.5" onClick={() => { setActiveAccountId(item.id); window.location.reload() }}>
                      <Avatar className="size-7 mr-2"><AvatarImage src={item.avatar_url} /><AvatarFallback>{item.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar>
                      <span className="truncate">@{item.username}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="rounded-xl py-2.5 font-semibold" onClick={() => { setActiveAccountId(null); window.location.assign('/login?add=1') }}>
                    <span className="mr-2 grid size-7 place-items-center rounded-full bg-primary/10 text-primary">+</span>
                    Add another account
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
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
