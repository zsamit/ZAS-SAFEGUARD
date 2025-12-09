# ZAS Safeguard API Documentation

## Overview

ZAS Safeguard exposes Cloud Functions as callable endpoints for all platform clients. All endpoints require Firebase Authentication unless otherwise noted.

---

## Authentication

All authenticated endpoints require a Firebase ID token in the Authorization header:

```
Authorization: Bearer <firebase_id_token>
```

---

## Endpoints

### User & Auth

#### `initializeDevice`
Registers a new device for the authenticated user.

**Request:**
```json
{
  "deviceType": "chrome" | "mac" | "windows" | "android" | "ios",
  "deviceName": "My Laptop",
  "fingerprint": "unique_device_fingerprint",
  "childId": "optional_child_id"
}
```

**Response:**
```json
{
  "success": true,
  "deviceId": "uuid-device-id",
  "message": "Device initialized successfully"
}
```

---

#### `verifyPhone`
Verify phone number for regional pricing.

**Request (send code):**
```json
{
  "phoneNumber": "+1234567890",
  "action": "send"
}
```

**Request (verify code):**
```json
{
  "phoneNumber": "+1234567890",
  "verificationCode": "123456",
  "action": "verify"
}
```

**Response:**
```json
{
  "success": true,
  "country": "US",
  "message": "Phone verified successfully"
}
```

---

### Blocking

#### `getBlockPolicy`
Get the active blocking policy for a device.

**Request:**
```json
{
  "deviceId": "device-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "policy": {
    "deviceId": "device-uuid",
    "mode": "owner" | "family",
    "ultra_strict": true,
    "blockedDomains": ["domain1.com", "domain2.com"],
    "blockedKeywords": ["keyword1", "keyword2"],
    "allowedDomains": [],
    "categories": {
      "porn": { "enabled": true, "locked": true },
      "gambling": { "enabled": true, "locked": false }
    }
  }
}
```

---

#### `logBlockEvent`
Log a blocked content event.

**Request:**
```json
{
  "deviceId": "device-uuid",
  "url": "blocked-hostname.com",
  "category": "porn",
  "action": "navigate_blocked",
  "metadata": {}
}
```

**Response:**
```json
{
  "success": true
}
```

---

#### `updateCustomBlocklist`
Add or remove domains from user's custom blocklist.

**Request:**
```json
{
  "action": "add" | "remove",
  "domain": "example.com",
  "type": "blocked" | "allowed"
}
```

---

### Override (Owner Mode Unlock)

#### `requestUnlock`
Initiate 30-minute cooldown for owner mode unlock.

**Request:**
```json
{
  "deviceId": "device-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "requestId": "request-uuid",
  "status": "cooling",
  "cooldownEndsAt": "2024-01-01T12:30:00Z",
  "cooldownMinutes": 30,
  "antiTemptationMessage": "This urge will pass. Stay strong."
}
```

---

#### `verifyUnlock`
Verify 60-character master key after cooldown.

**Request:**
```json
{
  "requestId": "request-uuid",
  "masterKey": "60+ character master key string..."
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "Unlock successful",
  "unlockedAt": "2024-01-01T12:30:00Z"
}
```

**Response (failure):**
```json
{
  "success": false,
  "message": "Invalid master key",
  "attemptsUsed": 3
}
```

---

#### `getUnlockStatus`
Check current unlock request status.

**Response:**
```json
{
  "hasActiveRequest": true,
  "requestId": "request-uuid",
  "status": "cooling" | "ready",
  "cooldownEndsAt": "2024-01-01T12:30:00Z",
  "remainingSeconds": 1500,
  "antiTemptationMessage": "You are stronger than this moment."
}
```

---

### Subscription

#### `createCheckoutSession`
Create Stripe checkout session with regional pricing.

**Request:**
```json
{
  "successUrl": "https://app.zas-safeguard.com/success",
  "cancelUrl": "https://app.zas-safeguard.com/cancel"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "cs_xxx",
  "sessionUrl": "https://checkout.stripe.com/...",
  "trialEligible": true
}
```

---

#### `checkTrialEligibility`
Check if user is eligible for 7-day free trial.

**Response:**
```json
{
  "eligible": true
}
```

or

```json
{
  "eligible": false,
  "reason": "device_used" | "phone_used" | "fraud_detected" | "card_used"
}
```

---

#### `getRegionalPrice`
Get pricing for user's verified region.

**Response:**
```json
{
  "success": true,
  "region": "ind",
  "currency": "INR",
  "amount": 5000,
  "fraudScore": 0
}
```

---

### Fraud Detection

#### `calculateFraudScore`
Calculate 5-layer fraud score for pricing.

**Request:**
```json
{
  "ipAddress": "1.2.3.4",
  "appStoreRegion": "US"
}
```

**Response:**
```json
{
  "success": true,
  "score": 2,
  "pricingTier": "usa",
  "signals": {
    "sim_country": "IN",
    "payment_country": "US",
    "ip_country": "US",
    "sim_verified": true,
    "payment_mismatch": true
  },
  "mismatches": ["sim_payment"]
}
```

---

#### `checkDeviceFingerprint`
Check device fingerprint for trial abuse.

**Request:**
```json
{
  "fingerprint": "device-fingerprint-hash"
}
```

**Response:**
```json
{
  "isNew": false,
  "trialUsed": true,
  "fraudFlags": ["multi_user_device"],
  "message": "Trial already used on this device"
}
```

---

### AI Classification

#### `classifyContent`
Classify content for adult/harmful material.

**Request:**
```json
{
  "url": "https://example.com",
  "title": "Page Title",
  "content": "First 500 chars of page content..."
}
```

**Response:**
```json
{
  "success": true,
  "classification": {
    "isAdult": true,
    "isGambling": false,
    "categories": ["adult"],
    "confidence": 0.95
  },
  "method": "ai" | "keyword"
}
```

---

#### `generateRiskScore`
Generate behavioral risk score for user.

**Request:**
```json
{
  "timeframe": "day" | "week" | "month"
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "totalBlocks": 42,
    "byCategory": { "adult": 35, "gambling": 7 },
    "byHour": [0, 0, 1, 2, ...],
    "peakHours": [23, 0, 1],
    "riskFactors": ["Late-night activity", "Multiple adult attempts"],
    "score": 7,
    "riskLevel": "high"
  }
}
```

---

#### `generateWeeklyReport`
Generate weekly report for parent (child monitoring).

**Request:**
```json
{
  "childId": "child-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "report": {
    "childName": "John",
    "periodStart": "2024-01-01T00:00:00Z",
    "periodEnd": "2024-01-07T00:00:00Z",
    "summary": {
      "totalBlocks": 15,
      "totalTamperAttempts": 0,
      "categoriesBlocked": { "gambling": 10, "social_media": 5 }
    },
    "highlights": ["👍 Very few blocked content attempts"],
    "recommendations": [],
    "aiSummary": "John had a good week..."
  }
}
```

---

## Webhooks

### Stripe Webhook
**Endpoint:** `POST /stripeWebhook`

Handles the following Stripe events:
- `checkout.session.completed`
- `customer.subscription.trial_will_end`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

---

## Error Codes

| Code | Description |
|------|-------------|
| `unauthenticated` | No valid Firebase token |
| `permission-denied` | User lacks permission |
| `not-found` | Resource not found |
| `resource-exhausted` | Quota exceeded (e.g., max devices) |
| `failed-precondition` | Service not configured |
| `internal` | Server error |
