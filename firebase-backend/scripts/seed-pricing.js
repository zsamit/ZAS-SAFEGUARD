/**
 * Seed USD Pricing to Firestore
 * Run: node seed-pricing.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('../../zas-safeguard-firebase-adminsdk-fbsvc-d98a6b03b0.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ========================================
// STRIPE PRICE IDs (LIVE)
// ========================================
const PRICE_IDS = {
    essential_monthly: 'price_1ScyPxRwbGN3ywzECJ4pUUfb',
    essential_yearly: 'price_1ScyTTRwbGN3ywzEUcBYIFac',
    pro_monthly: 'price_1ScyQWRwbGN3ywzEIMiBTyOm',
    pro_yearly: 'price_1ScyUPRwbGN3ywzEzggOzjK3'
};
// ========================================

async function seedPricing() {
    console.log('Seeding USD pricing...\\n');

    await db.collection('region_pricing').doc('USD').set({
        currency: 'USD',
        plans: {
            essential_monthly: {
                name: 'Essential',
                price: 2.99,
                interval: 'month',
                stripePriceId: PRICE_IDS.essential_monthly,
                features: [
                    'Adult content blocking',
                    'Custom blocklists',
                    'Study Mode',
                    'Dashboard access',
                    '3 devices',
                    'Motivational quotes'
                ]
            },
            essential_yearly: {
                name: 'Essential Yearly',
                price: 29.99,
                interval: 'year',
                stripePriceId: PRICE_IDS.essential_yearly,
                features: [
                    'All Essential features',
                    '2 months FREE',
                    'Billed annually'
                ]
            },
            pro_monthly: {
                name: 'Pro',
                price: 5.99,
                interval: 'month',
                stripePriceId: PRICE_IDS.pro_monthly,
                features: [
                    'Everything in Essential',
                    'URL Safety Scanner',
                    'AI Content Analysis',
                    'Phishing/Malware Blocking',
                    'Google Safe Browsing API',
                    'Unlimited devices',
                    'Priority support'
                ]
            },
            pro_yearly: {
                name: 'Pro Yearly',
                price: 59.99,
                interval: 'year',
                stripePriceId: PRICE_IDS.pro_yearly,
                features: [
                    'All Pro features',
                    '2 months FREE',
                    'VIP support',
                    'Early access to features'
                ]
            }
        },
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Essential Monthly: $2.99/mo');
    console.log('✅ Essential Yearly: $29.99/yr');
    console.log('✅ Pro Monthly: $5.99/mo');
    console.log('✅ Pro Yearly: $59.99/yr');
    console.log('\\n✅ Pricing seeded successfully!');

    process.exit(0);
}

seedPricing().catch(console.error);
