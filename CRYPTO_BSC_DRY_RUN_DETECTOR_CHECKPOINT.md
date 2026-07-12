# BSC Dry-Run Detector Checkpoint

This document records the first code step after the watcher design phase.

## Scope

This checkpoint adds a backend-only BSC dry-run detector helper.

It does not:

- credit wallets
- update user balances
- insert crypto deposits
- expose addresses to users
- sweep funds
- sign transactions
- generate addresses
- store private keys or seed phrases

## BSC token details

The BSC USDT contract used by this dry-run helper is:

```
0x55d398326f99059ff775485246999027b3197955
```

This Binance-Peg BSC-USD token uses 18 decimals. Verify token constants again before any future production crediting logic.

## Current dry-run behavior

The helper:

1. authenticates an admin user server-side
2. loads active assigned BSC USDT deposit addresses
3. calls BSC JSON-RPC `eth_getLogs`
4. filters USDT `Transfer` events
5. matches recipient addresses against assigned addresses
6. returns preview events only

No database writes occur.

## Future requirements before live watcher

Before any production watcher:

- add persistent watcher state handling
- add confirmed-block policy
- add deposit ingestion idempotency
- add admin audit workflow
- add crediting only in a separate reviewed PR

## Safety boundary

This PR is detection-only. Detection is not crediting.
