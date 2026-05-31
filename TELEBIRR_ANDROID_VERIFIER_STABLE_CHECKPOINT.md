# TeleBirr Android Verifier — Latest Stability Checkpoint

**Status:** Stable
**Last updated:** 2026-05-31
**Scope:** Documentation only. This file records the current stable state of the Android TeleBirr verifier app. It does not change app code, backend logic, the database, Netlify functions, or Android source.

---

## Overview

The TeleBirr Android verifier is the operator-facing companion app used to verify TeleBirr deposit receipts. It fetches pending deposits from the backend, parses each receipt on-device, and submits a parsed result. The backend remains the sole authority for approval, rejection, and manual-review decisions. This checkpoint captures the latest known-good state so it can be referenced and restored with confidence.

---

## Source Location

1. **Private source only.** The verifier lives at `android/telebirr-receipt-test/` and is maintained as private project source.
2. **No public distribution.** The previously published ZIP and download page were removed from `public/`. There is no public-facing Android build artifact or landing page anymore.

---

## App Inputs and Controls

The app exposes the following fields and controls:

- **Backend URL field** — the base URL of the verifier backend.
- **API key field** — the verifier API key used to authenticate requests.
- **`X-Verifier-Api-Key` header** — the API key is sent on each request via this header.
- **Auto Mode toggle** — enables or disables automated polling.
- **Fetch Pending button** — manually loads the current set of pending deposits.
- **Verify This Deposit button** — manually verifies the selected deposit.

---

## Security

- **API key is masked on screen.** It is never shown in plaintext in the UI.
- **API key is memory-only.** It exists only in app memory during a session.
- **API key is not persisted.** It is not written to disk, preferences, or any local store.
- **API key is not hardcoded.** It is supplied by the operator at runtime, never baked into source.
- **Backend URL remains visible.** The URL is not a secret, so it is displayed normally.

---

## Auto Mode

- **Foreground only.** Auto Mode has no background service, WorkManager job, or boot receiver.
- **Runs only while the app is open.** Closing the app stops the automation.
- **Polls every 2 minutes.** Each cycle fetches the current pending deposits.
- **Verifies pending deposits sequentially.** Deposits are processed one at a time within a cycle.
- **Logs the auto cycle number.** Each polling cycle is identified in the on-screen log.
- **Caps logs at 300 entries.** Older log lines are trimmed to bound memory use.
- **Friendly network retry message.** Transient connectivity failures produce a clear, non-alarming message and are retried on the next cycle.

---

## Latest Verified Behavior

The following behaviors were confirmed in the latest stable state:

| Scenario | Expected outcome | Result |
|---|---|---|
| Valid fresh TeleBirr receipt | Auto-approved | ✅ |
| Extracted receipt amount | Credited to wallet | ✅ |
| Wrong receiver | Auto-rejected | ✅ |
| Unreadable / invalid receipt | Auto-rejected | ✅ |
| Old receipt | Routed to `manual_review` | ✅ |
| `paymentDate` extraction | Works | ✅ |

The wallet credit always uses the **extracted receipt amount**, never a user-submitted value.

---

## Do-Not-Break Guardrails

These constraints define the stable contract. They must not be changed without separate, dedicated testing and review:

- Do **not** store the API key in plaintext.
- Do **not** hardcode the API key.
- Do **not** re-add a public Android ZIP or download page.
- Do **not** call Supabase directly from Android.
- Do **not** change backend decision rules from Android.
- Android submits a parsed receipt result only; the **backend remains the authority**.
