# CBE Receipt ID Migration — Paused

**Status:** Paused / Not implemented
**Date:** 2026-06-04
**Scope:** Commercial Bank of Ethiopia (CBE) deposit auto-verification — input format and receipt URL model.
**Type:** Documentation only — no app, backend, database, Supabase, Netlify function, or UI changes accompany this note.

This document records a decision to **pause** the migration of CBE deposit auto-verification from the old `apps.cbe.com.et` receipt-URL model to the new `mbreciept.cbe.com.et` Receipt ID model. It complements the prior inspection (see [`CBE_FRESHNESS_CHECKPOINT.md`](./CBE_FRESHNESS_CHECKPOINT.md) and [`CBE_ATOMIC_APPROVAL_CHECKPOINT.md`](./CBE_ATOMIC_APPROVAL_CHECKPOINT.md) for the surrounding CBE behavior). It does not request or describe any code change.

---

## 1. The new CBE Receipt ID flow was inspected but not implemented

A new CBE receipt system was observed at:

```
https://mbreciept.cbe.com.et/{RECEIPT_ID}
```

accepting a bare Receipt ID (e.g. `fHCxz6kZ2mGRK89cR9`) or the full receipt URL. The migration to this model — input normalization, case-preserving Receipt ID handling, "Transferred Amount only" parsing, month-name date parsing, duplicate keying, and UI relabelling — was **inspected only**. The inspection findings remain on record as a plan. **None of it was implemented**, and it should not be implemented now.

---

## 2. The old CBE URL flow is working again and remains the production path

The previous receipt-URL method is functioning again:

```
https://apps.cbe.com.et:100/?id={TXN_ID}{LAST_8_RECEIVER_ACCOUNT_DIGITS}
```

This old flow is the **current production path** and stays in place unchanged:

- The user enters a CBE Transaction ID starting with `FT`.
- The backend continues generating the receipt URL from the Txn ID + the receiver account's last 8 digits.
- The existing parser, freshness rule, receiver-match check, duplicate check, auto-approve, and auto-reject behavior remain unchanged.
- TeleBirr remains untouched.
- No database migration.
- No UI change.

---

## 3. Do not switch CBE input from FT Txn ID to Receipt ID

Do **not** change the CBE deposit input from the `FT` Transaction ID format to the new Receipt ID / Receipt URL format **unless the old flow breaks again**. While the old `apps.cbe.com.et` endpoint continues to work, the `FT` Txn ID input is the supported and intended path.

---

## 4. If the old flow breaks again, reuse the previous inspection plan carefully

Should the old `apps.cbe.com.et` receipt flow stop working, do not improvise. Reuse the previously recorded inspection plan for the `mbreciept.cbe.com.et` Receipt ID model, applying it carefully and validating each step against a real live receipt before changing behavior. Key safety invariants from that plan must be preserved:

- Never trust the user-entered amount; credit only the **Transferred Amount** extracted from the receipt (not the total debited, which includes the service charge).
- Receiver must match the active CBE payment method.
- The freshness rule still applies using the receipt's Payment Date & Time.
- Duplicate prevention must work on the normalized Receipt ID.
- Wrong receiver and readable-invalid receipts must reject; network/server failures stay pending for manual review.
- Approval only via `approve_deposit_tx`; no direct wallet writes.
- TeleBirr must remain untouched.

---

## 5. No code, database, or UI changes were made

This note is documentation only. No code, database, Supabase, Netlify function, or frontend UI changes were made as part of this decision. The migration is paused, not implemented.
