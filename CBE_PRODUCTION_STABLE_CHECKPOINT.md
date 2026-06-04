# CBE Production Stable Checkpoint

**Status:** Stable — current production path
**Date:** 2026-06-04
**Scope:** Commercial Bank of Ethiopia (CBE) deposit auto-verification — end-to-end production state after testing.
**Type:** Documentation only — no app, backend, business logic, database, Supabase, Netlify function, or frontend UI changes accompany this checkpoint.

This document records the current stable CBE production state as confirmed by live testing. It is a reference snapshot for agents and developers; it does not request or describe new changes. It consolidates and complements the surrounding CBE notes: [`CBE_FRESHNESS_CHECKPOINT.md`](./CBE_FRESHNESS_CHECKPOINT.md), [`CBE_ATOMIC_APPROVAL_CHECKPOINT.md`](./CBE_ATOMIC_APPROVAL_CHECKPOINT.md), and [`CBE_RECEIPT_ID_MIGRATION_PAUSED.md`](./CBE_RECEIPT_ID_MIGRATION_PAUSED.md).

---

## 1. Current production CBE flow

The **old CBE receipt URL method is the active production path** and stays in place unchanged:

- The user enters a CBE Transaction ID starting with `FT`.
- The backend generates the receipt URL using:

  ```
  https://apps.cbe.com.et:100/?id={TXN_ID}{LAST_8_RECEIVER_ACCOUNT_DIGITS}
  ```

- The new `mbreciept.cbe.com.et` Receipt ID migration is **paused / not implemented**. See [`CBE_RECEIPT_ID_MIGRATION_PAUSED.md`](./CBE_RECEIPT_ID_MIGRATION_PAUSED.md).

---

## 2. Existing CBE safety architecture

The verification and crediting safety model is unchanged and remains in force:

- Verification runs **server-side**.
- The **user-entered deposit amount is not trusted** for wallet credit.
- The **receipt-extracted amount** is used for crediting.
- The **receiver must match** the active CBE payment method.
- The **payment-date freshness rule** applies (see [`CBE_FRESHNESS_CHECKPOINT.md`](./CBE_FRESHNESS_CHECKPOINT.md)).
- A **duplicate `transaction_reference` check** applies.
- Approval and rejection happen through **`approve_deposit_tx`**.
- There are **no direct wallet writes from `cbe-verify.ts`**.
- **TeleBirr is untouched.**

---

## 3. Current auto-approval behavior

A fresh, valid CBE receipt **auto-approves**, crediting the extracted receipt amount only.

Latest verified log:

| Field | Value |
|---|---|
| transactionReference | `FT26155CLS5N` |
| parsed amount | `19` |
| receiver_verified | `true` |
| ageMinutes | `2` |
| freshness_check | `fresh` |
| outcome | `cbe_auto_approval_succeeded` |
| balanceBefore | `51078.3` |
| balanceAfter | `51097.3` |
| transactionId | `29899ec1-5d70-4f92-823a-addea8e1e522` |

---

## 4. Current auto-reject behavior

### Wrong receiver auto-rejects

Latest verified log:

| Field | Value |
|---|---|
| transactionReference | `FT26155DJH53` |
| parsed amount | `600` |
| condition | `receiver_mismatch` |
| outcome | `cbe_auto_reject_succeeded` |
| reasonCode | `receiver_mismatch` |

### Readable invalid CBE reference auto-rejects

A reference whose receipt fetch returns a **readable invalid-link response** auto-rejects with reason code `invalid_cbe_link`. Recent verified examples:

| Reference | Detection | Status / Content-Type | Outcome | reasonCode |
|---|---|---|---|---|
| `FTKFKKF` | `invalid_link_detected` | `500` `application/json` | `cbe_auto_reject_succeeded` | `invalid_cbe_link` |
| `FT26155T26Y4` | `invalid_link_detected` | `404` `text/html` | `cbe_auto_reject_succeeded` | `invalid_cbe_link` |
| `FT26155T26Y` | `invalid_link_detected` | `404` `text/html` | `cbe_auto_reject_succeeded` | `invalid_cbe_link` |

---

## 5. Current manual-review behavior

The following cases stay **pending / manual review** with no wallet write (and are **not** auto-rejected):

- Old / stale payment date.
- Missing, unparseable, or future payment date.
- Network / DNS / timeout / TLS / connection failure.
- Generic non-200 response **without** a readable invalid-link body.
- Duplicate reference — stays manual review, **no double credit**.
- Fetch / extraction / parse uncertainty.

---

## 6. Logging state

- Netlify logs are confirmed working.
- Deposit / CBE logs appear under:

  ```
  Logs & metrics → Functions → @netlify/vite-plugin server handler
  ```

- Production logs are cleaned:
  - no full receipt text previews,
  - no full receipt URLs,
  - no raw parsed receipt object,
  - no raw receiver name in console reject logs.
- The TanStack `__root__` `notFound` warning noise was fixed with a default 404 fallback.

---

## 7. Receipt ID migration paused

- The new CBE `mbreciept.cbe.com.et` Receipt ID flow was **inspected but not implemented**.
- Do **not** change the CBE input from the `FT` Txn ID to the Receipt ID **unless the old flow breaks again**.
- If the old flow breaks later, reuse the previous inspection plan carefully and validate each step against a real live receipt before changing behavior. See [`CBE_RECEIPT_ID_MIGRATION_PAUSED.md`](./CBE_RECEIPT_ID_MIGRATION_PAUSED.md).

---

## 8. Guardrails

When working on CBE, preserve the following invariants:

- Do **not** trust the user-entered amount.
- Do **not** fall back to `deposits.amount` for credit.
- Do **not** reintroduce direct wallet writes.
- Do **not** bypass `approve_deposit_tx`.
- Do **not** change TeleBirr while working on CBE.
- Do **not** expose receipt URLs or raw receipt text in logs.
- Do **not** auto-reject network / server failures.
- Keep the old CBE flow as the production path until a deliberate migration decision is made.

---

## Reference files

- `src/lib/server/cbe-verify.ts` — server-side CBE receipt verification; extracts the amount, receiver, transaction id, and payment date; applies receiver match, duplicate, and freshness gating; returns extracted data only and performs no direct wallet write.
- `src/lib/server/deposits.ts` — submit handler; resolves the admin actor and calls `approve_deposit_tx` for eligible, fresh deposits.
- Database RPC: `approve_deposit_tx` — atomic wallet credit, transaction insert, deposit status update, row locking.
