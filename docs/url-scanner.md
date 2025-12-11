# URL Safety Scanner - Documentation

## Overview

The URL Safety Scanner is a multi-layer security system that analyzes URLs before browser navigation. It protects users from phishing, malware, crypto scams, and other malicious websites.

## Features

### 🛡️ Pre-Navigation Interception
- Intercepts ALL URLs before page loads
- Works on typed URLs, clicked links, and redirects
- Zero-delay for cached/trusted domains

### 🔍 Multi-Layer Scanning

| Layer | Description | Speed |
|-------|-------------|-------|
| **A - Patterns** | 80+ hardcoded malicious URL patterns | Instant |
| **B - Signatures** | 500+ known malicious domains database | Instant |
| **C - API** | Google Safe Browsing API (optional) | ~200ms |

### ⚠️ Threat Categories

- `phishing` - Fake login pages, credential theft
- `malware` - Sites distributing malware
- `crypto_scam` - Fake airdrops, wallet drainers
- `scam` - Prize scams, fake giveaways
- `ip_grabber` - Location/IP tracking sites
- `suspicious` - Unclassified suspicious content

---

## Architecture

```
browser-extension/
├── lib/
│   ├── urlPatterns.js      # Layer A: Regex patterns
│   ├── malwareSignatures.json # Layer B: Domain database
│   └── urlScanner.js       # Main scanner module
├── warnings/
│   └── malwareBlocked.html # Block warning page
└── background.js           # Navigation interception

firebase-backend/
├── functions/
│   └── urlReputation.js    # API checks, logging, alerts
└── public/app/
    └── index.html          # URL Scans dashboard section
```

---

## How It Works

1. User navigates to a URL
2. `chrome.webNavigation.onBeforeNavigate` fires
3. URL is checked against:
   - Trusted domains whitelist (skip if match)
   - Malicious patterns (Layer A)
   - Signature database (Layer B)
   - Online API (Layer C, if configured)
4. If blocked:
   - Redirect to warning page
   - Log to Firestore
   - Check alert thresholds
   - Notify parent if needed

---

## Configuration

### Enabling Google Safe Browsing API (Optional)

1. Get API key from [Google Cloud Console](https://console.cloud.google.com/apis/library/safebrowsing.googleapis.com)
2. Set secret:
   ```bash
   firebase functions:secrets:set SAFE_BROWSING_KEY
   ```
3. Deploy functions:
   ```bash
   cd firebase-backend
   firebase deploy --only functions
   ```

### Alert Thresholds

| Threshold | Action |
|-----------|--------|
| 1 attempt | Log only |
| 2 in 1 min | Email parent |
| 3 in 5 min | High-severity alert |

---

## Firestore Collections

### `url_scans/{scanId}`
```json
{
  "userId": "uid123",
  "url": "https://malicious-site.com",
  "result": "blocked",
  "risk_level": "high",
  "category": "phishing",
  "detected_by": "pattern",
  "reason": "malicious_pattern",
  "deviceId": "device123",
  "timestamp": "2024-12-10T00:00:00Z",
  "createdAt": "serverTimestamp"
}
```

---

## Adding New Signatures

### Adding Patterns (lib/urlPatterns.js)
```javascript
const MALICIOUS_PATTERNS = [
    // Add new regex patterns here
    /new-scam-pattern/i,
];
```

### Adding Domains (lib/malwareSignatures.json)
```json
{
  "phishing_domains": [
    "new-phishing-domain.com"
  ]
}
```

---

## Testing

### Test Phishing Detection
Navigate to any URL containing:
- `verify-account`
- `reset-password-now`
- `phishing`

### Test Crypto Scam Detection
Navigate to any URL containing:
- `free-crypto`
- `claim-airdrop`
- `wallet-drainer`

### Test Known Domain
Navigate to a domain in `malwareSignatures.json`:
- `grabify.link`
- `iplogger.org`

---

## Performance

- **Cache Duration**: 24 hours
- **Max Cache Size**: 500 URLs
- **Pattern Check**: < 1ms
- **Signature Check**: < 5ms
- **API Check**: ~200ms (first request)

---

## Troubleshooting

### Scanner Not Working
1. Check if extension is loaded in `chrome://extensions`
2. Open DevTools → Console for errors
3. Verify `malwareSignatures.json` loaded

### False Positives
1. User can report via warning page
2. Add domain to `TRUSTED_DOMAINS` in urlPatterns.js
3. Rebuild and update extension

### API Errors
1. Verify `SAFE_BROWSING_KEY` is set
2. Check API quota in Google Cloud Console
3. Fallback to offline scanning works automatically
