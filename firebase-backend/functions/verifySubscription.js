/**
 * ZAS Safeguard — Server-Side Subscription Verification
 * AI Browser Security Platform — Single Entitlement Authority
 *
 * This function is the ONLY source of truth for premium access.
 * No other endpoint determines entitlements.
 *
 * Source of truth chain:
 *   Stripe → (webhook) → Firestore → (verifySubscription) → Extension
 *
 * Rules:
 *   - Reads from Firestore first (primary operational source of truth)
 *   - Stripe is NOT queried per-request
 *   - Stripe cross-checks used only for reconciliation, inconsistency detection, repair flows
 *   - Extension cache is never the authority (10-min TTL, 1-hr grace for verified paid users)
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
// PLAN CAPABILITY MATRIX (Locked)
// ============================================
// 8 feature flags × 5 plan tiers
// Feature layers:
//   Local protection: basic_blocking, category_blocking
//   Cloud intelligence: security_intelligence, url_scanning, advanced_alerts
//   User controls: study_mode
//   Account controls: analytics, dashboard_admin

const PLAN_CAPABILITIES = {
    free: {
        basic_blocking: true,
        security_intelligence: false,
        url_scanning: false,
        category_blocking: false,
        study_mode: false,
        analytics: false,
        dashboard_admin: false,
        advanced_alerts: false
    },
    trial: {
        basic_blocking: true,
        security_intelligence: true,
        url_scanning: true,
        category_blocking: true,
        study_mode: true,
        analytics: true,
        dashboard_admin: true,
        advanced_alerts: true
    },
    essential: {
        basic_blocking: true,
        security_intelligence: true,
        url_scanning: true,
        category_blocking: false,
        study_mode: false,
        analytics: false,
        dashboard_admin: true,
        advanced_alerts: false
    },
    pro: {
        basic_blocking: true,
        security_intelligence: true,
        url_scanning: true,
        category_blocking: true,
        study_mode: true,
        analytics: true,
        dashboard_admin: true,
        advanced_alerts: true
    },
    expired: {
        basic_blocking: true,
        security_intelligence: false,
        url_scanning: false,
        category_blocking: false,
        study_mode: false,
        analytics: false,
        dashboard_admin: false,
        advanced_alerts: false
    }
};

/**
 * Normalize plan name to canonical tier.
 * essential_monthly/essential_yearly → essential
 * pro_monthly/pro_yearly → pro
 * lifetime → pro
 */
function normalizePlan(plan) {
    if (!plan) return 'free';
    const p = plan.toLowerCase();
    if (p === 'essential_monthly' || p === 'essential_yearly') return 'essential';
    if (p === 'pro_monthly' || p === 'pro_yearly') return 'pro';
    if (p === 'lifetime') return 'pro';
    if (PLAN_CAPABILITIES[p]) return p;
    return 'expired'; // unknown plans resolve to expired
}

/**
 * Get capabilities for a normalized plan.
 */
function getCapabilities(plan, isActive) {
    if (!isActive) return PLAN_CAPABILITIES.expired;
    const normalized = normalizePlan(plan);
    return PLAN_CAPABILITIES[normalized] || PLAN_CAPABILITIES.expired;
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
            // Read subscription from Firestore (primary operational source of truth)
            const userDoc = await db.doc(`users/${uid}`).get();

            if (!userDoc.exists) {
                await logVerification(uid, 'user_not_found', null);
                return buildResponse(null, false);
            }

            const userData = userDoc.data();
            const subscription = userData.subscription || {};

            // Determine active status
            const planStatus = subscription.plan_status || subscription.status || 'inactive';
            const rawPlan = subscription.plan || 'free';
            const plan = normalizePlan(rawPlan);

            // Determine if subscription is active
            const activeStatuses = ['active', 'trialing', 'trial', 'freetrial'];
            const isActive = activeStatuses.includes(planStatus) || rawPlan === 'lifetime';

            // Check trial expiration
            let trialEnd = null;
            if (subscription.trial_end) {
                trialEnd = subscription.trial_end.toDate
                    ? subscription.trial_end.toDate().toISOString()
                    : subscription.trial_end;

                // If trial has ended but status hasn't been updated
                if (new Date(trialEnd) < new Date() && planStatus === 'trialing') {
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

                // Firestore inconsistency: status active but period expired
                if (new Date(periodEnd) < new Date() && isActive && rawPlan !== 'lifetime') {
                    // Log inconsistency to critical_errors for admin visibility
                    await logInconsistency(uid, plan, planStatus, periodEnd);
                    await logVerification(uid, 'period_expired_inconsistency', plan);
                    return buildResponse(subscription, false);
                }
            }

            // Past due — allow grace period but flag it
            const isPastDue = planStatus === 'past_due';
            if (isPastDue) {
                await logVerification(uid, 'past_due_grace', plan);
            }

            // Build verified response
            const capabilities = getCapabilities(rawPlan, isActive || isPastDue);
            const duration = Date.now() - startTime;

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
                ttl: 600 // 10 minutes
            };

        } catch (error) {
            console.error('[VerifySubscription] Error:', error);
            await logVerification(uid, 'error', null, null, error.message).catch(() => { });
            throw new functions.https.HttpsError('internal', 'Verification failed');
        }
    });

/**
 * Build a default (inactive) response.
 */
function buildResponse(subscription, active) {
    const rawPlan = subscription?.plan || 'free';
    const plan = normalizePlan(rawPlan);
    return {
        verified: true,
        active: active,
        plan: plan,
        plan_status: active ? 'active' : 'inactive',
        trial_end: null,
        current_period_end: null,
        capabilities: getCapabilities(rawPlan, active),
        grace_period: false,
        server_timestamp: new Date().toISOString(),
        ttl: 600
    };
}

/**
 * Log verification event to metrics collection.
 * Destination: Cloud Logging + Firestore metrics collection.
 */
async function logVerification(uid, result, plan, durationMs, error) {
    try {
        const entry = {
            type: 'subscription_verification',
            userId: uid,
            result: result,
            plan: plan || 'unknown',
            durationMs: durationMs || null,
            error: error || null,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };
        console.log('[VerifySubscription] Metric:', JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
        await db.collection('metrics').add(entry);
    } catch (logError) {
        console.error('[VerifySubscription] Log error:', logError);
    }
}

/**
 * Log Firestore inconsistency to critical_errors for admin visibility.
 * Trigger: plan_status=active but current_period_end is in the past.
 */
async function logInconsistency(uid, plan, planStatus, periodEnd) {
    try {
        const entry = {
            type: 'firestore_subscription_inconsistency',
            userId: uid,
            plan: plan,
            planStatus: planStatus,
            periodEnd: periodEnd,
            message: `User ${uid} has plan_status=${planStatus} but current_period_end=${periodEnd} is in the past. Possible Stripe webhook miss.`,
            severity: 'critical',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };
        console.warn('[VerifySubscription] INCONSISTENCY:', entry.message);
        await db.collection('critical_errors').add(entry);
    } catch (logError) {
        console.error('[VerifySubscription] Inconsistency log error:', logError);
    }
}

// Export for use by other functions
exports.PLAN_CAPABILITIES = PLAN_CAPABILITIES;
exports.getCapabilities = getCapabilities;
exports.normalizePlan = normalizePlan;
