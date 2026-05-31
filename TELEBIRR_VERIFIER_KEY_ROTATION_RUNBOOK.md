# TeleBirr Verifier API Key Rotation Runbook

This runbook describes how to safely rotate `TELEBIRR_VERIFIER_API_KEY`. It is documentation only — no application code, backend logic, database schema, Android source, or Netlify environment values are changed by reading or following this guide.

---

## 1. Purpose

`TELEBIRR_VERIFIER_API_KEY` is the shared secret that authenticates the Android TeleBirr verifier operator to the backend. It protects the following endpoints:

- `GET  /api/verifier/pending-telebirr` — fetches deposits awaiting manual TeleBirr verification.
- `POST /api/verifier/submit-telebirr-result` — submits an approve / reject / manual_review decision for a deposit.

The Android verifier app authenticates by sending the key in the request header:

```
X-Verifier-Api-Key: <key>
```

Requests with a missing or incorrect key must be rejected. Rotating the key invalidates the previous secret so that only the current key works.

---

## 2. When to Rotate

Rotate the key in any of these situations:

- **Suspected key leak** — the key may have been exposed (screenshot, log, chat, shared device, repository, etc.).
- **Operator phone lost or stolen** — the device holding the manually entered key is no longer under trusted control.
- **Before launch** — replace any pre-launch / testing key with a fresh production key.
- **Periodic maintenance** — routine rotation on a regular schedule as good security hygiene.

---

## 3. Where the Key Lives

- The single source of truth is the **Netlify environment variable** `TELEBIRR_VERIFIER_API_KEY`.
- The **Android app does not hardcode** the key. There is no build-time copy of it in the app.
- The **operator enters the key manually** in the verifier app on a trusted device.
- **Do not commit** the key to GitHub (or any repository).
- **Do not put** the key in `.env.example` (that file is a template and must contain only placeholders, never real values).

---

## 4. Safe Rotation Steps

1. **Generate a new strong random key.**
   - Use a cryptographically strong random value (long, high-entropy, unguessable).
   - Generate it on a trusted machine. Do not reuse an old key or a predictable string.

2. **Update the Netlify environment variable.**
   - In the Netlify site settings, set `TELEBIRR_VERIFIER_API_KEY` to the new value.
   - Keep the variable name exactly as-is. Do **not** add a `VITE_` prefix (see Guardrails).

3. **Trigger / redeploy as required.**
   - If the functions read the environment value at runtime, redeploy or restart the site/functions so the new value takes effect.
   - Confirm the deploy/functions are live before continuing.

4. **Open the Android verifier app** on the trusted operator device.

5. **Enter the new key** in the app's verifier key field, replacing the old one.

6. **Test Fetch Pending.**
   - Trigger the "Fetch Pending" action and confirm it returns pending TeleBirr deposits without an auth error.

7. **Test one verifier request if possible.**
   - Submit one valid and/or one invalid verifier result and confirm the backend responds as expected (approve / reject / manual_review handled correctly).

8. **Confirm the old key no longer works.**
   - Verify that a request using the previous key is now rejected with HTTP 401.

---

## 5. Verification Checklist

After rotation, confirm all of the following:

- [ ] A **missing or wrong** key returns **HTTP 401**.
- [ ] The **correct** key successfully fetches pending deposits.
- [ ] **Logs do not show key values** — neither the expected key nor the provided key appears in any log output.
- [ ] The app still **approves / rejects / manual_reviews** correctly with the new key.

---

## 6. Emergency Procedure (Leaked Key)

If the key is leaked:

1. **Immediately replace** the Netlify environment value `TELEBIRR_VERIFIER_API_KEY` with a new strong random key.
2. **Do not wait for an app update.** Because the Android key is entered manually, no app release is required — invalidating the backend value instantly disables the leaked key.
3. **Re-enter the new key only on a trusted operator device.** Do not enter it on any device that may be compromised.

The moment the Netlify value changes and the functions pick it up, every request using the old key starts returning HTTP 401.

---

## 7. Guardrails

- **Never** prefix `TELEBIRR_VERIFIER_API_KEY` with `VITE_`. A `VITE_`-prefixed variable is exposed to the client bundle; this secret must remain server-side only.
- **Never** commit real keys to any repository.
- **Never** paste the key into public chat, issues, screenshots, or documentation.
- **Never** log expected or provided key values (no debug logging of the header or the env value).
- **Keep** `.env` and `.env.local` ignored by git so local secrets are never committed.
