# TanStack 404 / Log-Noise Checkpoint

This document is a checkpoint record of the work done to remove repeated TanStack
Router "notFound" warnings from the Netlify server handler logs. It is
**documentation only** — no application code, business logic, database, Supabase,
Netlify functions, or frontend UI behavior is changed by this document.

---

## 1. Problem

The Netlify server handler logs contained repeated warnings of the form:

```
notFoundError was encountered on the route with ID "__root__"
```

These warnings appeared frequently and added noise to the function logs, making it
harder to read genuine signal (errors, durations, memory usage). The warning was
emitted by TanStack Router every time a request resolved to an unknown path.

---

## 2. Cause

The warnings were produced because the router had no explicit "not found" handling:

- The router had **no `defaultNotFoundComponent`** configured.
- The root route had **no `notFoundComponent`** configured.
- Unknown paths therefore fell through to TanStack Router's **generic default 404**,
  which logs a warning attributing the miss to the root route ID `"__root__"`.

Typical requests that triggered this behavior:

- `/apple-touch-icon.png` and similar browser/OS asset probes
- Stale endpoints such as `/api/log-smoke`
- Web crawlers requesting paths that do not exist
- Mistyped or outdated URLs

Each of these produced a `"__root__"` notFound warning in the server handler logs.

---

## 3. Fix

A minimal, presentation-only fallback was added so that unknown paths resolve to a
branded 404 page instead of falling through to the generic default that logs the
warning.

- Added a **router-level `defaultNotFoundComponent`** in `src/router.tsx`.
- The component is a **simple branded 404 page**.
- **No loaders** are involved.
- **No auth checks** are performed.
- **No route tree changes** were made.
- **No Netlify redirect changes** were made.
- **No business logic changes** were made.

The fix is intentionally narrow: it only supplies a UI fallback for unmatched routes,
which also resolves the repeated log warning.

---

## 4. Verification

- Requesting `/apple-touch-icon.png` renders the custom branded 404 page.
- The Netlify server handler logs no longer show the
  `notFoundError was encountered on the route with ID "__root__"` warning for that
  request.
- Only normal log lines (e.g. `Duration` / `Memory Usage`) appear for such requests.
- Existing authenticated pages continue to load correctly:
  - Dashboard
  - Deposit
  - Admin
  - Notifications

---

## 5. Scope

- This change is **UI fallback / log-noise cleanup only**.
- No changes to:
  - CBE
  - Deposit flow
  - TeleBirr
  - Admin
  - Android
  - Supabase
  - Database

---

## Summary

A router-level `defaultNotFoundComponent` was introduced to give unmatched routes a
branded 404 page. As a side effect, the repeated `"__root__"` notFound warnings no
longer flood the Netlify server handler logs, leaving only normal duration and memory
lines. The change is purely presentational and touches no business logic, data, or
infrastructure.
