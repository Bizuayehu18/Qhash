# CBE & TeleBirr Deposit — Final Stable Production Checkpoint

**Status:** Finalized / Stable Production State
**Scope:** Deposit verification, approval, audit logging for CBE and TeleBirr
**Date:** 2026-06-05

This document captures the current, finalized stable production state of the CBE and
TeleBirr deposit systems. It is a reference checkpoint only. No frontend, backend,
Android, or migration code is changed by this document.

---

## 1. CBE Deposit Flow

The CBE deposit path is finalized and stable in production with the following behavior:

- **Old FT transaction ID flow remains active.** The existing FT transaction ID flow
  is preserved and continues to operate unchanged.
- **CBE receipt URL** is constructed using the transaction ID combined with the active
  CBE `account_last_8`.
- **Receipt amount is extracted and used for wallet credit.** The amount parsed from the
  fetched CBE receipt is the value used to credit the wallet.
- **User-entered amount is not trusted.** The amount entered by the user is never used
  for the wallet credit decision.
- **Receiver must match the active CBE payment method.** A deposit is only valid when the
  receipt receiver matches the currently active CBE payment method.
- **Payment date freshness rule still applies.** Receipts must satisfy the payment date
  freshness requirement.
- **Valid fresh receipt auto-approves** through `approve_deposit_tx`.
- **Wrong receiver and invalid CBE link auto-reject** through `approve_deposit_tx`.
- **Old / missing / unparseable / future payment date** keeps the deposit in
  **pending / manual review** (it is not auto-rejected).

### CBE Canonical Reference Handling

- **Reference No. (VAT Invoice No)** is extracted from the receipt and used as the
  **canonical `transaction_reference`**.
- **Duplicate check uses the extracted canonical CBE reference**, not the
  submitted reference.
- **Modified CBE references that point to an already-used receipt are rejected** with
  `duplicate_extracted_reference`.
- **If the submitted reference differs from the extracted reference but the extracted
  reference is new**, approval is allowed **only after** the pending deposit row is
  updated to the extracted canonical reference.

### CBE Approval Path Guarantees

- **`approve_deposit_tx` remains the only approval/rejection path.**
- **No direct wallet writes.**

---

## 2. TeleBirr Deposit Flow

The TeleBirr deposit path is finalized and stable in production with the following behavior:

- **Android verifier remains the active automation path.** Automated TeleBirr
  verification runs through the Android verifier.
- **Android verifier fetches the receipt** and sends:
  - `extracted_transaction_id`
  - `amount`
  - `receiver`
  - `status`
  - payment date
- **Backend uses `extracted_transaction_id` as the canonical `transaction_reference`.**
- **Missing extracted transaction ID blocks auto-approval.**
- **Duplicate check uses the extracted canonical TeleBirr transaction ID.**
- **Canonical update must succeed before approval** if the submitted ID differs from the
  extracted ID.
- **Valid fresh receipt auto-approves** through `approve_deposit_tx`.
- **Old receipt goes to pending / manual review.**
- **Unreadable receipt auto-rejects.**
- **Wrong receiver auto-rejects.**

### TeleBirr Approval Path Guarantees

- **`approve_deposit_tx` remains the only approval/rejection path.**
- **No direct wallet writes.**

---

## 3. Audit / Logging

- **`deposit_verification_logs` exists** and is wired for both CBE and TeleBirr
  final decisions.
- **Audit events cover** `approved`, `rejected`, and `manual-review` outcomes.
- **Audit failures never block money movement.** A failure to write an audit row does not
  stop or reverse a deposit decision.
- **Audit stores only safe fields and last4 references.**

### Audit Data — Must Never Be Stored

The following must **never** be stored in audit logs:

- Full receipt text
- Full receipt URLs
- API keys
- Full transaction references
- Raw receiver / account names

### Logging Masking

- **Deposit-submit logs now mask submitted transaction references to last4.**
- **TeleBirr verifier logs also use last4.**

---

## 4. Verification Evidence

The finalized state was confirmed with the following observed evidence:

**CBE**
- Valid CBE receipt **approved once**.
- Modified CBE references were **rejected** using `duplicate_extracted_reference`.

**TeleBirr**
- Valid TeleBirr receipt **approved**.
- Old TeleBirr receipt **stayed pending / manual review**.
- Unreadable TeleBirr receipt **rejected**.

**Audit**
- TeleBirr audit rows verified for **auto-approved**, **auto-rejected**, and
  **manual-review** events.

---

## 5. Guardrails (Do Not Regress)

These invariants define the stable checkpoint. They must not be regressed:

- **Do not** trust user-entered amount.
- **Do not** fall back to `deposits.amount` for wallet credit.
- **Do not** bypass `approve_deposit_tx`.
- **Do not** reintroduce direct wallet writes.
- **Do not** auto-reject network / server failures.
- **Do not** expose full receipt URLs or raw receipt text in logs.
- **Do not** change the CBE Receipt ID migration; it remains **paused**.
- **Do not** edit old applied migrations; use **roll-forward migrations only**.

---

## 6. Summary

| Area | Canonical Reference | Auto-Approve | Auto-Reject | Pending / Manual Review |
|---|---|---|---|---|
| **CBE** | Extracted Reference No. (VAT Invoice No) | Valid fresh receipt | Wrong receiver, invalid CBE link, duplicate extracted reference | Old / missing / unparseable / future date |
| **TeleBirr** | Extracted transaction ID | Valid fresh receipt | Unreadable receipt, wrong receiver | Old receipt, missing extracted transaction ID |

Both flows route **all** approval and rejection decisions through `approve_deposit_tx`,
perform **no direct wallet writes**, and emit safe, last4-masked audit events to
`deposit_verification_logs` without ever blocking money movement on audit failure.
