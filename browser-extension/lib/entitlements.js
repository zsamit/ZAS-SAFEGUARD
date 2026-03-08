/**
 * ZAS Safeguard — Centralized Entitlements Module
 * AI Browser Security Platform — Local Entitlement Reference
 *
 * Single reference for plan capabilities in the extension.
 * Used by background.js to map verified server state to feature flags.
 *
 * IMPORTANT: This module does NOT make entitlement decisions.
 * Only verifySubscription (server) determines premium access.
 * This module maps a verified response to local feature behavior.
 *
 * Source of truth chain:
 *   Stripe → Firestore → verifySubscription → Extension cache → This module
 */

// ============================================
// PLAN CAPABILITY MATRIX (Locked — must match server)
// ============================================
// 8 feature flags × 5 plan tiers
//
// Layers:
//   Local protection:    basic_blocking, category_blocking
//   Cloud intelligence:  security_intelligence, url_scanning, advanced_alerts
//   User controls:       study_mode
//   Account controls:    analytics, dashboard_admin

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

// ============================================
// FEATURE ENTITLEMENTS
// ============================================

/**
 * Check if a specific feature is available for the current plan.
 *
 * @param {string} featureName - Feature to check (e.g., 'security_intelligence', 'study_mode')
 * @param {object} verifiedSubscription - The verified server response
 * @returns {boolean}
 */
function canUseFeature(featureName, verifiedSubscription) {
    if (!verifiedSubscription || !verifiedSubscription.verified) {
        // Not verified — only core safety (basic_blocking) is available
        return featureName === 'basic_blocking';
    }

    // Use server-provided capabilities if available
    if (verifiedSubscription.capabilities) {
        return verifiedSubscription.capabilities[featureName] === true;
    }

    // Fallback: derive from plan
    const plan = verifiedSubscription.plan || 'free';
    const isActive = verifiedSubscription.active === true;
    const capabilities = isActive
        ? (PLAN_CAPABILITIES[plan] || PLAN_CAPABILITIES.expired)
        : PLAN_CAPABILITIES.expired;

    return capabilities[featureName] === true;
}

/**
 * Get all capabilities for the verified subscription.
 *
 * @param {object} verifiedSubscription - The verified server response
 * @returns {object} All capability flags
 */
function getCapabilities(verifiedSubscription) {
    if (!verifiedSubscription || !verifiedSubscription.verified || !verifiedSubscription.active) {
        return PLAN_CAPABILITIES.expired;
    }
    if (verifiedSubscription.capabilities) {
        return verifiedSubscription.capabilities;
    }
    const plan = verifiedSubscription.plan || 'free';
    return PLAN_CAPABILITIES[plan] || PLAN_CAPABILITIES.expired;
}

// ============================================
// RULESET TIER MAPPING (Locked)
// ============================================
//
// Tier 1: Core Safety — always active, never disabled
//   - ruleset_block
//
// Tier 2: Security Intelligence — requires security_intelligence flag
//   - adblock_malware (malware/phishing/fraud rulesets)
//
// Tier 3: Ad Filtering + Privacy — requires pro or trial
//   - adblock_ads, adblock_trackers, adblock_youtube
//
// Tier 4: Optional / Quality-of-Life — requires pro or trial + user opt-in
//   - adblock_annoyances, adblock_social
//   - DISABLED during grace/failure scenarios

/**
 * Map capabilities to rulesets that should be enabled.
 *
 * @param {object} capabilities - Capability flags from verified state
 * @param {object} userPrefs - User preference settings (for Tier 4)
 * @param {boolean} isGraceOrFailure - Whether extension is in grace/failure mode
 * @returns {{ enable: string[], disable: string[] }}
 */
function getRulesetConfig(capabilities, userPrefs, isGraceOrFailure) {
    const allRulesets = [
        'ruleset_block',
        'adblock_malware',
        'adblock_ads',
        'adblock_trackers',
        'adblock_youtube',
        'adblock_annoyances',
        'adblock_social'
    ];

    const enable = [];
    const disable = [];

    // Tier 1: Core Safety — ALWAYS active, never disabled
    enable.push('ruleset_block');

    // Tier 2: Security Intelligence
    if (capabilities.security_intelligence) {
        enable.push('adblock_malware');
    }

    // Tier 3: Ad Filtering + Privacy (requires security_intelligence as baseline)
    if (capabilities.security_intelligence) {
        enable.push('adblock_ads');
        enable.push('adblock_trackers');
        enable.push('adblock_youtube');
    }

    // Tier 4: Optional / Quality-of-Life
    // Disabled during grace/failure — these are convenience, not security
    if (capabilities.security_intelligence && !isGraceOrFailure) {
        if (userPrefs?.annoyances) enable.push('adblock_annoyances');
        if (userPrefs?.social) enable.push('adblock_social');
    }

    // Everything not enabled should be disabled
    for (const rs of allRulesets) {
        if (!enable.includes(rs)) {
            disable.push(rs);
        }
    }

    return { enable, disable };
}

// ============================================
// VERIFICATION CACHE (Locked)
// ============================================

const VERIFICATION_TTL_MS = 10 * 60 * 1000;    // 10 minutes
const GRACE_PERIOD_MS = 60 * 60 * 1000;         // 1 hour

/**
 * Check if cached verification is still valid.
 *
 * Rules:
 *   - Within TTL (≤10min): fully valid
 *   - Within grace (≤1hr) AND previously active paid user: valid but stale
 *   - Free users: no grace period
 *   - Beyond grace or no prior verification: invalid → fail closed
 *
 * @param {object} cached - Cached verification data from storage
 * @returns {{ valid: boolean, expired: boolean, graceActive: boolean }}
 */
function checkCacheValidity(cached) {
    if (!cached || !cached.lastVerifiedAt || !cached.verified) {
        return { valid: false, expired: true, graceActive: false };
    }

    const age = Date.now() - cached.lastVerifiedAt;

    // Within TTL — fully valid
    if (age <= VERIFICATION_TTL_MS) {
        return { valid: true, expired: false, graceActive: false };
    }

    // Grace period — ONLY for previously verified active PAID users
    // Free users do NOT get grace period behavior
    if (age <= GRACE_PERIOD_MS && cached.active === true && cached.plan !== 'free' && cached.plan !== 'expired') {
        return { valid: true, expired: true, graceActive: true };
    }

    // Beyond grace or free user — invalid
    return { valid: false, expired: true, graceActive: false };
}

// Export for use as inline module in background.js
if (typeof globalThis !== 'undefined') {
    globalThis.ZASEntitlements = {
        PLAN_CAPABILITIES,
        canUseFeature,
        getCapabilities,
        getRulesetConfig,
        checkCacheValidity,
        VERIFICATION_TTL_MS,
        GRACE_PERIOD_MS
    };
}
