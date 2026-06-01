# CBE Payment-Date Freshness Checkpoint

**Status:** Stable
**Date:** 2026-05-31
**Scope:** Commercial Bank of Ethiopia (CBE) deposit receipt payment-date extraction and freshness gating.
**Type:** Documentation only — no app, backend, database, Netlify function, or Android changes accompany this checkpoint.

This document records the current stable behavior of CBE payment-date extraction and the freshness rule that gates auto-approval. It is a reference snapshot for agents and developers; it does not request or describe new changes. It complements [`CBE_ATOMIC_APPROVAL_CHECKPOINT.md`](./CBE_ATOMIC_APPROVAL_CHECKPOINT.md), which documents the atomic approval path.

---

## 1. Payment date is now extracted

The CBE verifier (`src/lib/server/cbe-verify.ts`) now extracts a `paymentDate` field from the CBE receipt text. It is carried on the parsed `ReceiptData` object alongside the amount, receiver name, transaction id, and status.

The date is sourced from the receipt body. Because CBE typically prints the date/time in the receipt content rather than as a structured JSON field, the parser does not short-circuit on JSON alone — it falls through to the text/regex fallbacks so the date can still be recovered.

---

## 2. Supported live format

The verified live format is:

```
Payment Date & Time 6/1/2026, 12:59:00 AM
```

The label `Payment Date & Time` is matched (also tolerating `Payment Date and Time`, `Payment Date/Time`, and `Payment Date`), and the date/time substring after it is captured.

---

## 3. What the CBE payment-date parser supports

`parseCBEPaymentDate` accepts the following:

- **Date forms:** `M/D/YYYY` and `MM/DD/YYYY` (month first, US-style ordering as printed by CBE).
- **Optional comma** separating the date and the time (e.g. `6/1/2026, 12:59:00 AM` or `06/01/2026 00:59:00`).
- **Time:** `HH:mm:ss` (hours, minutes, seconds).
- **12-hour time** with an `AM`/`PM` meridiem, including the `12 AM = 00:00` and `12 PM = 12:00` edge cases.
- **24-hour time** when no meridiem is present (hours `0`–`23`).
- **Ethiopia timezone:** the parsed instant is anchored to the `+03:00` offset, since CBE prints local Addis Ababa time with no explicit timezone.

Out-of-range or malformed input (bad month, day, hour, minute, or second) parses to `null` and is treated as unparseable.

---

## 4. Freshness rule

After receiver match, duplicate check, and a re-confirmation that the deposit is still `pending`, the verifier applies a freshness gate before allowing auto-credit:

| Condition | Decision |
|---|---|
| Fresh — within **60 minutes** of now | Eligible for auto-approval |
| Older than **60 minutes** | Pending / manual review |
| In the future beyond **5 minutes** of skew | Pending / manual review |
| Missing payment date | Pending / manual review |
| Unparseable payment date | Pending / manual review |

The thresholds are defined as `CBE_FRESHNESS_MAX_AGE_MS` (60 minutes) and `CBE_FUTURE_SKEW_MS` (5 minutes).

Stale, future, missing, and unparseable dates are **not auto-rejected**. They return `verified: false` so the deposit stays pending for manual review with an explanatory note; no wallet write occurs.

---

## 5. Approval still goes through `approve_deposit_tx` only

A fresh, fully verified receipt is auto-approved by the caller (`src/lib/server/deposits.ts`) through the hardened database RPC `approve_deposit_tx`. The freshness gate decides only whether a deposit is *eligible* for that path; it never approves on its own. Approval remains atomic and row-locked, crediting the extracted receipt amount.

---

## 6. The verifier still writes nothing directly

`cbe-verify.ts` performs verification only. It does **not** write the wallet, insert a transaction, mark the deposit approved, or insert a notification. On success it returns extracted data; all crediting is delegated to the caller via `approve_deposit_tx`. This invariant is unchanged by the freshness work.

---

## 7. Latest verified tests

| Receipt | Result | Detail |
|---|---|---|
| Old receipt `5/28/2026, 10:43 PM` | Held for review | Age **4457 min** old (exceeds 60-minute window) |
| Fresh receipt `6/1/2026, 12:59 AM` | Approved | Age **2 min**; amount **160**; balance **50402 → 50562** |
| Invalid / fake reference | Pending / manual review | Returned **HTTP 500**, stayed pending |
| Wrong receiver | Pending / manual review | Receiver mismatch, stayed pending |

These confirm the fresh-path auto-approval and that stale, fake-reference, and wrong-receiver cases all stay in manual review without a direct wallet write.

---

## 8. Known next improvement

A deliberate, not-yet-implemented follow-up is to decide which CBE failure cases — if any — should auto-reject in the way TeleBirr does, specifically:

a) **Wrong receiver.**
b) **Unreadable / fake receipt.**

This must **not** be implemented until each case is inspected carefully. Today both cases stay in pending / manual review.

---

## Guardrails

When working on CBE freshness, preserve the following invariants:

- Do **not** auto-reject network / DNS / timeout / CBE outage failures — these are transient and stay pending.
- Do **not** auto-reject a stale date — keep stale (and future / missing / unparseable) dates as manual review.
- Do **not** reintroduce direct wallet writes in `cbe-verify.ts`.
- Do **not** change TeleBirr logic while working on CBE.

---

## Reference files

- `src/lib/server/cbe-verify.ts` — extracts `paymentDate`, parses it (`parseCBEPaymentDate`), and applies the freshness gate; returns extracted data only.
- `src/lib/server/deposits.ts` — submit handler; resolves the admin actor and calls `approve_deposit_tx` for eligible, fresh deposits.
- Database RPC: `approve_deposit_tx` — atomic wallet credit, transaction insert, deposit status update, row locking.
</content>
</invoke>
