/**
 * Seed Stripe Price IDs into Firestore
 * 
 * Run this script to set up the Stripe price configuration.
 * Replace the placeholder price IDs with your actual Stripe Price IDs.
 * 
 * Usage: node seed-stripe-prices.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function seedStripePrices() {
    /**
     * REPLACE THESE WITH YOUR ACTUAL STRIPE PRICE IDs
     * 
     * You can find these in Stripe Dashboard:
     * 1. Go to https://dashboard.stripe.com/products
     * 2. Click on your product
     * 3. Copy the price ID (starts with price_)
     * 
     * Pricing:
     * - Essential Monthly: $2.99/month
     * - Pro Monthly: $5.99/month
     * - Essential Yearly: $29.99/year
     * - Pro Yearly: $59.99/year
     */
    const stripePrices = {
        essential_monthly: 'price_REPLACE_ESSENTIAL_MONTHLY',   // $2.99/mo
        pro_monthly: 'price_REPLACE_PRO_MONTHLY',               // $5.99/mo
        essential_yearly: 'price_REPLACE_ESSENTIAL_YEARLY',     // $29.99/yr
        pro_yearly: 'price_REPLACE_PRO_YEARLY',                 // $59.99/yr
    };

    try {
        await db.doc('config/stripe_prices').set(stripePrices, { merge: true });
        console.log('✅ Stripe prices seeded successfully!');
        console.log('');
        console.log('Prices configured:');
        console.log(`  - Essential Monthly ($2.99/mo): ${stripePrices.essential_monthly}`);
        console.log(`  - Pro Monthly ($5.99/mo): ${stripePrices.pro_monthly}`);
        console.log(`  - Essential Yearly ($29.99/yr): ${stripePrices.essential_yearly}`);
        console.log(`  - Pro Yearly ($59.99/yr): ${stripePrices.pro_yearly}`);
        console.log('');
        console.log('⚠️  IMPORTANT: Replace the placeholder IDs with your actual Stripe Price IDs!');
    } catch (error) {
        console.error('❌ Error seeding prices:', error);
    }

    process.exit(0);
}

seedStripePrices();
