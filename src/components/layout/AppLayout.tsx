import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useAuthStore } from '@/store/authStore.js'
import {
  Home, Layers, ArrowDownCircle, Users, User,
  Hash, Bell, Wallet, Power,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase.js'
import { getUnreadCountFn } from '@/lib/server/notifications.js'

interface BottomTab {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const BOTTOM_TABS: BottomTab[] = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/plans', label: 'Plans', icon: Layers },
  { to: '/deposit', label: 'Deposit', icon: ArrowDownCircle },
  { to: '/referrals', label: 'Team', icon: Users },
  { to: '/profile', label: 'Profile', icon: User },
]

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, user } = useAuthStore()
  const location = useRouterState({ select: (s) => s.location })
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!user?.id) return
    const fetchCount = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) {
        setUnreadCount(0)
        return
      }
      getUnreadCountFn({ data: { accessToken } })
        .then(({ count }) => setUnreadCount(count))
        .catch(() => {})
    }
    fetchCount()
    const interval = setInterval(fetchCount, 60_000)
    return () => clearInterval(interval)
  }, [user?.id])

  const isActive = (to: string) => {
    if (to === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/'
    return location.pathname.startsWith(to)
  }

  const showAdminEarningsLink =
    profile?.is_admin &&
    (location.pathname === '/admin' || location.pathname.startsWith('/admin-earnings'))

  return (
    <div className="app-shell bg-[#0a0a0a]">
      {/* App Header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-14 bg-[#0a0a0a] border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Hash size={20} className="text-[#00ff41]" />
          <span className="text-base font-bold tracking-tight">
            <span className="text-[#00ff41]">Q</span>Hash
          </span>
        </div>

        <div className="flex items-center gap-3">
          {showAdminEarningsLink && (
            <Link
              to="/admin-earnings"
              className="flex items-center gap-1.5 bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.15)] rounded-full px-3 py-1.5 card-press"
            >
              <Power size={13} className="text-[#00ff41]" />
              <span className="text-[11px] font-semibold text-[#00ff41]">Earnings</span>
            </Link>
          )}

          <Link
            to="/deposit"
            className="flex items-center gap-1.5 bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.15)] rounded-full px-3 py-1.5 card-press"
          >
            <Wallet size={13} className="text-[#00ff41]" />
            <span className="text-[11px] font-semibold text-[#00ff41]">Deposit</span>
          </Link>

          <button
            onClick={() => navigate({ to: '/notifications' })}
            className="relative p-2 rounded-full hover:bg-white/[0.04] transition-colors card-press"
          >
            <Bell size={18} className="text-gray-400" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 h-4 min-w-4 flex items-center justify-center bg-[#00ff41] text-black text-[9px] font-bold rounded-full px-1 leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => navigate({ to: '/profile' })}
            className="h-8 w-8 rounded-full bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] flex items-center justify-center text-xs font-bold text-[#00ff41] card-press"
          >
            {profile?.username?.[0]?.toUpperCase() ?? 'U'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-content hide-scrollbar">
        <div className="page-enter px-4 pt-4 pb-24">
          {children}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <div className="flex items-center justify-around px-2">
          {BOTTOM_TABS.map((tab) => {
            const active = isActive(tab.to)
            const Icon = tab.icon
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`bottom-nav-item flex-1 ${active ? 'active' : ''}`}
              >
                <Icon
                  size={active ? 22 : 20}
                  className={active ? 'text-[#00ff41]' : 'text-gray-600'}
                />
                <span className={`text-[10px] font-medium ${active ? 'text-[#00ff41]' : 'text-gray-600'}`}>
                  {tab.label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
