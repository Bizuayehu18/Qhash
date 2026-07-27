# International USDT Product Requirements

Status: approved product requirements for future implementation; not all requirements are live.

This document records the product owner's confirmed decisions for QHash's international conversion. Where it differs from historical Ethiopia-only documents, this document is the target product direction. Current production behavior remains authoritative until an individual requirement is implemented, reviewed, deployed, and verified.

## Product outcome

QHash will serve an international audience with USDT as its default and canonical currency. Users may enter or exit through country-specific fiat providers when available, but all QHash balances and economic activity are accounted for in USDT.

The experience should remain compact, clear, and premium. The conversion must not sacrifice existing financial controls, idempotency, Fund PIN protection, shared withdrawal policy, provider settlement protections, or immutable audit evidence.

## Confirmed requirements

### Currency and economics

`REQ-CUR-001` QHash's canonical currency is USDT.

`REQ-CUR-002` User available and reserved balances are denominated in USDT.

`REQ-CUR-003` Plan prices, plan purchases, mining earnings, and referral rewards are denominated in USDT.

`REQ-CUR-004` Deposits from local fiat providers are converted into USDT before the user's QHash wallet is credited.

`REQ-CUR-005` Fiat withdrawals debit a USDT-denominated request and deliver the converted local-currency amount through the applicable country rail.

`REQ-CUR-006` Fiat-provider fees are borne by the user. QHash does not cover those fiat-provider fees. Crypto-deposit accounting remains governed by `REQ-DEP-007`.

`REQ-CUR-007` The wallet and ledger are provider-neutral. CBE, TeleBirr, NOWPayments, and future providers are rail adapters, not separate user currencies.

`REQ-CUR-008` Conversion evidence must preserve the local amount and currency, rate reference, fee information, canonical USDT amount, provider reference, and relevant timestamps without exposing secrets.

The exchange-rate provider, rate lock, conversion formula, rounding, display precision, plan pricing, earning rates, and referral economics are deferred decisions.

### Registration and identity

`REQ-ID-001` Registration asks for only email, phone number, and password.

`REQ-ID-002` Registration has no user-chosen username.

`REQ-ID-003` The international phone control derives the registered country without a separate country-confirmation form.

`REQ-ID-004` Country derivation uses normalized phone metadata and fails safely for invalid, unsupported, or ambiguous numbers.

`REQ-ID-005` Phone verification is not required.

`REQ-ID-006` Users can log in with either email or phone plus password.

`REQ-ID-007` QHash creates an immutable, non-PII public account code automatically.

`REQ-ID-008` QHash creates a separate random referral code automatically.

`REQ-ID-009` Public account and referral codes expose no email, phone, country, registration order, or database identifier.

`REQ-ID-010` Users cannot change their registered phone or country. Corrections are support-only and audited.

`REQ-ID-011` Email verification is required before withdrawal, but not for ordinary registration, login, deposit, or plan purchase.

`REQ-ID-012` A verified-email change requires the current login password, the four-digit Fund PIN, verification of the new email, and a 24-hour withdrawal hold.

### Transaction security

`REQ-SEC-001` The Fund PIN remains exactly four numeric digits.

`REQ-SEC-002` The Fund PIN is required for fiat and crypto withdrawal submission.

`REQ-SEC-003` Fund PIN verification is server-owned, rate-limited, and inaccessible through direct client table access.

`REQ-SEC-004` Login credentials, Fund PINs, authentication tokens, provider secrets, full sensitive identifiers, and raw errors must never enter public logs or responses.

`REQ-SEC-005` Existing security invariants must be inspected and characterized before a domain is reorganized or converted.

### Countries and rails

`REQ-RAIL-001` The 28 unique approved countries support registration at the initial international launch.

`REQ-RAIL-002` A country may launch as crypto-only.

`REQ-RAIL-003` Fiat deposit availability is configured independently by country and provider.

`REQ-RAIL-004` Fiat withdrawal availability is configured independently by country and provider.

`REQ-RAIL-005` A user's registered country determines which fiat rails are visible and usable.

`REQ-RAIL-006` When no fiat deposit rail is enabled for the registered country, the fiat deposit section is hidden.

`REQ-RAIL-007` When no fiat withdrawal rail is enabled for the registered country, the fiat withdrawal section is hidden.

`REQ-RAIL-008` Hiding a rail is not authorization. Direct routes and server requests revalidate country and current rail availability.

`REQ-RAIL-009` USDT on BNB Smart Chain (BEP20) is the initial common crypto rail.

`REQ-RAIL-010` Country registration support and financial-rail enablement are separate configuration decisions.

The approved countries are India, Pakistan, Vietnam, Indonesia, Singapore, Nigeria, South Africa, Kenya, Ghana, Ethiopia, Brazil, Argentina, Venezuela, El Salvador, Mexico, Ukraine, the United Kingdom, Switzerland, Turkey, Germany, the United States, Canada, Panama, Australia, New Zealand, Fiji, Papua New Guinea, and Samoa.

### Deposits

`REQ-DEP-001` A global deposit pause blocks admission of new fiat and crypto deposits.

`REQ-DEP-002` Rail-specific configuration can disable an individual deposit rail without disabling unrelated rails.

`REQ-DEP-003` Authentication and active/non-frozen profile validation precede private deposit disclosure.

`REQ-DEP-004` Paused or unavailable crypto views expose no actionable address, QR, Copy, Generate, or Retry control.

`REQ-DEP-005` Previously admitted provider settlement, repeated-payment handling, idempotent credit, and safe recovery remain operational while new admission is paused.

`REQ-DEP-006` Existing NOWPayments permanent-address behavior remains: a qualifying original deposit activates the address permanently, and repeated deposits can credit through the same address.

`REQ-DEP-007` USDT crypto deposits credit verified gross `actually_paid`; provider outcome remains separate audit evidence.

`REQ-DEP-008` Every successful credit changes the canonical USDT wallet through an immutable, idempotent ledger boundary.

### Withdrawals

`REQ-WDR-001` One accepted withdrawal is allowed per rolling 24 hours across all fiat and crypto rails.

`REQ-WDR-002` The rolling period starts immediately when QHash successfully accepts the user's request.

`REQ-WDR-003` Wrong Fund PIN, insufficient balance, invalid destination, disabled rail, failed authentication, and other attempts rejected before acceptance do not consume the allowance.

`REQ-WDR-004` An accepted request counts even if it is later rejected.

`REQ-WDR-005` A nonterminal request blocks another withdrawal across every rail, even when more than 24 hours have elapsed since submission.

`REQ-WDR-006` Once the previous request is terminal, the user may submit again only after 24 hours have elapsed from that previous accepted submission.

`REQ-WDR-007` The target unified withdrawal request command carries a stable
idempotency key. Exact replay returns the accepted request rather than creating
another request or consuming another allowance. The current USDT boundary
already provides this behavior; this requirement does not claim that the
legacy ETB function currently does.

`REQ-WDR-008` A global withdrawal pause blocks new CBE, TeleBirr, USDT-BEP20, and future withdrawal requests together.

`REQ-WDR-009` Administrators can continue to resolve previously accepted
withdrawals through each rail's existing terminal actions while new requests
are paused.

`REQ-WDR-010` For the simplified manual USDT workflow, user-visible statuses
are only Pending, Completed, and Rejected.

`REQ-WDR-011` The simplified manual USDT administrator workflow exposes only
Complete and Reject for a pending request.

`REQ-WDR-012` In the simplified manual USDT workflow, Complete means the
administrator takes responsibility for having sent the exact net amount.

`REQ-WDR-013` In the simplified manual USDT workflow, a public transaction hash
is optional, administrator-only evidence. It is not required for completion
and is not displayed to the user.

`REQ-WDR-014` The simplified manual USDT workflow does not require blockchain,
explorer, confirmation, contract, or balance verification.

`REQ-WDR-015` Reservation, completion, and rejection are atomic, idempotent, and ledger-backed. Rejection returns the full reserved gross amount exactly once.

Current fiat status names and Approve/Reject actions remain unchanged during
the behavior-preserving reorganization. Any later terminology unification
requires a separate accepted product decision.

### Navigation and presentation

`REQ-UX-001` Visible deposit and withdrawal URLs are structured by category, country/provider, or crypto asset/network.

`REQ-UX-002` Canonical examples include:

- `/deposit/fiat/et/cbe`
- `/deposit/fiat/et/telebirr`
- `/deposit/crypto/usdt-bep20`
- `/withdraw/fiat/et/cbe`
- `/withdraw/fiat/et/telebirr`
- `/withdraw/crypto/usdt-bep20`

`REQ-UX-003` Existing URLs and entrypoints retain compatibility redirects while canonical routes are introduced.

`REQ-UX-004` The administrator interface is grouped into Users, Deposits, Withdrawals, Plans, Earnings, Referrals, Support, Settings, and Audit, with Fiat and Crypto subsections where relevant.

`REQ-UX-005` Initial restructuring preserves current behavior and visual design.

`REQ-UX-006` Premium international redesign follows domain by domain after behavioral equivalence is established.

`REQ-UX-007` The international launch is English only.

`REQ-UX-008` New user-facing features are translation-ready and use locale-aware formatting.

### Administration

`REQ-ADM-001` QHash keeps one administrator role initially.

`REQ-ADM-002` Authorization is organized by named capabilities so future Super Admin, Finance, and Support roles can be introduced without another application-wide rewrite.

`REQ-ADM-003` Navigation visibility does not replace server and database authorization.

`REQ-ADM-004` Administrator actions remain authenticated, active/non-frozen, auditable, idempotent where appropriate, and sanitized.

### Engineering and documentation

`REQ-ENG-001` Each domain has an explicit owner boundary for UI, application services, validation, data access, provider adapters, and tests.

`REQ-ENG-002` Route files and Function entrypoints remain thin and contain no duplicated financial policy.

`REQ-ENG-003` Applied migrations are never edited. Schema changes use forward-only migrations.

`REQ-ENG-004` A reorganization PR does not combine mechanical file moves with financial behavior changes or broad visual redesign.

`REQ-ENG-005` Future PRs update relevant architecture or operational documentation.

`REQ-ENG-006` Automated quality checks cover naming, formatting, import boundaries, tests, and file-complexity warnings, with generated files explicitly exempt.

`REQ-ENG-007` Large current files are decomposed incrementally through tested seams.

`REQ-ENG-008` Current GitHub source, Netlify deployment behavior, Supabase schema/catalog, and provider contracts are inspected before changing their domain.

## Test-data cutover

All current QHash users are test users.

At the final international-USDT cutover:

- preserve Auth accounts;
- preserve profiles;
- preserve assigned public account codes;
- preserve referral codes and referral relationships;
- archive the full pre-cutover financial record; and
- reset test balances, plans, earnings, deposits, withdrawals, and transactions.

The test-user status reduces customer-impact concerns but does not reduce accounting, security, audit, or migration requirements. The reset requires a separate reviewed runbook, exact target manifest, explicit authorization, deterministic pre/post evidence, and recovery plan.

This requirements document does not authorize a reset or any production mutation.

## Acceptance themes

Implementation is complete only when relevant acceptance evidence shows:

- the same financial rule is enforced through every applicable rail;
- UI and server outcomes agree without relying on UI controls for security;
- provider-specific data cannot change a canonical balance outside the ledger boundary;
- concurrent and repeated actions do not duplicate credits, reservations, rewards, or withdrawals;
- country restrictions cannot be bypassed through a direct URL or API request;
- paused and disabled states fail closed;
- personal data and secrets do not appear in logs, routes, referral codes, or public account codes;
- compatibility links continue to resolve;
- current behavior remains stable during mechanical reorganization; and
- documentation describes what is live, what is target state, and what remains deferred.

## Deferred product decisions

These decisions require explicit approval before implementation:

- exchange-rate provider and backup source;
- rate quote duration, expiry, and refresh behavior;
- exact fiat deposit and withdrawal conversion formulas;
- exact fee application order;
- canonical storage precision and user-facing display precision;
- plan catalog, earning rates, durations, and referral reward economics in USDT;
- compliance, KYC, sanctions, tax, and country-launch requirements;
- country-by-country fiat providers and operating limits;
- support workflow for phone/country correction;
- referral-link/session attribution and legacy referral-link compatibility,
  without adding a normal fourth registration field;
- public account and referral code alphabets, lengths, and collision policy; and
- exact provider-artifact treatment in the test-data cutover.

No implementation may select these policies implicitly.
