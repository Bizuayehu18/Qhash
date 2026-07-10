# Crypto Deposit Foundation Checkpoint

This checkpoint documents the confirmed-safe state after the merged crypto deposit foundation work:

- PR #214: database and generated type foundation
- PR #215: read-only user-facing crypto deposit overview UI/server helper

Use this file as a guardrail before starting any future crypto watcher, admin address assignment, wallet crediting, sweeping, or private-key-related work.

## Current merged state

### Database foundation

The database foundation exists for USDT deposits on:

- TRON / TRC20
- BSC / BEP20
