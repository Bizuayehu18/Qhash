# Routing and Country-Rail Architecture

Status: approved target routing contract; the USDT-BEP20 deposit and
withdrawal routes are implemented, while most routes described here remain
future work.

This document defines stable public URLs and how a user's registered country controls fiat-rail visibility. It must be implemented incrementally with compatibility redirects and no behavior change during the initial mechanical reorganization.

## Route vocabulary

Route segments use stable machine codes:

- lowercase ISO 3166-1 alpha-2 country codes, such as `et`, `in`, and `gb`;
- lowercase provider slugs, such as `cbe` and `telebirr`;
- separate asset and network path segments, such as `usdt/bep20`; and
- domain nouns rather than component or vendor implementation names.

Display names are localized UI data and must not be parsed from URLs.

Public route identity is provider-independent. For the current rail, the URL
segments are `usdt/bep20`, the UI label is `BNB Smart Chain (BEP20)`, and the
NOWPayments adapter maps that pair to its existing `usdtbsc` provider currency.
Provider-specific identifiers must not become public route segments.

## User routes

### Deposits

| Purpose | Canonical route |
|---|---|
| Deposit hub | `/deposit` |
| Country fiat options | `/deposit/fiat/:country` |
| Fiat provider flow | `/deposit/fiat/:country/:provider` |
| Crypto options | `/deposit/crypto` |
| USDT-BEP20 flow | `/deposit/crypto/usdt/bep20` |

Initial Ethiopian examples:

- `/deposit/fiat/et`
- `/deposit/fiat/et/cbe`
- `/deposit/fiat/et/telebirr`
- `/deposit/crypto/usdt/bep20`

Implementation status:

- `/deposit` remains the live deposit hub and is now a thin route through the
  shared deposits public facade.
- `/deposit/crypto/usdt/bep20` is the first canonical rail route.
- The hub's Crypto Deposit option navigates to that route.
- Ethiopia CBE and TeleBirr presentation now has provider-specific file
  ownership under the fiat-deposit domain, while the established in-page user
  flow and URL remain unchanged.
- Fiat country and provider routes are not live because the current payment
  method boundary is not yet country-authoritative.

### Withdrawals

| Purpose | Canonical route |
|---|---|
| Withdrawal hub | `/withdraw` |
| Country fiat options | `/withdraw/fiat/:country` |
| Fiat provider flow | `/withdraw/fiat/:country/:provider` |
| Crypto options | `/withdraw/crypto` |
| USDT-BEP20 flow | `/withdraw/crypto/usdt/bep20` |

Initial Ethiopian examples:

- `/withdraw/fiat/et`
- `/withdraw/fiat/et/cbe`
- `/withdraw/fiat/et/telebirr`
- `/withdraw/crypto/usdt/bep20`

Implementation status:

- `/withdraw` remains the live CBE, TeleBirr, and USDT withdrawal hub.
- `/withdraw/crypto/usdt/bep20` is the first canonical withdrawal rail route.
- The hub's USDT-BEP20 option navigates to that route.
- Fiat country and provider routes remain in-page because authoritative
  registered-country rail selection is not implemented yet.

The hubs remain stable navigation entrypoints. Country/provider routes are
details beneath them, not separate financial systems.

## Administrator routes

Administrator navigation is visibly grouped by operational domain:

```text
/admin
/admin/users
/admin/deposits
/admin/deposits/fiat
/admin/deposits/fiat/:country
/admin/deposits/crypto
/admin/withdrawals
/admin/withdrawals/fiat
/admin/withdrawals/fiat/:country
/admin/withdrawals/crypto
/admin/plans
/admin/earnings
/admin/referrals
/admin/support
/admin/settings
/admin/audit
```

Routes and actions must be capability-gated even while one administrator role grants all capabilities. A visible navigation item is never an authorization control by itself.

## Compatibility redirects

Existing bookmarks and application links must continue to work during reorganization.

At minimum:

| Existing route | Compatibility behavior |
|---|---|
| `/deposit` | Remains the deposit hub |
| Existing in-page CBE flow | Navigate or redirect to `/deposit/fiat/et/cbe` when equivalent |
| Existing in-page TeleBirr flow | Navigate or redirect to `/deposit/fiat/et/telebirr` when equivalent |
| Existing in-page Crypto Deposit flow | Navigates to `/deposit/crypto/usdt/bep20`; `/deposit` remains the return hub |
| `/withdraw` | Remains the withdrawal hub |
| Existing in-page fiat withdrawal flow | Navigate or redirect to the matching country/provider route |
| Existing in-page USDT withdrawal flow | Navigate or redirect to `/withdraw/crypto/usdt/bep20` |
| Existing `/admin` tabs | Continue to resolve while grouped admin routes are introduced |

Compatibility behavior must:

- preserve safe, non-sensitive navigation intent where possible;
- never copy tokens, PINs, addresses, or private state into query parameters;
- avoid redirect loops;
- be tested directly;
- use replacement redirects only after the canonical route is live; and
- remain until product telemetry and an approved removal decision show that old links can be retired.

The first reorganization stage preserves current visual design and behavior. URL extraction must not be combined with financial-logic changes or a broad redesign.

## Country derivation

The registration phone control accepts and normalizes an international number. Authoritative country derivation uses maintained international numbering metadata, not a simple string-prefix table.

This matters because:

- `+1` is shared by the United States, Canada, and other numbering-plan territories;
- national formats can contain trunk prefixes;
- number lengths vary; and
- numbering rules change.

The compact registration experience displays the derived country inline and does not ask the user to confirm it in a separate field. If the number is invalid, unsupported, or cannot be resolved unambiguously to an approved country, registration fails with a user-safe correction message.

The normalized phone and registered country become immutable user-owned profile attributes. Users cannot edit them. Support-only correction requires a separately authorized, audited workflow.

## Initial registration countries

The initial registry contains 28 unique approved countries:

| Code | Country | Calling code |
|---|---|---:|
| `IN` | India | `+91` |
| `PK` | Pakistan | `+92` |
| `VN` | Vietnam | `+84` |
| `ID` | Indonesia | `+62` |
| `SG` | Singapore | `+65` |
| `NG` | Nigeria | `+234` |
| `ZA` | South Africa | `+27` |
| `KE` | Kenya | `+254` |
| `GH` | Ghana | `+233` |
| `ET` | Ethiopia | `+251` |
| `BR` | Brazil | `+55` |
| `AR` | Argentina | `+54` |
| `VE` | Venezuela | `+58` |
| `SV` | El Salvador | `+503` |
| `MX` | Mexico | `+52` |
| `UA` | Ukraine | `+380` |
| `GB` | United Kingdom | `+44` |
| `CH` | Switzerland | `+41` |
| `TR` | Turkey | `+90` |
| `DE` | Germany | `+49` |
| `US` | United States | `+1` |
| `CA` | Canada | `+1` |
| `PA` | Panama | `+507` |
| `AU` | Australia | `+61` |
| `NZ` | New Zealand | `+64` |
| `FJ` | Fiji | `+679` |
| `PG` | Papua New Guinea | `+675` |
| `WS` | Samoa | `+685` |

Registration support does not promise fiat support. Every approved country can begin as crypto-only.

## Rail registry

Rail availability is data-driven and independent along these dimensions:

- operation: deposit or withdrawal;
- category: fiat or crypto;
- country;
- provider;
- asset and network;
- global pause;
- rail/provider enablement; and
- operational readiness.

A conceptual record contains:

```text
operation
category
country_code (nullable only for globally applicable crypto)
provider_code
asset_code
network_code
enabled
display_order
configuration_version
```

Secrets, private provider configuration, and internal financial controls must not be exposed through this registry.

## Visibility rules

For an authenticated user:

```text
show fiat deposit
  when a deposit rail is enabled for profile.registered_country

show fiat withdrawal
  when a withdrawal rail is enabled for profile.registered_country

show USDT-BEP20
  when its relevant global and rail controls permit the operation
```

Deposit and withdrawal visibility are independent. A country can have:

- both fiat deposit and withdrawal;
- fiat deposit only;
- fiat withdrawal only; or
- neither, leaving crypto USDT as the only visible rail.

A hidden card is not the security boundary. Direct navigation and server requests must independently verify the authenticated profile country and current rail snapshot.

If a user manually opens `/deposit/fiat/ng/provider-x` while registered in Ethiopia, QHash must not disclose or accept that rail. The response should be a safe unavailable state or redirect to the appropriate hub, without revealing provider configuration.

## Pause behavior

### Deposits

A global deposit pause blocks new deposits across fiat and crypto. Rail-specific disablement can block a narrower scope. Already-admitted settlement and safe recovery remain operational according to their domain contracts.

### Withdrawals

A global withdrawal pause blocks new CBE, TeleBirr, USDT-BEP20, and future
withdrawal requests. Administrators may still resolve requests accepted before
the pause through each rail's existing terminal actions.

Pause state is authoritative on the server and database boundary. UI visibility and polling improve experience but do not replace enforcement.

## Route implementation boundaries

Canonical route modules should:

- load authenticated route context;
- invoke one domain-facing query or command;
- compose domain components;
- map typed domain outcomes to navigation; and
- contain no provider API client, direct balance mutation, exchange-rate arithmetic, or copied financial policy.

Provider-specific components live beneath their domain adapter. Shared fiat and crypto components may be reused only when their semantics are truly shared.

## Translation readiness

Routes use stable codes and do not change when display language changes. Country, provider, asset, network, status, and error text are resolved through translation-ready presentation data.

The initial launch is English only. No route should embed an English display name as an identifier.

## Deferred routing decisions

The following can be finalized during implementation without weakening this contract:

- whether a hub with exactly one available method automatically redirects or displays the single option;
- the final duration of compatibility redirects;
- query-string conventions for non-sensitive filters;
- administrator list-filter URLs; and
- how unavailable country routes distinguish not-found from temporarily disabled without leaking private configuration.
