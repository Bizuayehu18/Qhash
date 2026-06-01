# Netlify Logging Checkpoint

This document records the verified logging state for the QHash project on Netlify. It captures where logs appear, how to debug deposit/CBE flows, what temporary instrumentation was removed, and what known noise remains. **This is documentation only — no application code, business logic, database, Supabase config, Netlify functions, or frontend UI was changed.**

## 1. Standalone Netlify function logs work

Standalone functions deployed under `netlify/functions` emit their own logs to Netlify. Each standalone function has its own log stream under **Logs & metrics → Functions**.

## 2. `/api/log-smoke` smoke test confirmed all console levels

A temporary smoke test at `/api/log-smoke` confirmed that the following all appeared in Netlify logs:

- `console.log`
- `console.info`
- `console.warn`
- `console.error`

All four levels were verified visible.

## 3. TanStack server handler logs also work

Logs emitted from TanStack server handlers are captured by Netlify and are visible in the dashboard.

## 4. `submitDepositFn` logs location

`submitDepositFn` logs appear under:

> **Logs & metrics → Functions → `@netlify/vite-plugin server handler`**

They do **not** appear under the standalone function streams.

## 5. CBE verification logs location

CBE verification logs appear under the **same** server handler:

> **Logs & metrics → Functions → `@netlify/vite-plugin server handler`**

## 6. Verified visible events

The following events were confirmed visible in the server handler logs:

- `deposit_submit_started`
- `deposit_method_loaded`
- `cbe_verification` / `verification_started`
- `receipt_url_generated`
- `receipt_fetch_failed`
- `cbe_auto_verification_failed`

## 7. Standalone functions have their own logs

The following standalone functions under `netlify/functions` each have their own dedicated log streams:

- `admin-approve-deposit`
- `verifier-pending-telebirr`
- `verifier-submit-telebirr-result`
- `daily-earnings`
- `trigger-daily-earnings`

## 8. Deposit/CBE logs do NOT appear under standalone functions

Deposit and CBE logs are **not** emitted to the standalone function streams listed above. They are only found under the `@netlify/vite-plugin server handler`.

## 9. How to debug deposit/CBE logs

To debug deposit or CBE flows:

1. Open the **`@netlify/vite-plugin server handler`** log stream.
2. Set the stream to **Real-time** *before* submitting a test deposit.
3. **Clear filters first.**
4. Then search for `depositId`, `cbe`, `deposit_submit`, or a specific event name.

## 10. Temporary smoke-test code was removed

The temporary smoke-test instrumentation has been removed:

- `netlify/functions/log-smoke.mts` — deleted
- `QHASH_LOG_SMOKE_20260601` — removed from `deposits.ts`

## 11. Known remaining log noise

- A TanStack Router `notFound` warning for route `"__root__"` still appears in the logs.
- This is to be inspected later and is **not** part of the deposit/CBE logic.

## 12. CBE/deposit production logging cleanup

Production logging cleanup has already removed or gated the following risky logs:

- Full receipt text previews
- Full receipt URLs
- Raw parsed receipt objects
- Raw receiver names from console logs

---

*Checkpoint recorded 2026-06-01. Documentation only — no functional changes.*
