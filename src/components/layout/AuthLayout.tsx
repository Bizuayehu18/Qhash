import { Link } from '@tanstack/react-router'
import { Hash } from 'lucide-react'

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex flex-col max-w-[480px] mx-auto">
      {/* Grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Logo */}
      <div className="relative z-10 flex justify-center pt-12 pb-6">
        <Link to="/" className="flex items-center gap-2 group">
          <Hash size={22} className="text-[#00ff41]" />
          <span className="text-lg font-bold tracking-tight">
            <span className="text-[#00ff41]">Q</span>Hash
          </span>
        </Link>
      </div>

      {/* Form */}
      <div className="relative z-10 flex-1 flex items-start justify-center px-5 pb-12">
        <div className="w-full">
          {children}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 text-center pb-6 text-[10px] text-gray-700">
        &copy; {new Date().getFullYear()} QHash. All rights reserved.
      </div>
    </div>
  )
}
