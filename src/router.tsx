import { createRouter, Link } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

// Minimal, self-contained 404 fallback. Rendered for any unmatched path so
// TanStack Router no longer logs the "__root__" notFound warning. No loaders,
// no auth checks — purely presentational.
function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
        background: '#0a0a0a',
        color: '#fff',
      }}
    >
      <p style={{ fontSize: '3rem', fontWeight: 700, color: '#00ff41', margin: 0 }}>
        404
      </p>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Page not found</h1>
      <p style={{ color: '#888', margin: 0 }}>
        The page you are looking for does not exist.
      </p>
      <Link
        to="/dashboard"
        style={{
          marginTop: '0.5rem',
          padding: '0.6rem 1.25rem',
          borderRadius: '0.5rem',
          border: '1px solid #00ff41',
          color: '#00ff41',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        Back to dashboard
      </Link>
    </div>
  )
}

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
  })

  return router
}
