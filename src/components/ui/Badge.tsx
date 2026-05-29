type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neon'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-white/5 text-gray-400 border-white/10',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  danger: 'bg-red-500/10 text-red-400 border-red-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  neon: 'bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.25)]',
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
        variants[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}
