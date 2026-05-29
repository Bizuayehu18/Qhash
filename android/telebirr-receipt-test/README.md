# TeleBirr Receipt Test — Android App

Minimal Android app for testing TeleBirr receipt URL fetching and parsing from inside Ethiopia.

## Why Android (not web)?

TeleBirr's receipt endpoint (`transactioninfo.ethiotelecom.et`) is **geo-blocked outside Ethiopia**.
Netlify servers (and any cloud proxy) cannot reach it. The fetch must happen from a device on an
Ethiopian network — hence this Android app.

## What it does

- One text input for a TeleBirr receipt URL
- **Fetch** button that uses the phone's own network (OkHttp) to load the receipt page
- Displays the HTTP status code (color-coded)
- Shows a collapsible raw HTML response preview
- Parses and displays: **Transaction ID**, **Amount**, **Receiver Name**, **Status**
- Maintains a session log of all fetches with copy/export/clear controls

## What it does NOT do

- No backend calls, no polling, no approval logic
- No wallet or deposit changes
- No QHash backend modifications
- This is a standalone test/debug tool only

## Requirements

- Android Studio Ladybug (2024.2.1) or newer
- JDK 17
- Android SDK with API 35 (compileSdk) and API 26 (minSdk)
- A physical Android device on an Ethiopian network for actual TeleBirr testing

## Build

### From Android Studio

1. Open `android/telebirr-receipt-test/` as a project in Android Studio
2. Let Gradle sync complete
3. Select your device or emulator
4. Click **Run** (▶)

### From command line

```bash
cd android/telebirr-receipt-test

# Debug APK
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk

# Release APK (unsigned — for testing only)
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release-unsigned.apk
```

> On first run, Gradle will download dependencies (~500 MB). This is normal.

## Install on phone

### Via Android Studio
Connect your phone via USB with **USB debugging** enabled, then click Run.

### Via ADB (command line)

```bash
# Connect phone via USB with USB debugging enabled
adb install app/build/outputs/apk/debug/app-debug.apk
```

### Via file transfer
1. Copy the `.apk` file to the phone (USB, Telegram, email, etc.)
2. Open it on the phone
3. Allow "Install from unknown sources" if prompted
4. Tap Install

## Enable USB Debugging

1. Go to **Settings → About Phone**
2. Tap **Build Number** 7 times to enable Developer Options
3. Go to **Settings → Developer Options**
4. Enable **USB Debugging**
5. Connect via USB and accept the computer's fingerprint

## Usage

1. Open the app on a phone connected to an Ethiopian mobile network or Wi-Fi
2. Enter a TeleBirr receipt URL (e.g., `https://transactioninfo.ethiotelecom.et/receipt/FT24XXXXXXXXX`)
3. Tap **Fetch Receipt**
4. Check the HTTP status, parsed fields, and raw response
5. Use **Export** or **Copy** to share the log for debugging

## Tech stack

| Component | Library |
|---|---|
| Language | Kotlin |
| UI | Jetpack Compose + Material 3 |
| Networking | OkHttp 4 |
| HTML Parsing | Jsoup |
| Min SDK | API 26 (Android 8.0) |
