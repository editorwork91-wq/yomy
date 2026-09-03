import { NavLink, useNavigate } from 'react-router-dom'
import { Home, Search, PlusSquare, Heart, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

export default function BottomNav() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const navItems = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/explore', icon: Search, label: 'Explore' },
    { to: '/create', icon: PlusSquare, label: 'Create' },
    { to: '/notifications', icon: Heart, label: 'Activity' },
    { to: `/profile/${profile?.username}`, icon: User, label: 'Profile' },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-[max(0.45rem,env(safe-area-inset-bottom))] pointer-events-none">
      <div className="pointer-events-auto flex items-center justify-around max-w-lg mx-auto h-[3.7rem] px-2 rounded-2xl border border-border/70 bg-background/88 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/72">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            onClick={label === 'Create' ? (e) => { e.preventDefault(); navigate('/create') } : undefined}
            className={({ isActive }) =>
              cn(
                'relative flex size-11 items-center justify-center rounded-xl transition-all duration-200',
                'active:scale-95',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/55'
              )
            }
          >
            {label === 'Profile' && profile?.avatar_url ? (
              <div className="size-7 rounded-full overflow-hidden ring-1 ring-border/70 ring-offset-1 ring-offset-background transition-transform duration-200 group-data-[active=true]:scale-105">
                <img src={profile.avatar_url} alt="" className="size-full object-cover" />
              </div>
            ) : (
              <Icon className="size-[1.42rem] stroke-[1.7]" />
            )}
            <span className="absolute bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-foreground opacity-0 transition-opacity duration-200" />
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
