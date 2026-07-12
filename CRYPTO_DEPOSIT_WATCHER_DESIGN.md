# Crypto Deposit Watcher Detection Design

This document proposes the next crypto-deposit phase for QHash after the merged manual public-address assignment checkpoint.

This is a design document only. It intentionally adds no watcher code, no blockchain RPC calls, no packages, no database writes, no wallet crediting, no user-facing address exposure, no sweeping, no signing, and no private-key handling.

## Current prerequisite state

The current merged crypto state is:
