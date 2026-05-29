import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AuthLayout } from '@/components/layout/AuthLayout.js'
import { useAuthStore } from '@/store/authStore.js'
import { PageLoader } from '@/components/ui/Spinner.js'

export const Route = createFileRoute('/_auth')({
  component: AuthLayoutRoute,
})

function AuthLayoutRoute() {
  const session = useAuthStore((s) => s.session)
  const initialized = useAuthStore((s) => s.initialized)
  const loading = useAuthStore((s) => s.loading)
  const navigate = useNavigate()

  useEffect(() => {
    if (initialized && !loading && session) {
      navigate({ to: '/dashboard', replace: true })
    }
  }, [initialized, loading, session, navigate])

  if (!initialized || loading) {
    return <PageLoader />
  }

  if (session) {
    return <PageLoader />
  }

  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  )
}
