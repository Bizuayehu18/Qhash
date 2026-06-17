import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { supabase, normaliseEthiopianPhone } from '@/lib/supabase.js'
import { useAuthStore } from '@/store/authStore.js'
import { registerUserFn } from '@/lib/server/auth.js'
import { Button } from '@/components/ui/Button.js'
import { Input } from '@/components/ui/Input.js'
import { Card } from '@/components/ui/Card.js'
import { Hash, UserCheck } from 'lucide-react'
import { getSafeErrorMessage } from '@/lib/errors.js'
import { isTimeoutError, withTimeout } from '@/lib/async.js'

export const Route = createFileRoute('/_auth/register')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.ref === 'string' ? { ref: search.ref } : {}),
  }),
  component: RegisterPage,
})

const REGISTER_TIMEOUT_MS = 20_000
const REGISTER_SIGN_IN_TIMEOUT_MS = 15_000
const PROFILE_LOAD_TIMEOUT_MS = 8_000

function RegisterPage() {
  const { ref } = Route.useSearch()
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setSession, loadProfile } = useAuthStore()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return

    const cleanUsername = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      toast.error('Username must be 3–30 characters: letters, numbers, and underscores only.')
      return
    }
    if (password !== confirm) {
      toast.error('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      const normalised = normaliseEthiopianPhone(phone)

      // Server function: creates auth user + profile + wallet
      const result = await withTimeout(
        registerUserFn({
          data: {
            username: cleanUsername,
            phone: normalised,
            password,
            referredBy: ref?.toLowerCase(),
          },
        }),
        REGISTER_TIMEOUT_MS,
        'Registration request timed out.',
      )

      if (result.success !== true) {
        toast.error(result.message)
        return
      }

      // Sign in after successful registration
      const { data: signInData, error: signInErr } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: result.email,
          password,
        }),
        REGISTER_SIGN_IN_TIMEOUT_MS,
        'Registration sign-in timed out.',
      )
      if (signInErr) throw signInErr

      setSession(signInData.session)
      if (signInData.session?.user) {
        try {
          await withTimeout(
            loadProfile(signInData.session.user.id),
            PROFILE_LOAD_TIMEOUT_MS,
            'Profile loading timed out.',
          )
        } catch {
          // Profile will be loaded by auth state listener as fallback
        }
      }

      toast.success('Account created! Welcome to QHash.')
      navigate({ to: '/dashboard' })
    } catch (err: unknown) {
      if (isTimeoutError(err)) {
        toast.error('Registration is taking too long. Please check your connection and try again.')
        return
      }

      toast.error(getSafeErrorMessage(err, 'AUTH').message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card neon className="mt-4">
      <div className="flex items-center gap-2 mb-6">
        <Hash size={18} className="text-[#00ff41]" />
        <h1 className="text-lg font-bold">Create your account</h1>
      </div>

      {ref && (
        <div className="mb-4 flex items-center gap-2 text-xs text-[#00ff41]/80 bg-[#00ff41]/5 border border-[#00ff41]/20 rounded-lg px-3 py-2">
          <UserCheck size={13} />
          Referred by <span className="font-mono font-bold ml-0.5">@{ref}</span>
        </div>
      )}

      <form onSubmit={handleRegister} className="space-y-4">
        <Input
          label="Username"
          type="text"
          placeholder="e.g. abebe_kebede"
          value={username}
          onChange={(e) =>
            setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
          }
          hint="3–30 chars. Letters, numbers, underscore. Permanent — choose carefully."
          autoComplete="username"
          required
        />
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
          placeholder="Min. 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Input
          label="Confirm Password"
          type="password"
          placeholder="Repeat password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />

        <Button type="submit" fullWidth loading={loading}>
          Create Account
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <Link to="/login" className="text-[#00ff41] hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  )
}
