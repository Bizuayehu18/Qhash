# GitHub → Netlify Deployment Checkpoint

This document records the current stable deployment workflow for QHash. It is a
reference checkpoint: it describes how production is built and deployed today,
why the workflow was changed, what was verified after the change, and the
guardrails that must not be broken going forward.

**Status:** Stable
**Last updated:** 2026-05-29

---

## 1. Source of truth

The application source code is stored in a **private GitHub repository**:

- https://github.com/Bizuayehu18/Qhash

All production changes flow through this repository.

## 2. Netlify ↔ GitHub connection

The Netlify site is **connected to the GitHub repository**. Netlify builds the
site automatically from the connected repo instead of from manual uploads.

## 3. Deployment flow

```
GitHub main branch  →  Netlify build  →  dist/client (publish)
```

A push/merge to `main` triggers a Netlify build, which runs the build command
against clean source and publishes the generated `dist/client` directory.

## 4. Netlify build settings

| Setting | Value |
|---|---|
| Branch | `main` |
| Base directory | *(empty)* |
| Build command | `npm run build` |
| Publish directory | `dist/client` |
| Functions directory | `netlify/functions` |

These match `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist/client"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
```

## 5. Why this change was made

Manual / drag-and-drop upload deploys left **stale deploy artifacts** behind in
production. Because uploads do not clear previously deployed files the way a
clean source build does, leftover test artifacts persisted across deploys,
including:

- `telebirr-app.html`
- `telebirr-receipt-test.zip`
- `assets/telebirr-test-*.js`

## 6. How the GitHub-connected build fixed it

With the GitHub-connected workflow, **Netlify runs the build from clean source**
on every deploy. The publish directory is regenerated from the repository, so no
stale, manually-uploaded artifacts can survive. Only what the build produces
gets published.

## 7. Verified after the GitHub deploy

The following checks passed after switching to the GitHub-connected build:

- Deploy file browser search for **"telebirr"** returned **no files**
- Dashboard page loads
- Deposit page loads
- Admin page loads
- Notifications page loads

## 8. Current `public/` folder

The `public/` folder contains only:

- `favicon.ico`

It does **not** contain:

- a public Android verifier ZIP
- a public TeleBirr app page

## 9. Android verifier source

The Android verifier source remains **private in the repository** and is not
published to the public site:

- `android/telebirr-receipt-test/`

## 10. Production verifier endpoints

The following verifier functions remain in production:

- `netlify/functions/verifier-pending-telebirr.mts`
- `netlify/functions/verifier-submit-telebirr-result.mts`
- `netlify/functions/lib/verifier-auth.mts`

---

## Do-not-break guardrails

> These rules exist to prevent the stale-artifact problem (section 5) from
> recurring. Treat them as hard constraints.

- **Do not** return to manual upload deploys for production.
- **Do not** upload deployed ZIPs as source.
- **Do not** upload whole project folders to Netlify manually.
- **Do not** put a public Android verifier ZIP back into `public/`.
- **Do** commit future changes to GitHub and let the Netlify build deploy them.
