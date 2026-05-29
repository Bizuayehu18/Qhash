import { createFileRoute, Link } from '@tanstack/react-router'
import { Hash, Zap, TrendingUp, Shield, Users, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button.js'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-gray-100 overflow-x-hidden flex flex-col">
      {/* Background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,65,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,65,0.025) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-5 h-14 bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Hash size={20} className="text-[#00ff41]" />
          <span className="text-base font-bold tracking-tight">
            <span className="text-[#00ff41]">Q</span>Hash
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" size="sm">Login</Button>
          </Link>
          <Link to="/register">
            <Button size="sm">Start</Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 bg-[rgba(0,255,65,0.06)] border border-[rgba(0,255,65,0.2)] rounded-full px-3 py-1 text-[10px] text-[#00ff41] mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00ff41] animate-pulse" />
          Ethiopia's Cloud Mining Platform
        </div>

        <h1 className="text-4xl font-black tracking-tight mb-4 leading-tight max-w-xs">
          Mine the{' '}
          <span className="text-[#00ff41]" style={{ textShadow: '0 0 30px rgba(0,255,65,0.4)' }}>
            Future
          </span>
        </h1>

        <p className="text-sm text-gray-400 max-w-xs mx-auto mb-8 leading-relaxed">
          Industrial-grade cloud mining. Daily earnings. Zero hardware costs.
        </p>

        <Link to="/register" className="w-full max-w-xs">
          <Button size="lg" fullWidth className="gap-2">
            Start Mining Now <ArrowRight size={16} />
          </Button>
        </Link>

        {/* Stats */}
        <div className="mt-10 grid grid-cols-2 gap-4 w-full max-w-xs">
          {[
            { label: 'Active Miners', value: '12,400+' },
            { label: 'Total Paid', value: '4.2M+ ETB' },
            { label: 'Uptime', value: '99.97%' },
            { label: 'Countries', value: '1 — ET' },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#111] rounded-xl border border-[#1a1a1a] p-3 text-center">
              <p className="text-base font-bold text-[#00ff41]">{stat.value}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 px-5 pb-12">
        <h2 className="text-lg font-bold text-center mb-5">
          Why <span className="text-[#00ff41]">QHash</span>?
        </h2>

        <div className="space-y-3 max-w-md mx-auto">
          {[
            { icon: <Zap size={16} />, title: 'Instant Activation', desc: 'Plans activate within seconds of deposit.' },
            { icon: <TrendingUp size={16} />, title: 'Daily Earnings', desc: 'Watch your balance grow every day.' },
            { icon: <Shield size={16} />, title: 'Bank-Grade Security', desc: 'Your funds and data are always protected.' },
            { icon: <Users size={16} />, title: 'Team Rewards', desc: 'Invite friends and earn together.' },
          ].map((f) => (
            <div
              key={f.title}
              className="flex items-start gap-3 bg-[#111] rounded-xl border border-[#1a1a1a] p-4"
            >
              <div className="h-8 w-8 rounded-lg bg-[rgba(0,255,65,0.08)] flex items-center justify-center text-[#00ff41] shrink-0">
                {f.icon}
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-0.5">{f.title}</h3>
                <p className="text-xs text-gray-500">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[#1a1a1a] py-6 px-6 text-center text-[10px] text-gray-700">
        <div className="flex items-center justify-center gap-1.5 mb-1">
          <Hash size={12} className="text-[#00ff41]/50" />
          <span>QHash &copy; {new Date().getFullYear()}</span>
        </div>
        <p>Cloud Mining — Addis Ababa, Ethiopia</p>
      </footer>
    </div>
  )
}
