interface CardProps {
  children: React.ReactNode
  className?: string
  neon?: boolean
  padding?: 'sm' | 'md' | 'lg' | 'none'
}

const paddings = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export function Card({ children, className = '', neon, padding = 'md' }: CardProps) {
  return (
    <div
      className={[
        'bg-[#111] rounded-xl border',
        neon
          ? 'border-[rgba(0,255,65,0.25)] shadow-[0_0_20px_rgba(0,255,65,0.06)]'
          : 'border-[#1f1f1f]',
        paddings[padding],
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-4 ${className}`}>{children}</div>
}

export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`text-sm font-semibold text-gray-100 ${className}`}>{children}</h3>
}

export function CardDescription({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-500 mt-1">{children}</p>
}
