import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppLayout } from '@/components/layout/AppLayout.js'
import { useAuthStore } from '@/store/authStore.js'
import { PageLoader } from '@/components/ui/Spinner.js'
import { useWalletSync } from '@/hooks/useWalletSync.js'

export const Route = createFileRoute('/_app')({
  component: AppLayoutRoute,
})

function AppLayoutRoute() {
  const session = useAuthStore((s) => s.session)
  const initialized = useAuthStore((s) => s.initialized)
  const loading = useAuthStore((s) => s.loading)
  const navigate = useNavigate()

  useWalletSync()

  useEffect(() => {
    if (initialized && !loading && !session) {
      navigate({ to: '/login', replace: true })
    }
  }, [initialized, loading, session, navigate])

  if (!initialized || loading) {
    return <PageLoader />
  }

  if (!session) {
    return <PageLoader />
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}
