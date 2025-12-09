# 🛡️ ZAS Safeguard

**Production-grade, cross-platform digital blocking system for protecting users from harmful content.**

[![License](https://img.shields.io/badge/license-Proprietary-red.svg)]()
[![Firebase](https://img.shields.io/badge/backend-Firebase-orange.svg)]()
[![Platforms](https://img.shields.io/badge/platforms-Chrome%20%7C%20macOS%20%7C%20Windows%20%7C%20Android%20%7C%20iOS-blue.svg)]()

---

## 🌟 Features

### Two Operating Modes

**🔒 Owner Mode (Ultra-Strict)**
- Permanent porn/adult block (cannot be disabled)
- No toggle/disable/uninstall options
- 30-minute cooldown + 60-char master key for unlock
- Cross-device unlock sync
- Fail-safe blocking when offline

**👨‍👩‍👧 Family Mode (Parental Control)**
- Parent portal with child profiles
- Customizable block categories
- Schedule-based blocking
- Homework mode
- Attempt logging & alerts

### Platform Support

| Platform | Technology | Features |
|----------|------------|----------|
| Chrome/Edge | Manifest V3 Extension | URL blocking, tamper detection, offline fallback |
| macOS | System Extension | DNS proxy, content filter, hosts lock |
| Windows | Windows Service | DNS interception, hosts protection, process guard |
| Android | Kotlin App | Accessibility blocking, overlay warnings |
| iOS | Swift App | ScreenTime API, DNS filter |

### Subscription System

- **Regional Pricing**: USA/EU $5, AFG 150 AFN, PAK 300 PKR, IN ₹50, EGY 30 EGP, BD 70 BDT
- **7-Day Free Trial** with anti-abuse protection
- **5-Layer Anti-VPN Detection**: SIM, payment, app store, IP, VPN detection

---

## 📁 Project Structure

```
zas-safeguard/
├── browser-extension/     # Chrome/Edge Manifest V3 extension
├── firebase-backend/      # Firebase Cloud Functions & Firestore
├── macos-blocker/        # macOS system extension
├── windows-blocker/      # Windows service
├── android-app/          # Android Kotlin app
├── ios-app/              # iOS Swift app
├── shared/               # Shared blocklists
└── docs/                 # Documentation
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Firebase CLI
- Platform-specific SDKs (Xcode, Android Studio, Visual Studio)

### 1. Clone & Setup Firebase

```bash
# Install Firebase CLI
npm install -g firebase-tools
firebase login

# Create project
firebase projects:create zas-safeguard

# Initialize backend
cd firebase-backend
firebase deploy --only firestore:rules,firestore:indexes

# Initialize collections
cd scripts && node init-collections.js

# Deploy functions
cd ../functions && npm install && firebase deploy --only functions
```

### 2. Configure Extension

```bash
cd browser-extension
# Edit lib/firebase-config.js with your project settings
```

### 3. Load in Chrome

1. Go to `chrome://extensions`
2. Enable Developer Mode
3. Load unpacked → Select `browser-extension` folder

---

## 🔧 Configuration

### Environment Secrets

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set OPENAI_API_KEY
```

### Firestore Collections

- `/users` - User profiles
- `/devices` - Registered devices
- `/blocklists/global` - Global domain blocklist
- `/block_policies` - Category configurations
- `/override_requests` - Unlock requests
- `/subscriptions` - Subscription data
- `/fraud_scores` - Fraud detection data
- `/region_pricing` - Regional price tiers

---

## 📖 Documentation

- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

---

## 🔐 Security

- All sensitive data encrypted at rest
- Firebase security rules enforce access control
- Master keys stored as SHA-256 hashes
- Tamper detection on all platforms
- Process protection on desktop

---

## 📄 License

Proprietary - ZAS Global LLC. All rights reserved.
