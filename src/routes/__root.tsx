import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore.js'

import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'theme-color', content: '#0a0a0a' },
      { title: 'QHash — Cloud Mining Platform' },
      { name: 'description', content: 'Next-generation cloud mining for Ethiopia' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  const initialized = useAuthStore((s) => s.initialized)

  useEffect(() => {
    if (!initialized) {
      useAuthStore.getState().initialize()
    }
  }, [initialized])

  return <Outlet />
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-[#0a0a0a] text-gray-100">
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: '#111',
              border: '1px solid rgba(0,255,65,0.25)',
              color: '#f1f5f9',
              fontSize: '13px',
            },
          }}
        />
        <Scripts />
      </body>
    </html>
  )
}
