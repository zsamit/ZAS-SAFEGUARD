/**
 * ZAS Safeguard — Server-Side Subscription Verification
 * 
 * Dedicated endpoint for extension to verify subscription status.
 * This is the ONLY source of truth for premium access.
 * 
 * The extension MUST call this function:
 *   - On startup
 *   - On login
 *   - On PLAN_UPDATE message (re-verify)
 *   - On alarm sync (every 10 minutes)
 *   - Before enabling premium features if cache is stale
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

// ============================================
// PLAN CAPABILITY MATRIX (Server-Side)
// ============================================

const PLAN_CAPABILITIES = {
    free: {
        basic_blocking: true,
        ad_blocking: false,
        url_scanning: false,
        malware_protection: false,
        category_blocking: false,
        study_mode: false,
        advanced_alerts: false,
        analytics: false,
        cosmetic_filtering: false
    },
    trial: {
        basic_blocking: true,
        ad_blocking: true,
        url_scanning: true,
        malware_protection: true,
        category_blocking: true,
        study_mode: true,
        advanced_alerts: true,
        analytics: true,
        cosmetic_filtering: true
    },
    essential_monthly: {
        basic_blocking: true,
        ad_blocking: true,
        url_scanning: true,
        malware_protection: true,
        category_blocking: false,
        study_mode: false,
        advanced_alerts: false,
        analytics: false,
        cosmetic_filtering: true
    },
    essential_yearly: {
        basic_blocking: true,
        ad_blocking: true,
        url_scanning: true,
        malware_protection: true,
        category_blocking: false,
        study_mode: false,
        advanced_alerts: false,
        analytics: false,
        cosmetic_filtering: true
    },
    pro_monthly: {
        basic_blocking: true,
        ad_blocking: true,
        url_scanning: true,
        malware_protection: true,
        category_blocking: true,
        study_mode: true,
        advanced_alerts: true,
        analytics: true,
        cosmetic_filtering: true
    },
    pro_yearly: {
        basic_blocking: true,
        ad_blocking: true,
        url_scanning: true,
        malware_protection: true,
        category_blocking: true,
        study_mode: true,
        advanced_alerts: true,
        analytics: true,
        cosmetic_filtering: true
    },
    lifetime: {
        basic_blocking: true,
        ad_blocking: true,
        url_scanning: true,
        malware_protection: true,
        category_blocking: true,
        study_mode: true,
        advanced_alerts: true,
        analytics: true,
        cosmetic_filtering: true
    }
};

// Fallback for unknown/expired/cancelled plans
const NO_CAPABILITIES = {
    basic_blocking: true,  // Free tier gets basic blocking
    ad_blocking: false,
    url_scanning: false,
    malware_protection: false,
    category_blocking: false,
    study_mode: false,
    advanced_alerts: false,
    analytics: false,
    cosmetic_filtering: false
};

/**
 * Get capabilities for a plan
 */
function getCapabilities(plan, isActive) {
    if (!isActive) return NO_CAPABILITIES;
    return PLAN_CAPABILITIES[plan] || NO_CAPABILITIES;
}

// ============================================
// VERIFY SUBSCRIPTION FUNCTION
// ============================================

exports.verifySubscription = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .https.onCall(async (data, context) => {
        // Require authentication
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Authentication required'
            );
        }

        const uid = context.auth.uid;
        const startTime = Date.now();

        try {
            // Read subscription from Firestore (source of truth)
            const userDoc = await db.doc(`users/${uid}`).get();

            if (!userDoc.exists) {
                // Log verification for monitoring
                await logVerification(uid, 'user_not_found', null);
                return buildResponse(null, false);
            }

            const userData = userDoc.data();
            const subscription = userData.subscription || {};

            // Determine active status
            const planStatus = subscription.plan_status || subscription.status || 'inactive';
            const plan = subscription.plan || 'free';

            // Determine if subscription is active
            const activeStatuses = ['active', 'trialing', 'trial', 'freetrial'];
            const isActive = activeStatuses.includes(planStatus) || plan === 'lifetime';

            // Check trial expiration
            let trialEnd = null;
            if (subscription.trial_end) {
                trialEnd = subscription.trial_end.toDate
                    ? subscription.trial_end.toDate().toISOString()
                    : subscription.trial_end;

                // If trial has ended but status hasn't been updated
                if (new Date(trialEnd) < new Date() && planStatus === 'trialing') {
                    // Mark as expired in Firestore
                    await db.doc(`users/${uid}`).update({
                        'subscription.plan_status': 'expired',
                        'subscription.status': 'expired'
                    });

                    await logVerification(uid, 'trial_expired', plan);
                    return buildResponse(subscription, false);
                }
            }

            // Check subscription end date
            let periodEnd = null;
            if (subscription.current_period_end) {
                periodEnd = subscription.current_period_end.toDate
                    ? subscription.current_period_end.toDate().toISOString()
                    : subscription.current_period_end;

                // If period has ended but status shows active
                if (new Date(periodEnd) < new Date() && isActive && plan !== 'lifetime') {
                    await logVerification(uid, 'period_expired', plan);
                    return buildResponse(subscription, false);
                }
            }

            // Past due — allow grace period but flag it
            const isPastDue = planStatus === 'past_due';
            if (isPastDue) {
                await logVerification(uid, 'past_due_grace', plan);
            }

            // Build verified response
            const capabilities = getCapabilities(plan, isActive || isPastDue);
            const duration = Date.now() - startTime;

            // Log successful verification
            await logVerification(uid, isActive ? 'verified_active' : 'verified_inactive', plan, duration);

            return {
                verified: true,
                active: isActive || isPastDue,
                plan: plan,
                plan_status: planStatus,
                trial_end: trialEnd,
                current_period_end: periodEnd,
                capabilities: capabilities,
                grace_period: isPastDue,
                server_timestamp: new Date().toISOString(),
                ttl: 600 // 10 minutes in seconds
            };

        } catch (error) {
            console.error('[VerifySubscription] Error:', error);

            // Log failure
            await logVerification(uid, 'error', null, null, error.message).catch(() => { });

            throw new functions.https.HttpsError(
                'internal',
                'Verification failed'
            );
        }
    });

/**
 * Build a default (inactive) response
 */
function buildResponse(subscription, active) {
    const plan = subscription?.plan || 'free';
    return {
        verified: true,
        active: active,
        plan: plan,
        plan_status: active ? 'active' : 'inactive',
        trial_end: null,
        current_period_end: null,
        capabilities: getCapabilities(plan, active),
        grace_period: false,
        server_timestamp: new Date().toISOString(),
        ttl: 600
    };
}

/**
 * Log verification event for monitoring/diagnostics
 */
async function logVerification(uid, result, plan, durationMs, error) {
    try {
        await db.collection('metrics').add({
            type: 'subscription_verification',
            userId: uid,
            result: result,
            plan: plan || 'unknown',
            durationMs: durationMs || null,
            error: error || null,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (logError) {
        // Don't fail verification because of logging
        console.error('[VerifySubscription] Log error:', logError);
    }
}

// Export capabilities for use by other functions
exports.PLAN_CAPABILITIES = PLAN_CAPABILITIES;
exports.getCapabilities = getCapabilities;
