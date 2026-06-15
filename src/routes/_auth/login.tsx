import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { supabase, normaliseEthiopianPhone, phoneToEmail } from '@/lib/supabase.js'
import { useAuthStore } from '@/store/authStore.js'
import { Button } from '@/components/ui/Button.js'
import { Input } from '@/components/ui/Input.js'
import { Card } from '@/components/ui/Card.js'
import { Hash } from 'lucide-react'
import { getSafeErrorMessage } from '@/lib/errors.js'
import { isTimeoutError, withTimeout } from '@/lib/async.js'

export const Route = createFileRoute('/_auth/login')({
  component: LoginPage,
})

const LOGIN_TIMEOUT_MS = 15_000
const PROFILE_LOAD_TIMEOUT_MS = 8_000

function LoginPage() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setSession, loadProfile } = useAuthStore()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone || !password || loading) return

    setLoading(true)
    try {
      const normalised = normaliseEthiopianPhone(phone)
      const email = phoneToEmail(normalised)

      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        LOGIN_TIMEOUT_MS,
        'Login request timed out.',
      )
      if (error) throw error

      setSession(data.session)
      if (data.session?.user) {
        try {
          await withTimeout(
            loadProfile(data.session.user.id),
            PROFILE_LOAD_TIMEOUT_MS,
            'Profile loading timed out.',
          )
        } catch {
          // Profile will be loaded by auth state listener as fallback
        }
      }

      toast.success('Welcome back!')
      navigate({ to: '/dashboard' })
    } catch (err: unknown) {
      if (isTimeoutError(err)) {
        toast.error('Login is taking too long. Please check your connection and try again.')
        return
      }

      const message = err instanceof Error ? err.message : 'Login failed'
      toast.error(
        message === 'Invalid login credentials'
          ? 'Incorrect phone number or password.'
          : getSafeErrorMessage(err, 'AUTH').message
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card neon className="mt-4">
      <div className="flex items-center gap-2 mb-6">
        <Hash size={18} className="text-[#00ff41]" />
        <h1 className="text-lg font-bold">Sign in to QHash</h1>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <Input
          label="Phone Number"
          type="tel"
          placeholder="9XXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          leftAddon="+251"
          autoComplete="tel"
          required
        />
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <Button type="submit" fullWidth loading={loading}>
          Sign In
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600">
        No account?{' '}
        <Link to="/register" className="text-[#00ff41] hover:underline">
          Create one
        </Link>
      </p>
    </Card>
  )
}
