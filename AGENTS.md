# AGENTS.md — QHash Project Guide

This document is intended for AI agents and developers working on this codebase.

## Project Overview

QHash is a cloud-mining fintech platform for Ethiopian users. Users buy mining plans, earn daily rewards, and manage deposits/withdrawals. Authentication is phone-number based, with Supabase email auth used internally.

## Tech Stack

- **TanStack Start** — full-stack SSR framework (file-based routing via TanStack Router)
- **React 19** — UI
- **Tailwind CSS 4** — utility-first styling (CSS-first config via `@theme` in `src/styles.css`)
- **Supabase** — auth + database
- **Zustand** — global state (auth, UI)
- **Sonner** — toast notifications
- **Netlify** — deployment target

## Directory Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── AppLayout.tsx     # Sidebar + top bar for authenticated pages
│   │   └── AuthLayout.tsx    # Centered layout for login/register
│   └── ui/
│       ├── Badge.tsx
│       ├── Button.tsx        # Variants: primary, secondary, ghost, danger, outline
│       ├── Card.tsx          # Card, CardHeader, CardTitle, CardDescription
│       ├── Input.tsx         # With label, error, hint, leftAddon props
│       └── Spinner.tsx       # Spinner + PageLoader
├── lib/
│   ├── supabase.ts           # Supabase client + phone/email conversion utils
│   └── database.types.ts     # Supabase type stubs (replace with generated types)
├── routes/
│   ├── __root.tsx            # HTML shell, Toaster
│   ├── index.tsx             # Public landing page
│   ├── _auth.tsx             # Pathless layout: wraps login/register with AuthLayout
│   ├── _auth/
│   │   ├── login.tsx         # /login
│   │   └── register.tsx      # /register
│   ├── _app.tsx              # Pathless layout: protected, redirects to /login if no session
│   └── _app/
│       ├── dashboard.tsx
│       ├── deposit.tsx
│       ├── withdraw.tsx
│       ├── plans.tsx
│       ├── referrals.tsx
│       ├── transactions.tsx
│       ├── support.tsx
│       └── admin.tsx         # Admin-only (checks user_metadata.role === 'admin')
├── store/
│   ├── authStore.ts          # Zustand: session, user, signOut, initialize
│   └── uiStore.ts            # Zustand: globalLoading, sidebarOpen
└── styles.css                # Tailwind 4 entry + QHash @theme tokens + scrollbar
```

## Routing Conventions (TanStack Router)

- `_auth.tsx` + `_auth/` — pathless layout for public auth pages
- `_app.tsx` + `_app/` — pathless layout for protected pages; `beforeLoad` checks Supabase session and throws `redirect({ to: '/login' })` if unauthenticated
- All new protected pages go under `src/routes/_app/`
- All new public pages go directly under `src/routes/`

## Authentication Pattern

Phone number input is normalised to E.164 (`+2519XXXXXXXX`) via `normaliseEthiopianPhone()` in `src/lib/supabase.ts`. It is then converted to an internal email address via `phoneToEmail()` before calling Supabase auth methods. The user always sees phone-based UI; the email is an implementation detail.

Admin role is stored in `user.user_metadata.role`. Set it to `"admin"` in Supabase to grant admin access.

## Design System

- **Background**: `#0a0a0a` base, `#111` surfaces
- **Accent**: `#00ff41` (neon green) — used for active states, badges, highlights
- **CSS classes**: `.neon-text`, `.neon-border`, `.neon-glow` (defined in `styles.css`)
- **Tailwind 4 theme tokens**: `--color-neon`, `--color-surface`, etc. in `@theme` block

## State Management

- `useAuthStore` — call `initialize()` once at app startup to load the Supabase session and listen for auth changes
- `useUIStore` — sidebar toggle and global loading flag

## Adding New Pages

1. Create `src/routes/_app/my-page.tsx`
2. Use `createFileRoute('/_app/my-page')({ component: MyPage })`
3. Add the route to `NAV_ITEMS` in `src/components/layout/AppLayout.tsx` if it needs a sidebar link

## Supabase Types

Run the following after schema changes to get type-safe queries:
```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/lib/database.types.ts
```

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
