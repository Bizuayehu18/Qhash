import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftAddon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftAddon, className = '', type, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)
    const isPassword = type === 'password'

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-gray-300">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftAddon && (
            <div className="absolute left-3 flex items-center pointer-events-none text-gray-500 text-sm select-none">
              {leftAddon}
            </div>
          )}
          <input
            ref={ref}
            type={isPassword && showPassword ? 'text' : type}
            className={[
              'w-full bg-[#111] border rounded-lg text-sm text-gray-100 placeholder:text-gray-600',
              'h-10 px-3 transition-all duration-150',
              'focus:outline-none focus:border-[rgba(0,255,65,0.5)] focus:shadow-[0_0_0_3px_rgba(0,255,65,0.08)]',
              error
                ? 'border-red-500/60 focus:border-red-500/80'
                : 'border-[#2a2a2a] hover:border-[#3a3a3a]',
              leftAddon ? 'pl-14' : '',
              isPassword ? 'pr-10' : '',
              className,
            ].join(' ')}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-gray-600">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
