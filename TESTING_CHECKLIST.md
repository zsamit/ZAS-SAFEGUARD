# ZAS Safeguard - Testing Checklist

**Instructions:** Test each item and mark with ✅ (pass) or ❌ (fail). Add notes if needed.

---

## 1. EXTENSION SETUP

### 1.1 Reload Extension
1. Go to `chrome://extensions`
2. Find "ZAS Safeguard"
3. Click the reload button (circular arrow)
4. Result: [ ] PASS / [ ] FAIL

---

## 2. AUTHENTICATION

### 2.1 Create Account (Email/Password)
1. Go to https://zassafeguard.com/login
2. Click "Sign up" at the bottom
3. Enter a NEW email and password (6+ chars)
4. Click "Create Account"
5. Expected: Redirects to dashboard
6. Result: [ ] PASS / [ ] FAIL
7. Console logs to check: `[Auth] Account created successfully`

### 2.2 Logout
1. From dashboard, go to Settings
2. Click "Log Out" button
3. Expected: Redirects to landing page
4. Result: [ ] PASS / [ ] FAIL

### 2.3 Login (Email/Password)
1. Go to https://zassafeguard.com/login
2. Enter the email/password you just created
3. Click "Sign In"
4. Expected: Redirects to dashboard
5. Result: [ ] PASS / [ ] FAIL

### 2.4 Protected Routes
1. Log out first
2. Try to go directly to https://zassafeguard.com/app/dashboard
3. Expected: Redirects to /login
4. Result: [ ] PASS / [ ] FAIL

### 2.5 Google Sign-In (Optional)
1. Go to https://zassafeguard.com/login
2. Click "Continue with Google"
3. Expected: Redirects to Google, then back to dashboard
4. Result: [ ] PASS / [ ] FAIL / [ ] SKIP
5. Notes: _____________________

---

## 3. DASHBOARD PAGES

### 3.1 Overview Page
1. Go to https://zassafeguard.com/app/dashboard
2. Check if page loads without errors
3. Result: [ ] PASS / [ ] FAIL

### 3.2 Devices Page
1. Go to https://zassafeguard.com/app/devices
2. Check if page loads without errors
3. Result: [ ] PASS / [ ] FAIL

### 3.3 Protection Page
1. Go to https://zassafeguard.com/app/protection
2. Check if page loads without errors
3. Result: [ ] PASS / [ ] FAIL

### 3.4 Ad Blocker Page
1. Go to https://zassafeguard.com/app/adblock
2. Check if page loads without errors
3. Result: [ ] PASS / [ ] FAIL

### 3.5 Scanner Page
1. Go to https://zassafeguard.com/app/scanner
2. Check if page loads without errors
3. Result: [ ] PASS / [ ] FAIL

### 3.6 Alerts Page
1. Go to https://zassafeguard.com/app/alerts
2. Check if page loads without errors
3. Result: [ ] PASS / [ ] FAIL

### 3.7 Family Page
1. Go to https://zassafeguard.com/app/family
2. Check if page loads without errors
3. Result: [ ] PASS / [ ] FAIL

### 3.8 Settings Page
1. Go to https://zassafeguard.com/app/settings
2. Check if page loads without errors
3. Check if your email shows correctly
4. Result: [ ] PASS / [ ] FAIL

---

## 4. EXTENSION FEATURES

### 4.1 Extension Popup
1. Click the ZAS Safeguard extension icon in toolbar
2. Check if popup opens
3. Check if it shows protection status
4. Result: [ ] PASS / [ ] FAIL

### 4.2 Adult Content Blocking
1. Try visiting a known adult site (e.g., pornhub.com)
2. Expected: Shows blocked page
3. Result: [ ] PASS / [ ] FAIL

### 4.3 Ad Blocking
1. Visit https://www.forbes.com
2. Open DevTools Console (F12)
3. Look for: `[ZAS AdBlock] Cosmetic: Injected X selectors`
4. Result: [ ] PASS / [ ] FAIL

### 4.4 Malware Warning
1. Visit https://testsafebrowsing.appspot.com/s/malware.html
2. Expected: Shows warning page
3. Result: [ ] PASS / [ ] FAIL / [ ] SKIP

---

## 5. SETTINGS FEATURES

### 5.1 Manage Subscription
1. Go to Settings page
2. Click "Manage Subscription"
3. Expected: Opens Stripe portal OR shows error for free users
4. Result: [ ] PASS / [ ] FAIL
5. Error message (if any): _____________________

### 5.2 View Invoices
1. Go to Settings page
2. Click "View Invoices"
3. Expected: Shows invoices OR "No invoices" message
4. Result: [ ] PASS / [ ] FAIL
5. Error message (if any): _____________________

### 5.3 Delete Account
1. Go to Settings page
2. Type "DELETE" in the confirmation box
3. Click "Delete Account"
4. Expected: Account deleted, redirects to landing page
5. Result: [ ] PASS / [ ] FAIL
6. Console logs to check: `[deleteAccount] Auth user deleted`

---

## 6. SUBSCRIPTION (if you have lifetime/pro)

### 6.1 Subscription Display
1. Go to Settings page
2. Check what subscription plan shows
3. Expected: "Lifetime" or your actual plan
4. Actual: _____________________
5. Result: [ ] PASS / [ ] FAIL

---

## SUMMARY

| Category | Pass | Fail | Notes |
|----------|------|------|-------|
| Extension Setup | | | |
| Authentication | | | |
| Dashboard Pages | | | |
| Extension Features | | | |
| Settings Features | | | |
| Subscription | | | |

**Total Passed:** ___
**Total Failed:** ___

**Critical Failures:**
1. 
2. 
3. 

---

*Test Date: 2026-01-01*
*Tester: _____________________*
