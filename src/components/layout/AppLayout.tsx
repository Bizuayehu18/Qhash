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

interface RouteSectionLabel {
  to: string
  label: string
}

const BOTTOM_TABS: BottomTab[] = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/plans', label: 'Plans', icon: Layers },
  { to: '/deposit', label: 'Deposit', icon: ArrowDownCircle },
  { to: '/referrals', label: 'Team', icon: Users },
  { to: '/profile', label: 'Profile', icon: User },
]

const ROUTE_SECTION_LABELS: RouteSectionLabel[] = [
  { to: '/withdraw', label: 'Withdraw' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/security', label: 'Security' },
  { to: '/support', label: 'Support' },
  { to: '/admin-earnings', label: 'Admin Earnings' },
  { to: '/admin', label: 'Admin' },
]

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

function getSectionLabel(pathname: string) {
  const tabLabel = BOTTOM_TABS.find((tab) => {
    if (tab.to === '/dashboard') return pathname === '/dashboard' || pathname === '/'
    return matchesRoute(pathname, tab.to)
  })?.label

  if (tabLabel) return tabLabel

  return ROUTE_SECTION_LABELS.find((route) => matchesRoute(pathname, route.to))?.label ?? 'QHash'
}

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

  const currentSection = getSectionLabel(location.pathname)

  const showAdminEarningsLink =
    profile?.is_admin &&
    (location.pathname === '/admin' || location.pathname.startsWith('/admin-earnings'))

  return (
    <div className="app-shell bg-[#0a0a0a]">
      {/* Desktop Side Navigation */}
      <aside className="hidden lg:flex desktop-side-rail w-[76px] xl:w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0a]">
        <div className="h-16 flex items-center gap-2 px-4 border-b border-white/[0.04]">
          <Hash size={22} className="text-[#00ff41] shrink-0" />
          <span className="hidden xl:inline text-base font-bold tracking-tight">
            <span className="text-[#00ff41]">Q</span>Hash
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {BOTTOM_TABS.map((tab) => {
            const active = isActive(tab.to)
            const Icon = tab.icon
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`flex items-center justify-center xl:justify-start gap-3 rounded-xl px-3 py-3 transition-colors card-press ${
                  active
                    ? 'bg-[rgba(0,255,65,0.08)] text-[#00ff41] border border-[rgba(0,255,65,0.14)]'
                    : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                <Icon size={20} className={active ? 'text-[#00ff41]' : 'text-gray-600'} />
                <span className={`hidden xl:inline text-xs font-semibold ${active ? 'text-[#00ff41]' : 'text-gray-400'}`}>
                  {tab.label}
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="px-3 pb-4">
          <button
            onClick={() => navigate({ to: '/profile' })}
            className="w-full flex items-center justify-center xl:justify-start gap-3 rounded-xl border border-white/[0.05] bg-[#111] px-3 py-3 card-press"
          >
            <span className="h-8 w-8 rounded-full bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] flex items-center justify-center text-xs font-bold text-[#00ff41] shrink-0">
              {profile?.username?.[0]?.toUpperCase() ?? 'U'}
            </span>
            <span className="hidden xl:block text-left min-w-0">
              <span className="block text-[11px] font-semibold text-gray-300 truncate">@{profile?.username ?? 'User'}</span>
              <span className="block text-[10px] text-gray-600">Account</span>
            </span>
          </button>
        </div>
      </aside>

      <div className="app-main-frame">
        {/* App Header */}
        <header className="shrink-0 flex items-center justify-between px-4 lg:px-6 h-14 lg:h-16 bg-[#0a0a0a] border-b border-white/[0.04]">
          <div className="flex items-center gap-2 lg:hidden">
            <Hash size={20} className="text-[#00ff41]" />
            <span className="text-base font-bold tracking-tight">
              <span className="text-[#00ff41]">Q</span>Hash
            </span>
          </div>

          <div className="hidden lg:block">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#00ff41]/60">QHash Console</p>
            <h1 className="text-sm font-bold text-gray-200">{currentSection}</h1>
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
          <div className="page-enter px-4 pt-4 pb-24 lg:px-6 lg:pt-6 lg:pb-8">
            {children}
          </div>
        </main>
      </div>

      {/* Bottom Navigation */}
      <nav className="bottom-nav lg:hidden">
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
