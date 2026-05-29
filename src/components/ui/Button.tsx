import { forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}

const variants: Record<Variant, string> = {
  primary:
    'bg-[#00ff41] text-black font-semibold hover:bg-[#00cc33] active:bg-[#009922] shadow-[0_0_16px_rgba(0,255,65,0.3)] hover:shadow-[0_0_24px_rgba(0,255,65,0.45)]',
  secondary:
    'bg-[#111] border border-[rgba(0,255,65,0.3)] text-[#00ff41] hover:bg-[rgba(0,255,65,0.08)] hover:border-[rgba(0,255,65,0.5)]',
  ghost:
    'text-gray-400 hover:text-gray-100 hover:bg-white/5',
  danger:
    'bg-red-600/90 text-white hover:bg-red-600',
  outline:
    'border border-[#2a2a2a] text-gray-300 hover:border-[rgba(0,255,65,0.3)] hover:text-gray-100',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-md',
  md: 'h-10 px-5 text-sm rounded-lg',
  lg: 'h-12 px-7 text-base rounded-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', loading, fullWidth, className = '', children, disabled, ...props },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          'inline-flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff41]/50',
          variants[variant],
          sizes[size],
          fullWidth ? 'w-full' : '',
          className,
        ].join(' ')}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
