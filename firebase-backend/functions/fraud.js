/**
 * ZAS Safeguard - Fraud Detection Functions
 * 5-layer anti-VPN pricing system
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const geoip = require('geoip-lite');

const db = admin.firestore();

// Country to region tier mapping
const COUNTRY_TO_TIER = {
    // USA tier
    'US': 'usa', 'CA': 'usa',
    // EU tier  
    'GB': 'eu', 'DE': 'eu', 'FR': 'eu', 'IT': 'eu', 'ES': 'eu', 'NL': 'eu',
    'BE': 'eu', 'AT': 'eu', 'CH': 'eu', 'SE': 'eu', 'NO': 'eu', 'DK': 'eu',
    'FI': 'eu', 'IE': 'eu', 'PT': 'eu', 'PL': 'eu', 'CZ': 'eu', 'GR': 'eu',
    // Regional pricing tiers
    'AF': 'afg',
    'PK': 'pak',
    'IN': 'ind',
    'EG': 'egy',
    'BD': 'bgd',
};

// Known VPN/datacenter IP ranges (simplified - use a proper service in production)
const DATACENTER_ASNS = [
    'DIGITALOCEAN', 'AMAZON', 'GOOGLE-CLOUD', 'MICROSOFT-AZURE',
    'LINODE', 'VULTR', 'OVH', 'HETZNER', 'CLOUDFLARE',
];

/**
 * Calculate fraud score using 5-layer detection
 */
exports.calculateFraudScore = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { ipAddress, appStoreRegion } = data;
    const uid = context.auth.uid;

    try {
        let score = 0;
        const signals = {};
        const mismatches = [];

        // Get user data
        const userDoc = await db.doc(`users/${uid}`).get();
        const userData = userDoc.data();

        // ============================================
        // Layer 1: SIM Country (Primary Signal)
        // ============================================
        const simCountry = userData.phone_country || null;
        signals.sim_country = simCountry;

        if (!simCountry) {
            signals.sim_verified = false;
            // No SIM verification = slight increase in score
            score += 0.5;
        } else {
            signals.sim_verified = true;
        }

        // ============================================
        // Layer 2: Payment Method Country
        // ============================================
        let paymentCountry = null;

        if (userData.subscription?.stripe_customer_id) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                const customer = await stripe.customers.retrieve(
                    userData.subscription.stripe_customer_id,
                    { expand: ['sources'] }
                );

                if (customer.sources?.data?.[0]?.country) {
                    paymentCountry = customer.sources.data[0].country;
                }
            } catch (e) {
                console.log('Could not retrieve Stripe payment country:', e.message);
            }
        }

        signals.payment_country = paymentCountry;

        if (simCountry && paymentCountry && simCountry !== paymentCountry) {
            score += 2;
            mismatches.push('sim_payment');
            signals.payment_mismatch = true;
        }

        // ============================================
        // Layer 3: App Store Region
        // ============================================
        signals.app_store_region = appStoreRegion || null;

        if (appStoreRegion && simCountry && appStoreRegion !== simCountry) {
            score += 1;
            mismatches.push('app_store');
            signals.app_store_mismatch = true;
        }

        // ============================================
        // Layer 4: IP Address Check
        // ============================================
        let ipCountry = null;

        if (ipAddress) {
            const geo = geoip.lookup(ipAddress);
            if (geo) {
                ipCountry = geo.country;
                signals.ip_country = ipCountry;
                signals.ip_city = geo.city;
                signals.ip_region = geo.region;
            }
        } else if (context.rawRequest) {
            // Try to get IP from request headers
            const forwardedFor = context.rawRequest.headers['x-forwarded-for'];
            const realIp = forwardedFor ? forwardedFor.split(',')[0].trim() :
                context.rawRequest.ip;

            if (realIp) {
                const geo = geoip.lookup(realIp);
                if (geo) {
                    ipCountry = geo.country;
                    signals.ip_country = ipCountry;
                }
            }
        }

        if (simCountry && ipCountry && simCountry !== ipCountry) {
            score += 1;
            mismatches.push('ip_country');
            signals.ip_mismatch = true;
        }

        // ============================================
        // Layer 5: VPN/Datacenter Detection
        // ============================================
        let isVPN = false;

        if (ipAddress) {
            // In production, use a VPN detection API like IPQualityScore or IPHub
            // This is a simplified check
            const geo = geoip.lookup(ipAddress);

            if (geo) {
                // Check if IP is in a datacenter ASN (simplified)
                // In production, use proper ASN lookup
                const org = (geo.org || '').toUpperCase();
                isVPN = DATACENTER_ASNS.some(dc => org.includes(dc));
            }
        }

        signals.vpn_detected = isVPN;

        if (isVPN) {
            score += 1;
            mismatches.push('vpn');
        }

        // ============================================
        // Determine Pricing Tier
        // ============================================
        let pricingTier;
        const baseTier = simCountry ? (COUNTRY_TO_TIER[simCountry] || 'usa') : 'usa';

        if (score >= 4) {
            // High fraud - force US pricing
            pricingTier = 'usa';
            signals.pricing_reason = 'high_fraud_score';
        } else if (score >= 2) {
            // Medium fraud - move to higher tier
            if (baseTier !== 'usa' && baseTier !== 'eu') {
                pricingTier = 'usa';
                signals.pricing_reason = 'fraud_tier_upgrade';
            } else {
                pricingTier = baseTier;
            }
        } else {
            // Clean or low risk
            pricingTier = baseTier;
            signals.pricing_reason = 'normal';
        }

        // Round score
        score = Math.round(score * 10) / 10;

        // Store fraud score
        await db.doc(`fraud_scores/${uid}`).set({
            score,
            sim_country: simCountry,
            payment_country: paymentCountry,
            ip_country: ipCountry,
            app_store_region: appStoreRegion,
            pricing_tier: pricingTier,
            mismatches,
            signals,
            last_checked: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update user's price tier
        await db.doc(`users/${uid}`).update({
            'subscription.price_tier': pricingTier,
        });

        // Log if high fraud score
        if (score >= 3) {
            await db.collection('logs').add({
                userId: uid,
                type: 'fraud_alert',
                message: `High fraud score detected: ${score}`,
                metadata: signals,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        return {
            success: true,
            score,
            pricingTier,
            signals,
            mismatches,
        };
    } catch (error) {
        console.error('Calculate fraud score error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to calculate fraud score');
    }
});

/**
 * Check device fingerprint for trial abuse
 */
exports.checkDeviceFingerprint = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { fingerprint } = data;
    const uid = context.auth.uid;

    try {
        const registryRef = db.doc(`device_registry/${fingerprint}`);
        const registryDoc = await registryRef.get();

        if (!registryDoc.exists) {
            // New device
            return {
                isNew: true,
                trialUsed: false,
                fraudFlags: [],
            };
        }

        const registryData = registryDoc.data();

        // Check if trial was already used
        if (registryData.trial_used) {
            return {
                isNew: false,
                trialUsed: true,
                fraudFlags: registryData.fraud_flags || [],
                message: 'Trial already used on this device',
            };
        }

        // Check if associated with other users
        const associatedUsers = registryData.associated_users || [];

        if (associatedUsers.length > 0 && !associatedUsers.includes(uid)) {
            // Device was registered by another user
            // Check if that user used trial
            for (const otherUid of associatedUsers) {
                const otherUser = await db.doc(`users/${otherUid}`).get();
                if (otherUser.exists) {
                    const otherSub = otherUser.data().subscription;
                    if (otherSub?.trial_start || otherSub?.plan !== 'free') {
                        return {
                            isNew: false,
                            trialUsed: true,
                            fraudFlags: ['multi_user_device'],
                            message: 'Trial already used by another account on this device',
                        };
                    }
                }
            }
        }

        return {
            isNew: false,
            trialUsed: false,
            associatedUserCount: associatedUsers.length,
            fraudFlags: registryData.fraud_flags || [],
        };
    } catch (error) {
        console.error('Check device fingerprint error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to check device');
    }
});
