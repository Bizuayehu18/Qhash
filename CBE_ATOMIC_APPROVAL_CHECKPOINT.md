# CBE Atomic Auto-Approval Checkpoint

**Status:** Stable
**Date:** 2026-05-31
**Scope:** Commercial Bank of Ethiopia (CBE) deposit auto-verification and atomic approval.
**Type:** Documentation only — no app, backend, database, Netlify function, or Android changes accompany this checkpoint.

This document records the current stable state of the CBE deposit pipeline after auto-approval was moved to an atomic, row-locked RPC. It is a reference snapshot for agents and developers; it does not request or describe new changes.

---

## 1. Where verification runs

CBE auto-verification still runs **server-side during deposit submission**. When a user submits a CBE deposit, the submit handler attempts automatic receipt verification before returning. There is no separate background job — verification is inline with the submit request.

- Submit handler: `src/lib/server/deposits.ts` (`submitDepositFn`)
- Verifier: `src/lib/server/cbe-verify.ts` (`verifyCBEDeposit`)

---

## 2. CBE receipt URL format

The receipt URL is constructed as:

```
https://apps.cbe.com.et:100/?id={FT_REFERENCE}{ACCOUNT_LAST_8}
```

- `{FT_REFERENCE}` — the user-submitted CBE transaction reference, trimmed and upper-cased (must start with `FT`).
- `{ACCOUNT_LAST_8}` — the last 8 digits of the active CBE receiving account, appended directly to the reference with no separator.

The same format is used in both the verifier (`cbe-verify.ts`) and the submit handler's `generateReceiptUrl` (`deposits.ts`).

---

## 3. `account_last_8` is dynamic

`account_last_8` is **not hard-coded**. It is read at verification time from the active CBE payment method:

```
payment_methods.account_last_8
```

The verifier selects the payment method by id where `type = 'cbe'` and `is_active = true`. If the method is missing/inactive, or `account_last_8` is absent, verification fails into manual review (it does not credit).

---

## 4. CBE verifier responsibilities (`src/lib/server/cbe-verify.ts`)

The verifier now performs **verification only**. Its responsibilities are:

- Fetches the CBE receipt (15s timeout, browser-like headers).
- Detects content type: PDF vs HTML/JSON (`%PDF` magic bytes or `content-type`).
- Extracts the **amount** from the receipt.
- Extracts the **receiver** name from the receipt.
- Checks **receiver match** against the payment method's `account_name` (normalized comparison).
- Checks for a **duplicate `transaction_reference`** across other deposits.
- Confirms the deposit is **still pending** before reporting success.
- Returns **verified data only** (`verified`, `receiptData`, `adminNote`, `receiptUrl`, `amount`).

---

## 5. What the CBE verifier no longer does

The verifier no longer performs any direct state mutation. It does **not**:

- Update the wallet.
- Insert a transaction.
- Mark the deposit approved.
- Insert a notification.

All crediting is delegated to the caller via the hardened RPC (see below).

---

## 6. Where CBE approval happens

CBE approval is performed by the caller in:

```
src/lib/server/deposits.ts
```

After a successful verification result, the submit handler resolves an admin actor and invokes the approval RPC. The verifier itself never approves.

---

## 7. Successful verification calls `approve_deposit_tx`

On a verified result with a positive amount, the submit handler calls the database RPC:

```
approve_deposit_tx
```

with:

- `p_deposit_id` — the deposit id
- `p_admin_id` — the resolved active admin actor (see §9)
- `p_action` — `"approve"`
- `p_admin_note` — `"Auto-approved via CBE receipt verification"`
- `p_amount` — the **extracted receipt amount**

---

## 8. What `approve_deposit_tx` provides

The RPC provides an atomic, hardened approval:

- Atomic **wallet credit**.
- **Transaction insert**.
- **Deposit status update**.
- **Row locking**.
- **`p_amount > 0` requirement**.
- **No fallback to `deposits.amount`** — the credited amount is the explicitly passed `p_amount` (the extracted receipt amount).
- **No `reviewed_by` usage**.

After the RPC succeeds, the handler stamps `auto_verified = true` and `verified_at` on the deposit, then inserts a best-effort notification that must not block approval.

---

## 9. Active admin actor

The admin actor passed to the RPC is resolved as:

> the **first profile** where `is_admin = true` and `is_frozen = false`.

This mirrors the TeleBirr verifier's actor resolution. If no such admin exists, approval does not proceed and the deposit stays pending for manual review (see §10).

---

## 10. Failure behavior

Every failure path leaves the deposit in **pending / manual review** and never performs a direct wallet write:

| Failure | Result |
|---|---|
| Receipt fetch failure | Pending / manual review |
| Parse failure | Pending / manual review |
| Receiver mismatch | Pending / manual review |
| Invalid amount (missing or ≤ 0) | Pending / manual review |
| No active admin available | Pending / manual review |
| RPC failure | Pending / manual review |

There is **no fallback to direct wallet writes** in any failure branch. Manual-review updates set `auto_verified = false` and an explanatory `admin_note`.

A special case: if the RPC reports `already_reviewed`, the handler logs and takes no further action (it does not double-credit and does not overwrite the existing review).

---

## 11. Race safety

Manual-review and failure updates apply **only while the deposit status is `pending`**. The `.update(...)` calls in the failure branches are guarded by `.eq("status", "pending")`, so a deposit that was approved/rejected elsewhere between submission and the verifier result is not overwritten. The verifier also re-confirms `status === 'pending'` before reporting success.

---

## 12. Latest verified test

A live verification confirmed the pipeline trusts the **extracted receipt amount**, not the user-entered amount:

- User-submitted amount: **565**
- Extracted CBE receipt amount: **40,000 ETB**
- Receiver: **BIZUAYEHU ALEMAYEHU ASEFA**
- RPC approval: **succeeded**
- `balanceBefore`: **10,392**
- `balanceAfter`: **50,392**
- `transactionId`: **0754355c-ec33-449a-917e-16922e957f79**

The wallet was credited by 40,000 (the receipt amount), confirming the user-entered 565 was ignored. This is the intended trust model: **the extracted receipt amount is authoritative**.

---

## 13. Known remaining CBE gaps

These are documented as known and intentionally out of scope for this checkpoint:

- Payment **date/time** is visible in the receipt text but is **not yet extracted** into a structured field.
- There is **no CBE freshness rule** yet (no check that the receipt is recent).
- CBE verification **still blocks the user submit request** (it runs inline).
- CBE still depends on **Netlify being able to fetch** the CBE receipt.
- `account_last_8` is **stored separately** from `account_number` and can drift from it.

---

## Guardrails

When working on CBE, preserve the following invariants:

- Do **not** reintroduce direct wallet writes in `cbe-verify.ts`.
- Do **not** trust the user-submitted deposit amount.
- Do **not** fall back to `deposits.amount`.
- Do **not** use `reviewed_by`.
- Do **not** change TeleBirr logic while working on CBE.
- Do **not** add a CBE date/freshness rule without inspection and testing first.

---

## Reference files

- `src/lib/server/cbe-verify.ts` — verification only; returns extracted data.
- `src/lib/server/deposits.ts` — submit handler; resolves admin actor and calls `approve_deposit_tx`.
- Database RPC: `approve_deposit_tx` — atomic wallet credit, transaction insert, deposit status update, row locking.
