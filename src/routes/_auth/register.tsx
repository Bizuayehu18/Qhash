import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase.js'
import { registerUserFn } from '@/lib/server/auth.js'
import { useAuthStore } from '@/store/authStore.js'
import { normaliseEthiopianPhone } from '@/lib/phone.js'
import { Button } from '@/components/ui/Button.js'
import { Input } from '@/components/ui/Input.js'
import { Card } from '@/components/ui/Card.js'
import { Hash, UserCheck } from 'lucide-react'
import { getSafeErrorMessage } from '@/lib/errors.js'
import { isTimeoutError, withTimeout } from '@/lib/async.js'

export const Route = createFileRoute('/_auth/register')({
  validateSearch: (search: Record<string, unknown>) => ({
    ref: typeof search.ref === 'string' ? search.ref : undefined,
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
  const setSession = useAuthStore((s) => s.setSession)
  const loadProfile = useAuthStore((s) => s.loadProfile)

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
    <div className="min-h-screen bg-[#050505] matrix-bg flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-2 mb-8">
        <Hash className="text-[#00ff41]" size={24} />
        <span className="font-bold text-xl">QHash</span>
      </div>

      <Card className="w-full max-w-md p-6 border-[rgba(0,255,65,0.2)]">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Hash className="text-[#00ff41]" size={20} />
          Create your account
        </h1>

        {ref && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.2)] bg-[rgba(0,255,65,0.04)] px-3 py-3 text-xs text-gray-300">
            <UserCheck size={16} className="text-[#00ff41] mt-0.5" />
            <div>
              <div className="font-semibold text-white">Referral applied</div>
              <div className="text-gray-500 mt-1">Invited by @{ref.toLowerCase()}</div>
            </div>
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <Input
            label="Username"
            placeholder="e.g. abebe_mining"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            hint="3–30 chars. Letters, numbers, underscore. Permanent — choose carefully."
          />
          <Input
            label="Phone Number"
            placeholder="+2519..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            placeholder="Min. 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label="Confirm Password"
            type="password"
            placeholder="Repeat password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          <Button type="submit" fullWidth loading={loading}>Create Account</Button>
        </form>

        <div className="text-center mt-5 text-sm text-gray-500">
          Already have an account?{' '}
          <button
            onClick={() => navigate({ to: '/login' })}
            className="text-[#00ff41] font-medium"
          >
            Sign in
          </button>
        </div>
      </Card>

      <footer className="mt-8 text-[11px] text-gray-700">© 2026 QHash. All rights reserved.</footer>
    </div>
  )
}
