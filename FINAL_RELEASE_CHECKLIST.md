# ZAS SAFEGUARD — FINAL RELEASE CHECKLIST

**Version:** 1.1.0  
**Target:** Chrome Web Store Publish  
**Date:** 2025-12-26

---

## ⚠️ RELEASE GATES (All must be ✅ to publish)

| Gate | Status | Proof |
|------|--------|-------|
| All features tested | ⬜ | |
| Zero critical bugs | ⬜ | |
| Firebase rules verified | ⬜ | |
| No email spam on restart | ⬜ | |
| Adult blocking ON by default | ⬜ | |
| CEO smoke test passed | ⬜ | |

---

## 📦 EXTENSION CORE FEATURES

### 1. Installation & Onboarding
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Fresh install completes | ⬜ | Install from unpacked | |
| Device ID generated | ⬜ | Check chrome.storage.local | |
| Default blocklist loaded | ⬜ | Verify block_rules.json active | |
| TOS agreement flow | ⬜ | External message handler works | |
| Service worker stable | ⬜ | No crash on install | |

### 2. Adult Content Blocking (CRITICAL)
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Adult sites blocked by DEFAULT | ⬜ | Visit pornhub.com → blocked | |
| Redirect to blocked.html | ⬜ | Custom blocked page shown | |
| Cannot be disabled | ⬜ | No toggle for adult blocking | |
| Works in incognito | ⬜ | Test incognito mode | |
| Works after browser restart | ⬜ | Close/reopen Chrome | |
| Offline fallback works | ⬜ | Disable network → still blocks | |

### 3. Ad Blocker
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Ads blocked (Forbes test) | ⬜ | Visit forbes.com | |
| Trackers blocked | ⬜ | Check Network tab | |
| Stats counter increments | ⬜ | Popup shows blocked count | |
| Per-site mode (Smart/Balanced/Strict) | ⬜ | Toggle in dashboard works | |
| Allowlist per site | ⬜ | Add site to allowlist | |
| No breakage on YouTube | ⬜ | Video loads properly | |
| No breakage on Gmail | ⬜ | Email loads properly | |

### 4. Study Mode
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Start study session | ⬜ | Dashboard → Start Session | |
| Social media blocked | ⬜ | Visit facebook.com → blocked | |
| Entertainment blocked | ⬜ | Visit youtube.com → blocked | |
| Timer countdown works | ⬜ | Session ends at correct time | |
| Manual stop works | ⬜ | Stop button ends session | |
| Extension receives command | ⬜ | external message received | |

### 5. URL/QR Scanner
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Manual URL scan | ⬜ | Scan known malware URL | |
| QR scan in popup | ⬜ | Not implemented? Check | |
| Safe result shows green | ⬜ | Scan google.com | |
| Dangerous result shows red | ⬜ | Scan test malware URL | |
| API call to checkUrlReputation | ⬜ | Check network/logs | |

### 6. Popup Interface
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Popup opens without error | ⬜ | Click extension icon | |
| Stats display correctly | ⬜ | Blocked Today / Total | |
| Study Mode toggle works | ⬜ | Toggle on/off | |
| Dashboard button works | ⬜ | Opens dashboard URL | |
| Sync button works | ⬜ | Triggers sync | |
| Theme toggle works | ⬜ | Dark/light mode | |
| Logo displays correctly | ⬜ | Wordmark visible | |

---

## 🌐 WEB DASHBOARD FEATURES

### 7. Authentication
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Login with Google | ⬜ | Firebase Auth | |
| Login with Email | ⬜ | Email/password | |
| Logout works | ⬜ | Clear session | |
| Extension receives auth state | ⬜ | USER_AUTH message | |
| Redirect to login if unauthenticated | ⬜ | Protected routes | |

### 8. Dashboard Overview
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Stats cards display | ⬜ | Blocked today, threats, etc. | |
| Charts render | ⬜ | 7-day trend | |
| Device list shows | ⬜ | Connected devices | |
| Protection status accurate | ⬜ | Reflects extension state | |

### 9. Devices Page
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| List connected devices | ⬜ | Show all devices | |
| Device heartbeat status | ⬜ | Last seen time | |
| Lock device (Child Lock) | ⬜ | Send lock command | |
| Unlock device | ⬜ | Send unlock command | |
| Extension receives lock command | ⬜ | CHILD_LOCK message | |

### 10. Protection Page
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Category toggles work | ⬜ | Gambling, violence, etc. | |
| Custom block domains | ⬜ | Add custom domain | |
| Custom allow domains | ⬜ | Add whitelist | |
| Changes sync to extension | ⬜ | CATEGORY_TOGGLE message | |

### 11. Ad Blocker Page
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Stats display | ⬜ | Ads/Trackers blocked | |
| Global toggle | ⬜ | Enable/disable | |
| Per-category toggles | ⬜ | Ads, Trackers, Malware, Annoyances | |
| Site-specific mode | ⬜ | Set per-site mode | |
| Sync to extension | ⬜ | ADBLOCK_SET_CATEGORY | |

### 12. Scanner Page
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| URL input works | ⬜ | Enter URL | |
| Scan button works | ⬜ | Trigger scan | |
| Results display | ⬜ | Safe/Suspicious/Dangerous | |
| Recent scans list | ⬜ | History shows | |

### 13. Alerts Page
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Alerts list loads | ⬜ | Show recent alerts | |
| Mark as read works | ⬜ | Clear notification | |
| Filter by type | ⬜ | If implemented | |

### 14. Family Page
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Add child profile | ⬜ | Create profile | |
| Edit child profile | ⬜ | Update settings | |
| Delete child profile | ⬜ | Remove profile | |
| Schedule blocks | ⬜ | Set time limits | |
| Parent PIN works | ⬜ | Protect settings | |

### 15. Settings Page  
| Feature | Status | Test Steps | Proof |
|---------|--------|------------|-------|
| Profile info displays | ⬜ | Name, email, avatar | |
| Subscription status | ⬜ | Free/Trial/Pro/Pro Yearly | |
| Notification settings | ⬜ | Email toggles | |
| Data export | ⬜ | If implemented | |
| Account delete | ⬜ | If implemented | |

---

## ☁️ CLOUD FUNCTIONS

### 16. Alert Functions
| Function | Status | Test Steps | Proof |
|----------|--------|------------|-------|
| onSecurityEvent | ⬜ | Firestore trigger works | |
| checkHeartbeats | ⬜ | Scheduled job runs | |
| logSecurityEvent | ⬜ | Creates alert doc | |
| getAlerts | ⬜ | Returns user alerts | |
| markAlertRead | ⬜ | Updates read status | |

### 17. Subscription Functions
| Function | Status | Test Steps | Proof |
|----------|--------|------------|-------|
| createCheckoutSession | ⬜ | Stripe session created | |
| stripeWebhook | ⬜ | Handles payment events | |
| checkTrialEligibility | ⬜ | Returns eligibility | |
| getRegionalPrice | ⬜ | Returns correct price | |
| handleTrialEnd | ⬜ | Ends trial correctly | |

### 18. Blocking Functions
| Function | Status | Test Steps | Proof |
|----------|--------|------------|-------|
| getBlockPolicy | ⬜ | Returns policy | |
| syncBlocklist | ⬜ | Updates blocklist | |
| logBlockEvent | ⬜ | Creates log entry | |

### 19. Other Functions
| Function | Status | Test Steps | Proof |
|----------|--------|------------|-------|
| checkUrlReputation | ⬜ | Returns safety score | |
| checkHeartbeats (heartbeat.js) | ⬜ | No spam on browser restart | |
| cleanupOldLogsV2 | ⬜ | Cleans old entries | |

---

## 🔒 FIRESTORE SECURITY RULES

| Rule | Status | Test Steps | Proof |
|------|--------|------------|-------|
| Users can only read own data | ⬜ | Try reading other user | |
| Users cannot write to blocklists | ⬜ | Try writing to /blocklists | |
| Alerts created by functions only | ⬜ | Try client-side write | |
| Admin-only collections protected | ⬜ | Try writing to /region_pricing | |

---

## 🧪 TEST MODES

### Browser States
| State | Status | Notes |
|-------|--------|-------|
| Fresh install | ⬜ | |
| Browser restart | ⬜ | |
| Incognito mode | ⬜ | |
| Device shutdown/restart | ⬜ | |

### Network States
| State | Status | Notes |
|-------|--------|-------|
| Online | ⬜ | |
| Offline | ⬜ | |
| Firebase unavailable | ⬜ | |

### Account States
| State | Status | Notes |
|-------|--------|-------|
| Free (no account) | ⬜ | |
| Trial active | ⬜ | |
| Trial expired | ⬜ | |
| Pro Monthly | ⬜ | |
| Pro Yearly | ⬜ | |

---

## 🚨 ZERO-TOLERANCE BUGS (Auto-Reject)

| Bug Type | Check | Status |
|----------|-------|--------|
| Infinite reload loop | Test on all pages | ⬜ |
| Service worker crash | Check console | ⬜ |
| Heartbeat email spam | Restart browser 3x | ⬜ |
| Blocker disabled silently | Check after restart | ⬜ |
| Adult content accessible | Visit adult site | ⬜ |
| Ad blocker breaks Gmail | Test Gmail | ⬜ |
| Pro features without Pro | Check gating | ⬜ |
| Firestore permission error | Check console | ⬜ |
| Dead UI buttons | Click everything | ⬜ |

---

## ✅ FINAL APPROVAL

### Developer Confirmation
```
I confirm this build is production-ready and safe to publish.

Signed: _______________
Date: _______________
```

### CEO Smoke Test
| Step | Status |
|------|--------|
| Install extension | ⬜ |
| Open adult site → blocked | ⬜ |
| Toggle a setting on dashboard | ⬜ |
| Verify extension reflects change | ⬜ |
| Close/reopen browser | ⬜ |
| Check NO email spam | ⬜ |

**CEO APPROVAL:** ⬜ APPROVED / ⬜ REJECTED

---

## 📝 KNOWN LIMITATIONS

1. _[Document any known limitations here]_

---

## 🚀 PUBLISH STEPS (After Approval Only)

1. [ ] Increment version in manifest.json
2. [ ] Git tag: `release-v1.1.0`
3. [ ] Create .zip of browser-extension/
4. [ ] Upload to Chrome Web Store
5. [ ] Submit for review
