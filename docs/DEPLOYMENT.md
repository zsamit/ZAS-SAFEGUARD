# ZAS Safeguard - Deployment Guide

## Prerequisites

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- Apple Developer Program membership (for macOS/iOS)
- Google Play Developer account (for Android)
- Stripe account

---

## 1. Firebase Project Setup

### Create New Project

```bash
# Login to Firebase
firebase login

# Create new project
firebase projects:create zas-safeguard-prod

# Use the project
firebase use zas-safeguard-prod
```

### Enable Required Services

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** → Sign-in methods: Email/Password, Google
3. Enable **Firestore Database** → Start in production mode
4. Enable **Cloud Functions** (requires Blaze plan)

---

## 2. Configure Secrets

```bash
# Stripe keys
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET

# Twilio (SMS verification)
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_VERIFY_SERVICE_SID

# OpenAI (AI classification)
firebase functions:secrets:set OPENAI_API_KEY
```

---

## 3. Deploy Firestore

### Deploy Security Rules & Indexes

```bash
cd firebase-backend
firebase deploy --only firestore:rules,firestore:indexes
```

### Initialize Collections

```bash
# Set up service account
export GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccount.json"

# Run init script
cd scripts
npm install firebase-admin
node init-collections.js
```

---

## 4. Deploy Cloud Functions

```bash
cd firebase-backend/functions

# Install dependencies
npm install

# Deploy functions
firebase deploy --only functions
```

### Verify Deployment

```bash
firebase functions:list
```

---

## 5. Chrome Extension

### Development

```bash
cd browser-extension

# Update firebase-config.js with your project settings
vim lib/firebase-config.js
```

### Build & Test

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `browser-extension` folder

### Publish to Chrome Web Store

1. Create ZIP of extension folder
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Create new item → Upload ZIP
4. Fill in store listing
5. Submit for review

---

## 6. macOS Blocker

### Requirements

- Xcode 14+
- Apple Developer Program membership
- Network Extension entitlement

### Build

```bash
cd macos-blocker
open ZASSafeguard.xcodeproj
```

### Signing & Capabilities

1. Select project in Xcode
2. Add capabilities:
   - Network Extensions (DNS Proxy, Content Filter)
   - App Groups
   - System Extension
3. Configure signing with Developer ID

### Notarization

```bash
xcrun notarytool submit ZASSafeguard.app --apple-id YOUR_APPLE_ID --password YOUR_APP_PASSWORD --team-id YOUR_TEAM_ID
```

### Distribution

Create DMG or PKG installer for distribution.

---

## 7. Windows Blocker

### Requirements

- Visual Studio 2022
- .NET 6+

### Build

```bash
cd windows-blocker
dotnet build -c Release
```

### Create Windows Service

```bash
# Install service
sc create ZASSafeguard binPath="C:\path\to\ZASSafeguardService.exe"
sc config ZASSafeguard start=auto
sc start ZASSafeguard
```

### Installer

Use WiX or Inno Setup to create installer:
- Include service registration
- Add firewall rules
- Register startup

---

## 8. Android App

### Requirements

- Android Studio
- JDK 17

### Build

```bash
cd android-app
./gradlew assembleRelease
```

### Sign APK

```bash
jarsigner -keystore your-key.keystore app-release-unsigned.apk your-alias
zipalign -v 4 app-release-unsigned.apk app-release.apk
```

### Publish to Play Store

1. Go to [Google Play Console](https://play.google.com/console)
2. Create new app
3. Upload APK
4. Fill store listing
5. Submit for review

---

## 9. iOS App

### Requirements

- Xcode 15+
- Apple Developer Program

### Build

```bash
cd ios-app
open ZASSafeguard.xcodeproj
```

### Capabilities

Add required capabilities:
- Family Controls
- Content Filter Provider
- Network Extensions
- App Groups
- Background Modes

### Archive & Submit

1. Product → Archive
2. Distribute App → App Store Connect
3. Upload to App Store

---

## 10. Stripe Setup

### Create Products

```bash
# Create monthly subscription product for each region
stripe products create --name="ZAS Safeguard Monthly (USA)"
stripe prices create \
  --product=prod_xxx \
  --unit-amount=500 \
  --currency=usd \
  --recurring='{"interval":"month"}'
```

### Configure Webhook

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://us-central1-YOUR_PROJECT.cloudfunctions.net/stripeWebhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.trial_will_end`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy signing secret to Firebase secrets

---

## 11. Environment Variables

### Firebase Functions

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service |
| `OPENAI_API_KEY` | OpenAI API key |

### Chrome Extension

Update `lib/firebase-config.js`:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const FUNCTIONS_URL = "https://us-central1-your-project.cloudfunctions.net";
```

---

## 12. Testing

### Firebase Emulators

```bash
cd firebase-backend
firebase emulators:start
```

### Test Extension

1. Load extension in Chrome
2. Navigate to blocked site
3. Verify block page appears
4. Check console for logs

### Test Cloud Functions

```bash
# In emulator
curl -X POST http://localhost:5001/PROJECT_ID/us-central1/getBlockPolicy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TEST_TOKEN" \
  -d '{"deviceId": "test-device"}'
```

---

## Monitoring

### Firebase Console

- Functions → Logs
- Firestore → Data usage
- Authentication → Users

### Stripe Dashboard

- Payments → Monitor transactions
- Webhooks → Check delivery status

---

## Troubleshooting

### Functions not deploying

```bash
# Check Node version
node --version  # Should be 18+

# Clear function cache
rm -rf functions/node_modules
npm install
```

### Extension not blocking

1. Check extension is enabled
2. Verify blocklist synced (check storage)
3. Check console for errors
4. Verify Firebase auth token valid

### Service won't start (Windows)

1. Run as Administrator
2. Check Event Viewer for errors
3. Verify .NET runtime installed
