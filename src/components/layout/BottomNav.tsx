import { NavLink, useNavigate } from 'react-router-dom'
import { useYomyLanguage } from '@/lib/i18n'
import { Home, Search, PlusSquare, Heart, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

export default function BottomNav() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { copy } = useYomyLanguage()

  const navItems = [
    { to: '/', icon: Home, key: 'home' as const },
    { to: '/explore', icon: Search, key: 'explore' as const },
    { to: '/create', icon: PlusSquare, key: 'create' as const },
    { to: '/notifications', icon: Heart, key: 'activity' as const },
    { to: `/profile/${profile?.username || ''}`, icon: User, key: 'profile' as const },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 px-3 yomy-bottom-safe pointer-events-none">
      <div className="pointer-events-auto flex items-center justify-around max-w-lg mx-auto h-[3.75rem] px-2 rounded-[1.55rem] border border-border/45 yomy-glass-bar">
        {navItems.map(({ to, icon: Icon, key }) => {
          const label = copy(key)
          const isProfile = key === 'profile'
          return (
            <NavLink
              key={key}
              to={to}
              aria-label={label}
              onClick={key === 'create' ? (e) => { e.preventDefault(); navigate('/create') } : undefined}
              className={({ isActive }) => cn(
                'relative flex size-11 items-center justify-center rounded-xl transition-all duration-200 active:scale-95',
                isActive
                  ? 'bg-gradient-to-tr from-violet-600 via-pink-500 to-orange-400 text-white shadow-[0_4px_16px_rgba(236,72,153,0.22)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/55'
              )}
            >
              {({ isActive }) => (
                <>
                  {isProfile && profile?.avatar_url ? (
                    <div className={cn(
                      'size-7 rounded-full overflow-hidden ring-1 ring-border/70 ring-offset-1 ring-offset-background transition-transform duration-200',
                      isActive && 'scale-105 ring-white/80 ring-offset-0'
                    )}>
                      <img src={profile.avatar_url} alt={label} className="size-full object-cover" />
                    </div>
                  ) : (
                    <Icon className={cn('size-[1.42rem] stroke-[1.7]', isActive && 'stroke-[1.85]')} />
                  )}
                  <span className={cn(
                    'absolute -bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full transition-all duration-200',
                    isActive ? 'bg-white opacity-100' : 'bg-foreground opacity-0'
                  )} />
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
