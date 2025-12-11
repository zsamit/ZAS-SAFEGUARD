# Stripe Pricing Setup Guide for ZAS Safeguard

## Step 1: Create Products in Stripe Dashboard

Go to: https://dashboard.stripe.com/products

### Product 1: Family Plan
1. Click **"+ Add product"**
2. **Name**: ZAS Safeguard Family
3. **Description**: Basic family protection with content blocking and Study Mode
4. **Pricing**:
   - Click "Add a price"
   - Price: `$2.99`
   - Billing period: `Monthly`
   - Save

### Product 2: Pro Plan
1. Click **"+ Add product"**
2. **Name**: ZAS Safeguard Pro
3. **Description**: Advanced protection with URL Scanner and AI Content Analysis
4. **Pricing**:
   - Click "Add a price"
   - Price: `$5.99`
   - Billing period: `Monthly`
   - Save

### Product 3: Pro Yearly
1. Click **"+ Add product"**
2. **Name**: ZAS Safeguard Pro Yearly
3. **Description**: Pro plan with 2 months free, VIP support, and early access
4. **Pricing**:
   - Click "Add a price"
   - Price: `$49.99`
   - Billing period: `Yearly`
   - Save

---

## Step 2: Get Price IDs

After creating each price, click on it to see the **Price ID**.

It looks like: `price_1O2kXXXXXXXXXXXX`

Copy all three Price IDs.

---

## Step 3: Update Firestore Pricing Config

Update `region_pricing/USD` in Firestore with:

```json
{
  "currency": "USD",
  "plans": {
    "family_monthly": {
      "price": 2.99,
      "stripePriceId": "price_YOUR_FAMILY_MONTHLY_ID",
      "name": "Family",
      "features": ["Content blocking", "Parent dashboard", "Email alerts", "Study Mode", "3 devices", "Quotes"]
    },
    "pro_monthly": {
      "price": 5.99,
      "stripePriceId": "price_YOUR_PRO_MONTHLY_ID",
      "name": "Pro",
      "features": ["Everything in Family", "URL Safety Scanner", "AI Content Analysis", "Google Safe Browsing", "Unlimited devices", "Priority support"]
    },
    "pro_yearly": {
      "price": 49.99,
      "stripePriceId": "price_YOUR_PRO_YEARLY_ID",
      "name": "Pro Yearly",
      "features": ["Everything in Pro", "2 months FREE", "VIP support", "Early access", "Custom quotes", "API access"]
    }
  }
}
```

---

## Step 4: Stripe Settings to Enable

### Enable Automatic Tax Collection
1. Go to: https://dashboard.stripe.com/settings/tax
2. Click **"Activate Stripe Tax"**
3. Set your business address
4. Toggle **"Calculate and collect tax automatically"**

### Enable Customer Billing Portal
1. Go to: https://dashboard.stripe.com/settings/billing/portal
2. Enable **"Customer portal"**
3. Allow customers to:
   - ✅ Update payment methods
   - ✅ View invoices
   - ✅ Cancel subscription

### Enable Trial Period
When creating prices, click **"Free trial"** and set to 7 days.

Or in code when creating checkout session:
```javascript
subscription_data: {
  trial_period_days: 7,
}
```

---

## Step 5: Webhook (Already Set Up)

Your webhook endpoint should already be:
`https://us-central1-zas-safeguard.cloudfunctions.net/stripeWebhook`

Make sure these events are enabled:
- ✅ `checkout.session.completed`
- ✅ `customer.subscription.created`
- ✅ `customer.subscription.updated`
- ✅ `customer.subscription.deleted`
- ✅ `invoice.paid`
- ✅ `invoice.payment_failed`

---

## Data Responsibility Clarification

### Who Holds the Data?
- **Firebase/Google Cloud**: Stores all user data in their data centers
- **ZAS Safeguard (You)**: Acts as the data controller
- **Google**: Acts as the data processor

### Legal Responsibility
1. **GDPR**: You are responsible for having a privacy policy and data processing agreement
2. **Data Security**: Google handles encryption, security patches, and infrastructure
3. **User Requests**: You must handle data deletion requests (GDPR Article 17)
4. **Firebase Terms**: Google's terms cover their infrastructure security

### What Google Guarantees
- AES-256 encryption at rest
- TLS 1.3 encryption in transit
- SOC 1, SOC 2, SOC 3 compliance
- ISO 27001, ISO 27017 certifications
- GDPR Data Processing Agreement (DPA)

---

## GPT Model Update

The cheapest OpenAI model is **GPT-4o-mini** (not GPT-5 nano - that doesn't exist).

### Pricing (as of Dec 2024):
- **Input**: $0.15 per 1M tokens
- **Output**: $0.60 per 1M tokens
- **Very affordable** - ~$0.0001 per typical request

### Update your code to use:
```javascript
model: "gpt-4o-mini"
```

This is the best value for content analysis - fast, cheap, and capable.
