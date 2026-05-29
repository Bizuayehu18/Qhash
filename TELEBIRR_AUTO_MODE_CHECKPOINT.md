# TeleBirr Auto Mode — Checkpoint

**Status:** Stable
**Last updated:** 2026-05-28
**Scope:** Documentation only. This file records the current stable state of the TeleBirr Auto Mode feature. It does not change code, database, backend, or Android logic.

---

## Overview

TeleBirr Auto Mode automates the deposit verification flow that was previously performed manually. While enabled, the Android app periodically fetches pending TeleBirr deposits, parses each receipt, and submits a verification result using the exact same endpoints, parser, and payload as manual verification. No backend, database, or approval logic was changed to support Auto Mode.

---

## Current Stable State

1. **Android foreground Auto Mode is implemented.**
2. **Auto Mode runs only while the app is open.** It is a foreground-only feature.
3. **No background execution.** No background service, no WorkManager, no boot receiver, and no new Android permissions are used.
4. **Poll interval is 2 minutes.** Each polling cycle fetches the current set of pending deposits.
5. **Delay between verifying deposits is 2.5 seconds.** Deposits within a cycle are processed sequentially with this spacing.
6. **Auto Mode uses the same existing endpoints as manual verification:**
   - `GET /api/verifier/pending-telebirr`
   - `POST /api/verifier/submit-telebirr-result`
7. **Same parser and same submit payload.** Auto Mode reuses the existing `ReceiptParser` and constructs the identical submit payload used by manual verification.
8. **Manual controls are unaffected.** The manual **Fetch** and **Verify** buttons still work as before.
9. **Pre-enable validation.** Auto Mode validates the backend URL and API key before it can be enabled.
10. **Single job at a time.** Only one auto polling job can run at a time.
11. **Lifecycle cleanup.** `onCleared` cancels auto polling.

---

## Test Results

Auto Mode was successfully tested across the following scenarios:

| Scenario | Expected outcome | Result |
|---|---|---|
| Fresh valid receipt | Auto-approved | ✅ |
| Old receipt | Routed to `manual_review` | ✅ |
| Wrong receiver | Auto-rejected | ✅ |
| Unreadable / invalid receipt | Auto-rejected | ✅ |

### Netlify logs confirmed

The following backend log events were observed during testing, confirming the verification path behaves identically to manual verification:

- `verifier_result_validated`
- `verifier_deposit_approved`
- `verifier_manual_review_saved`
- `verifier_auto_reject`

---

## Wallet Credit Rule

**Wallet credit uses the extracted receipt amount only.** The amount credited is derived from the parsed receipt, never from any user-submitted value.

---

## Known Issues

- **Android / network DNS errors** such as "Unable to resolve host" are phone or network issues, **not** backend issues. Auto Mode retries on the next cycle, so transient connectivity failures self-recover without intervention.

---

## Do-Not-Break Guardrails

These constraints define the stable contract for Auto Mode. They must not be changed without separate, dedicated testing and review:

- Do **not** change receipt amount trust rules.
- Do **not** trust user-submitted amount.
- Do **not** remove `extracted_payment_date`.
- Do **not** change `ReceiptParser` unless separately tested.
- Do **not** add background mode yet.
- Do **not** modify backend approval / reject / manual_review rules.
- Do **not** call Supabase directly from Android.
