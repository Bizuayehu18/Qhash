# Android TeleBirr Verifier App — MVP Plan

## 1. Overview

A lightweight Android app that runs 24/7 on a phone in Ethiopia, polls the QHash backend for pending TeleBirr deposits, fetches each receipt from the geo-restricted TeleBirr receipt portal, parses structured data from the receipt page, and submits verification results back to the backend. The app is an **observer and reporter only** — it never updates wallets, deposit statuses, or any financial state.

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Language** | Kotlin | Modern Android standard; coroutines for async polling |
| **Min SDK** | API 26 (Android 8.0) | Foreground service support; covers 95%+ of Ethiopian Android devices |
| **Networking** | Retrofit 2 + OkHttp 4 | Type-safe API calls, interceptors for API key injection, certificate pinning |
| **HTML Parsing** | Jsoup | Robust HTML parser; extracts text from TeleBirr receipt pages without a WebView |
| **Local DB** | Room | Stores pending queue, submission results, and logs for offline resilience |
| **Background** | Foreground Service + coroutine loop | Persistent notification prevents OS kill; WorkManager as a restart safety net |
| **DI** | Hilt | Standard; keeps service/repository wiring clean |
| **Secure Storage** | Android Keystore + EncryptedSharedPreferences | API key and backend URL stored encrypted at rest |
| **UI** | Jetpack Compose | Minimal UI; fast to build the 2-3 screens needed |
| **Build** | Gradle (Kotlin DSL) | Standard Android build system |

---

## 3. App Screens

### 3.1 Setup Screen (shown once on first launch)

- Text field: **Backend URL** (e.g. `https://clever-pika-a9180e.netlify.app`)
- Text field: **API Key** (the `TELEBIRR_VERIFIER_API_KEY` value)
- "Test Connection" button — calls `GET /api/verifier/pending-telebirr` to validate credentials
- "Save & Start" button — persists to EncryptedSharedPreferences, launches the foreground service
- Validation: URL must be HTTPS, API key must be non-empty, test must return 200

### 3.2 Dashboard Screen (main screen)

- **Status banner**: "Running" (green) / "Paused" (yellow) / "Error" (red) with last-poll timestamp
- **Counters row**: Deposits checked | Approved | Sent to review | Errors (since service start)
- **Live log list** (scrolling, newest at top):
  - Each entry: timestamp, deposit ID (truncated), action taken (approved / manual_review / skipped / error), receipt fetch time
  - Color-coded: green = approved, yellow = manual review, red = error, grey = skipped
- **Buttons**: Start / Stop service, "Clear Logs"
- **Pull-to-refresh**: triggers an immediate poll cycle

### 3.3 Settings Screen

- View/change Backend URL and API Key (re-enter required, with "Test Connection")
- Polling interval slider: 15s / 30s / 60s / 120s (default: 30s)
- Toggle: "Vibrate on error"
- Toggle: "Keep screen on" (for dedicated kiosk-style deployment)
- App version, last successful poll time, total deposits processed (lifetime counter via Room)

---

## 4. Architecture

```
┌─────────────────────────────────────────────────┐
│                    UI Layer                       │
│  SetupScreen  ─  DashboardScreen  ─  Settings    │
│         observe LiveData / StateFlow              │
├─────────────────────────────────────────────────┤
│               VerifierViewModel                   │
│  Exposes: serviceState, logEntries, counters      │
├─────────────────────────────────────────────────┤
│            VerifierForegroundService               │
│  Lifecycle: START_STICKY, persistent notification  │
│  Runs: PollLoop (coroutine)                       │
├─────────────────────────────────────────────────┤
│               PollLoop (coroutine)                │
│  1. GET /api/verifier/pending-telebirr            │
│  2. For each deposit:                             │
│     a. Fetch receipt_url via OkHttp               │
│     b. Parse HTML with Jsoup                      │
│     c. POST /api/verifier/submit-telebirr-result  │
│  3. Sleep(interval), repeat                       │
├─────────────────────────────────────────────────┤
│  ReceiptParser        │  QHashApiService          │
│  Jsoup HTML → data    │  Retrofit interface        │
├─────────────────────────────────────────────────┤
│         Room DB (logs, queue, config)              │
│         EncryptedSharedPreferences (secrets)       │
└─────────────────────────────────────────────────┘
```

### Key Components

| Component | Responsibility |
|---|---|
| `QHashApiService` | Retrofit interface for the two backend endpoints |
| `TeleBirrReceiptFetcher` | OkHttp call to `receipt_url`, returns raw HTML |
| `ReceiptParser` | Jsoup extraction: transaction ID, amount, receiver name, status |
| `VerifierForegroundService` | Android foreground service; owns the poll loop coroutine |
| `VerificationRepository` | Coordinates fetch → parse → submit; writes results to Room |
| `LogDao` / `LogEntity` | Room table for on-screen log entries (capped at 500 rows) |
| `SecureConfig` | Reads/writes backend URL + API key via EncryptedSharedPreferences |

---

## 5. API Contract (Read-Only — Do Not Modify Backend)

### 5.1 GET /api/verifier/pending-telebirr

**Request:**
```
GET /api/verifier/pending-telebirr
Header: x-verifier-api-key: <KEY>
```

**Response (200):**
```json
{
  "deposits": [
    {
      "deposit_id": "uuid",
      "transaction_reference": "FT24XXXXXXXXX",
      "receipt_url": "https://transactioninfo.ethiotelecom.et/receipt/FT24XXXXXXXXX",
      "expected_receiver_name": "Abebe Kebede",
      "created_at": "2026-05-20T10:00:00Z"
    }
  ]
}
```

Returns up to 10 pending deposits, oldest first.

### 5.2 POST /api/verifier/submit-telebirr-result

**Request:**
```
POST /api/verifier/submit-telebirr-result
Header: x-verifier-api-key: <KEY>
Content-Type: application/json

{
  "deposit_id": "uuid",
  "transaction_reference": "FT24XXXXXXXXX",
  "receipt_fetch_status": "success",
  "extracted_transaction_id": "FT24XXXXXXXXX",
  "extracted_amount": 500.00,
  "extracted_receiver_name": "Abebe Kebede",
  "extracted_status": "Completed",
  "verifier_note": "optional note"
}
```

**Required fields:** `deposit_id`, `transaction_reference`, `receipt_fetch_status`, `extracted_transaction_id`, `extracted_amount`, `extracted_receiver_name`, `extracted_status`

**Possible responses:**
| HTTP | `action` | Meaning |
|---|---|---|
| 200 | `"approved"` | Deposit auto-approved, wallet credited |
| 200 | `"manual_review"` | Validation mismatch, flagged for admin |
| 409 | `"skipped"` | Deposit already processed |
| 400 | — | Bad request (missing fields, wrong type) |
| 401 | — | Invalid API key |
| 404 | — | Deposit not found |
| 500 | `"manual_review"` | Server-side error during approval |

---

## 6. Receipt Parsing Strategy

### 6.1 Target URL

```
https://transactioninfo.ethiotelecom.et/receipt/{TRANSACTION_ID}
```

This endpoint is geo-restricted to Ethiopian IP addresses. The Android phone must be on an Ethiopian mobile network or Wi-Fi.

### 6.2 Extraction Rules

The app uses Jsoup to parse the HTML response. Target fields:

| Field | Extraction Strategy |
|---|---|
| **Transaction ID** | Look for label text "Transaction ID" / "Trans. ID" and read the adjacent value element |
| **Amount** | Look for label "Amount" and parse the numeric value (strip "ETB" suffix, commas) |
| **Receiver Name** | Look for label "Receiver" / "To" / "Recipient" and read the adjacent value |
| **Status** | Look for label "Status" and read the text (e.g. "Completed", "Success", "Failed") |

### 6.3 Parser Resilience

- **Multiple selector strategies**: try CSS selectors first (`.receipt-field.amount .value`), fall back to label-text scanning, then regex on raw text
- **Configurable selectors**: store parsing rules in a local JSON config so they can be updated via a settings screen or remote config without rebuilding the APK
- **Validation**: transaction ID must match `[A-Z]{2}\d{10,}` pattern; amount must be > 0; receiver name must be non-empty
- **Failure reporting**: if parsing fails, submit with `receipt_fetch_status: "parse_error"` and `verifier_note` describing what was found vs. what was expected

---

## 7. Polling Logic

### 7.1 Normal Cycle

```
loop {
    deposits = GET /api/verifier/pending-telebirr
    for each deposit in deposits:
        html = fetch(deposit.receipt_url, timeout=15s)
        if html is error:
            log error, skip to next deposit
            continue
        parsed = ReceiptParser.extract(html)
        if parsed is incomplete:
            submit with receipt_fetch_status = "parse_error"
        else:
            submit with receipt_fetch_status = "success" + extracted fields
        delay(2s)  // pause between individual deposits to avoid hammering TeleBirr
    delay(pollingInterval)  // default 30s
}
```

### 7.2 Polling Interval

| Scenario | Interval |
|---|---|
| Normal (deposits returned) | 30 seconds |
| Empty response (no pending deposits) | 60 seconds |
| After N consecutive errors (N ≥ 3) | Exponential backoff: 60s → 120s → 240s, cap at 5 minutes |
| After recovery from error | Reset to 30 seconds |
| User-configurable range | 15s – 120s |

### 7.3 Per-Deposit Throttle

Wait 2 seconds between processing individual deposits within a single poll batch. This avoids rate-limiting by TeleBirr's receipt server and prevents burst load on the QHash backend.

---

## 8. Android Permissions

| Permission | Why |
|---|---|
| `INTERNET` | API calls to QHash backend and TeleBirr receipt endpoint |
| `FOREGROUND_SERVICE` | Required for persistent foreground service |
| `FOREGROUND_SERVICE_DATA_SYNC` | Android 14+ foreground service type declaration |
| `POST_NOTIFICATIONS` | Required on Android 13+ for the persistent notification |
| `WAKE_LOCK` | Keep CPU active during poll cycles when screen is off |
| `RECEIVE_BOOT_COMPLETED` | Auto-restart service after device reboot |
| `ACCESS_NETWORK_STATE` | Detect online/offline to skip polls when disconnected |

No location, camera, contacts, storage, or other sensitive permissions needed.

---

## 9. Foreground Service Design

### 9.1 Service Lifecycle

- **Start**: user taps "Start" on Dashboard, or device boots (via `BOOT_COMPLETED` receiver)
- **Notification**: persistent notification showing "TeleBirr Verifier — Running" with last poll time and deposit count
- **Stop**: user taps "Stop" on Dashboard, or service is explicitly stopped
- **Restart**: `START_STICKY` ensures Android restarts the service if it's killed; WorkManager periodic task (every 15 min) checks if service is alive and restarts if needed

### 9.2 Notification Channel

- Channel ID: `telebirr_verifier_service`
- Importance: `LOW` (no sound, just persistent icon in status bar)
- Content: "Verifier active — X deposits processed, last poll: HH:mm"
- Update notification on each poll cycle

### 9.3 Wakelock Strategy

- Acquire a partial wakelock for the duration of each poll cycle only (not held permanently)
- Release immediately after the poll batch completes
- If no pending deposits, skip wakelock acquisition entirely

---

## 10. Error Handling

### 10.1 Network Errors

| Error | Handling |
|---|---|
| No internet | Log warning, skip poll, retry on next interval. Check `ConnectivityManager` before each poll. |
| QHash API timeout (>10s) | Log error, increment error counter, apply backoff |
| QHash API 401 | Log critical error, stop polling, show red "Invalid API Key" banner. Require user to re-enter key. |
| QHash API 5xx | Log error, increment error counter, apply backoff |
| TeleBirr receipt timeout (>15s) | Submit with `receipt_fetch_status: "timeout"`, move to next deposit |
| TeleBirr receipt non-200 | Submit with `receipt_fetch_status: "not_found"` or `"geo_blocked"` based on status code |

### 10.2 Parse Errors

| Error | Handling |
|---|---|
| HTML loaded but fields not found | Submit with `receipt_fetch_status: "parse_error"`, include raw text snippet in `verifier_note` (first 200 chars, no PII) |
| Amount is not a number | Submit with `receipt_fetch_status: "parse_error"`, note the raw value |
| Receipt page structure changed | Log critical, notify user via UI banner: "Receipt format may have changed — check parser config" |

### 10.3 Backend Response Errors

| Response | Handling |
|---|---|
| 409 (already processed) | Log as "skipped", no retry, remove from local queue |
| 400 (bad request) | Log error with response body, do not retry same deposit in this cycle |
| 404 (deposit not found) | Log warning, do not retry |
| 200 with `action: "approved"` | Log success, increment approved counter |
| 200 with `action: "manual_review"` | Log warning, increment review counter |

### 10.4 Crash Recovery

- Room DB persists the local queue of unsubmitted results across crashes
- On service restart, check Room for any queued results and submit them before starting a fresh poll
- Deduplication: before submitting, check if the deposit_id was already submitted in the last 10 minutes (Room timestamp query)

---

## 11. Battery and Network Considerations

### 11.1 Battery

- **Foreground service** is the most battery-friendly way to run persistent tasks (vs. wakelocks + AlarmManager)
- Poll only when needed: if the pending list is empty, double the interval (60s instead of 30s)
- No GPS, no Bluetooth, no camera — pure network I/O
- Partial wakelock only during active HTTP calls, released immediately after
- Estimated battery impact: **2–4% per hour** on a typical mid-range phone (based on periodic HTTP polling benchmarks)
- Recommendation: keep the phone plugged in to a charger (this is a dedicated kiosk device)

### 11.2 Network

- Each poll cycle: 1 GET request (~1 KB response) + up to 10 receipt fetches (~5–20 KB each) + up to 10 POST requests (~0.5 KB each)
- Worst-case per cycle: ~250 KB
- At 30s intervals, worst case: ~500 KB/min = ~720 MB/day (if always 10 pending deposits)
- Typical case (1-2 pending deposits per cycle): ~50 MB/day
- **Ethiopian mobile data is metered** — prefer Wi-Fi where available
- OkHttp cache headers respected for receipt pages (if TeleBirr sets them)
- No image downloads, no video, no large payloads

### 11.3 Recommended Deployment

- Dedicated Android phone (budget device is fine: 2 GB RAM, Android 8+)
- Connected to stable Wi-Fi and plugged into power
- Screen off most of the time (foreground service keeps running)
- "Keep screen on" toggle in settings for monitoring periods

---

## 12. Security

### 12.1 API Key Storage

- Stored in `EncryptedSharedPreferences` backed by Android Keystore
- Never hardcoded in source or APK
- Entered manually on first launch via the Setup screen
- Transmitted only in the `x-verifier-api-key` HTTP header over HTTPS

### 12.2 Certificate Pinning

- Pin the TLS certificates for both:
  - QHash backend domain (`clever-pika-a9180e.netlify.app` or custom domain)
  - TeleBirr receipt domain (`transactioninfo.ethiotelecom.et`)
- Use OkHttp's `CertificatePinner` with SHA-256 pins
- Include backup pins for certificate rotation
- If pinning fails, log critical error and stop processing (do not fall back to unpinned)

### 12.3 Data Handling

- Parsed receipt data (names, amounts) held in memory only during the poll cycle
- Written to Room DB only as part of log entries (deposit ID + action, no PII)
- `verifier_note` field never includes full receipt HTML, only extraction summaries
- Room DB encrypted via SQLCipher (optional for MVP, recommended for production)

### 12.4 Device Security

- Recommend enabling device encryption and screen lock on the verifier phone
- If the phone is lost: rotate `TELEBIRR_VERIFIER_API_KEY` in Netlify env vars immediately
- The API key grants access only to the two verifier endpoints — no wallet or user data exposure even if compromised

---

## 13. Offline Queue

When the QHash backend is unreachable but a receipt was successfully parsed:

1. Store the verification result in a Room table (`pending_submissions`)
2. On each poll cycle, check for queued submissions first
3. Submit queued items before fetching new pending deposits
4. Remove from queue only after a 200 or 409 response (success or already processed)
5. Cap queue at 100 items; oldest items dropped if exceeded (they'll be retried via next GET anyway)

---

## 14. Test Plan

### 14.1 Unit Tests

| Test | What It Verifies |
|---|---|
| `ReceiptParserTest` | Jsoup extraction logic against sample TeleBirr receipt HTML fixtures |
| `ReceiptParserEdgeCases` | Missing fields, changed HTML structure, Amharic text, extra whitespace |
| `AmountParserTest` | Handles "500.00 ETB", "1,500", "500", negative values, non-numeric strings |
| `NameNormalizationTest` | Case-insensitive, Amharic-safe, special char stripping (must match backend's `normalizeName`) |
| `ApiKeyStorageTest` | Verify key is encrypted at rest, not present in plain text in shared prefs |
| `BackoffCalculatorTest` | Exponential backoff after consecutive errors, reset after success |
| `OfflineQueueTest` | Room insert, deduplication, submission order (FIFO), cap at 100 |

### 14.2 Integration Tests

| Test | What It Verifies |
|---|---|
| `QHashApiIntegration` | Retrofit calls succeed against a mock server (MockWebServer); correct headers, JSON serialization |
| `PollLoopIntegration` | Full cycle: GET → fetch receipt (mocked) → parse → POST, verify correct payload sent |
| `Error401HandlesGracefully` | Service stops polling and shows error banner on auth failure |
| `Error409SkipsDeposit` | Already-processed deposits are not retried |
| `OfflineToOnline` | Queue builds up while offline, drains correctly when connectivity returns |

### 14.3 Manual Test Scenarios (on device in Ethiopia)

| # | Scenario | Expected |
|---|---|---|
| 1 | Fresh install, enter valid URL + key, tap "Test Connection" | Green checkmark, "Save & Start" enabled |
| 2 | Enter invalid API key, tap "Test Connection" | Red error: "Authentication failed" |
| 3 | Start service with no pending deposits | Dashboard shows "Running", log shows "0 pending deposits" |
| 4 | Create a TeleBirr deposit on QHash, wait for poll | App fetches receipt, parses data, submits result. Log shows "approved" or "manual_review" |
| 5 | Turn off Wi-Fi mid-poll | Log shows network error, service continues, resumes on reconnect |
| 6 | Kill app from task manager | Service restarts within 30s (START_STICKY). WorkManager restarts within 15 min. |
| 7 | Reboot phone | Service auto-starts via BOOT_COMPLETED receiver |
| 8 | Leave running overnight on charger | Check morning: service still running, battery usage < 5%, no ANR or crashes |
| 9 | Backend returns 500 | Log shows error, backoff increases, recovers on next success |
| 10 | TeleBirr receipt page unreachable | Log shows "timeout" or "not_found", moves to next deposit |
| 11 | Receipt page HTML structure changed | Log shows "parse_error", banner warns about parser update needed |
| 12 | Process 50+ deposits over a day | Counters accurate, no memory leak, log stays capped at 500 entries |

### 14.4 Acceptance Criteria for MVP

- [ ] App installs on Android 8+ device and runs without crash
- [ ] API key and URL stored encrypted, not visible in plain text
- [ ] Foreground service survives app kill and device reboot
- [ ] Polls pending deposits on configurable interval (default 30s)
- [ ] Fetches TeleBirr receipt HTML from inside Ethiopia
- [ ] Parses transaction ID, amount, receiver name, status from receipt HTML
- [ ] Submits verification result with all required fields to POST endpoint
- [ ] Handles all backend response codes (200, 400, 401, 404, 409, 500) gracefully
- [ ] Dashboard shows real-time logs and counters
- [ ] Exponential backoff on consecutive errors
- [ ] Offline queue stores and replays pending submissions
- [ ] Battery usage under 5% per hour when plugged in
- [ ] No wallet, deposit status, or financial state mutations anywhere in app code

---

## 15. Project Structure

```
app/
├── src/main/
│   ├── java/com/qhash/verifier/
│   │   ├── QHashVerifierApp.kt              # Application class, Hilt entry
│   │   ├── di/
│   │   │   └── AppModule.kt                 # Hilt module: Retrofit, Room, OkHttp
│   │   ├── data/
│   │   │   ├── api/
│   │   │   │   ├── QHashApiService.kt       # Retrofit interface (GET + POST)
│   │   │   │   ├── ApiKeyInterceptor.kt     # OkHttp interceptor: injects x-verifier-api-key
│   │   │   │   └── models/                  # Request/response data classes
│   │   │   ├── db/
│   │   │   │   ├── VerifierDatabase.kt      # Room database
│   │   │   │   ├── LogDao.kt               # Log entry DAO
│   │   │   │   ├── LogEntity.kt            # Log entry entity
│   │   │   │   ├── PendingSubmissionDao.kt  # Offline queue DAO
│   │   │   │   └── PendingSubmissionEntity.kt
│   │   │   ├── receipt/
│   │   │   │   ├── TeleBirrReceiptFetcher.kt  # OkHttp call to receipt_url
│   │   │   │   └── ReceiptParser.kt           # Jsoup HTML → structured data
│   │   │   └── config/
│   │   │       └── SecureConfig.kt           # EncryptedSharedPreferences wrapper
│   │   ├── service/
│   │   │   ├── VerifierForegroundService.kt  # Foreground service + poll loop
│   │   │   ├── BootReceiver.kt               # BOOT_COMPLETED → start service
│   │   │   └── ServiceRestartWorker.kt       # WorkManager fallback restart
│   │   ├── repository/
│   │   │   └── VerificationRepository.kt     # Orchestrates fetch → parse → submit
│   │   └── ui/
│   │       ├── setup/
│   │       │   └── SetupScreen.kt            # First-launch config entry
│   │       ├── dashboard/
│   │       │   ├── DashboardScreen.kt        # Main monitoring screen
│   │       │   └── DashboardViewModel.kt
│   │       └── settings/
│   │           └── SettingsScreen.kt         # Config changes
│   └── res/
│       └── ...
└── build.gradle.kts
```

---

## 16. Estimated Build Timeline

| Phase | Duration | Deliverable |
|---|---|---|
| Project setup + DI + Retrofit | 1 day | API calls working against backend |
| Receipt fetcher + Jsoup parser | 2 days | Parse sample TeleBirr receipt HTML into structured data |
| Foreground service + poll loop | 1 day | Continuous polling with backoff |
| Room DB + offline queue | 1 day | Crash-resilient queue and log storage |
| UI screens (Setup, Dashboard, Settings) | 2 days | Compose UI wired to service state |
| Boot receiver + WorkManager restart | 0.5 days | Survives reboot and task kill |
| Certificate pinning + secure storage | 0.5 days | Encrypted key storage, pinned TLS |
| Testing + on-device validation in Ethiopia | 2 days | All manual test scenarios pass |
| **Total** | **~10 days** | **Shippable MVP APK** |

---

## 17. Open Questions for Implementation

1. **TeleBirr receipt page HTML structure**: need a sample receipt page to build and test the Jsoup parser selectors. Capture the full HTML from a real receipt on the Ethiopian device before coding the parser.
2. **Amharic text in receipts**: does the receipt page render names in Amharic script, Latin script, or both? The name normalization must handle whichever is used.
3. **Receipt page rate limiting**: does `transactioninfo.ethiotelecom.et` throttle requests? If so, the per-deposit delay (currently 2s) may need to increase.
4. **Multiple verifier devices**: the current design assumes one device. If multiple devices are planned, the backend should track which device is processing which deposit to avoid duplicate work.
5. **Remote parser config**: should parsing selectors be updatable from the QHash backend (e.g. a `/api/verifier/parser-config` endpoint) or is manual update via the Settings screen sufficient for MVP?
6. **Dedicated verifier-bot profile**: the backend already finds any active admin for the `approve_deposit_tx` RPC. A dedicated bot profile (as mentioned in the design doc) would make audit trails cleaner but is not strictly required for MVP.
