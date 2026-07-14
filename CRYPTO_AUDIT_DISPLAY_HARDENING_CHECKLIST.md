# Crypto Audit Display Hardening Checklist

Status: docs-only checkpoint after the admin crypto deposit audit view and confirmation/crediting guardrails.

This document defines the small audit-display hardening items that should be completed before confirmation writes, crediting, or audit-dependent reconciliation rely on the admin audit screen. It does not add code, database migrations, RPCs, UI actions, confirmation writes, wallet crediting, balance changes, transaction inserts, sweeping, signing, key handling, user-facing address exposure, or `crypto_auto_credit_enabled` changes.

## Current audit state

The admin audit view is read-only and admin-gated. It lets admins inspect stored `crypto_deposits` rows after BSC detection storage runs.

Current safety