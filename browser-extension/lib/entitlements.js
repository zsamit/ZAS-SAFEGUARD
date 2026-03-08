/**
 * ZAS Safeguard — Centralized Entitlements Module
 * AI Browser Security Platform — Local Entitlement Reference
 *
 * Single reference for plan capabilities in the extension.
 * Used by background.js to map verified server state to feature flags.
 *
 * Source of truth chain:
 *   Stripe → Firestore → verifySubscription → Extension cache → This module
 */

// ============================================
// PLAN CAPABILITY MATRIX (Locked — must match server)
// ============================================
// 8 feature flags × 4 plan tiers
//
// Layers:
//   Local protection:    adult_blocking (free), category_blocking (premium)
//   Cloud intelligence:  security_intelligence, url_scanning, advanced_alerts
//   User controls:       study_mode
//   Account controls:    analytics, dashboard_admin

const PLAN_CAPABILITIES = {
    free: {
        adult_blocking: true,
        security_intelligence: false,
        url_scanning: false,
        category_blocking: false,
        study_mode: false,
        analytics: false,
        dashboard_admin: false,
        advanced_alerts: false
    },
    trial: {
        adult_blocking: true,
        security_intelligence: true,
        url_scanning: true,
        category_blocking: true,
        study_mode: true,
        analytics: true,
        dashboard_admin: true,
        advanced_alerts: true
    },
    premium: {
        adult_blocking: true,
        security_intelligence: true,
        url_scanning: true,
        category_blocking: true,
        study_mode: true,
        analytics: true,
        dashboard_admin: true,
        advanced_alerts: true
    },
    expired: {
        adult_blocking: true,
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
 */
function canUseFeature(featureName, verifiedSubscription) {
    if (!verifiedSubscription || !verifiedSubscription.verified) {
        return featureName === 'adult_blocking';
    }
    if (verifiedSubscription.capabilities) {
        return verifiedSubscription.capabilities[featureName] === true;
    }
    const plan = verifiedSubscription.plan || 'free';
    const isActive = verifiedSubscription.active === true;
    const capabilities = isActive
        ? (PLAN_CAPABILITIES[plan] || PLAN_CAPABILITIES.expired)
        : PLAN_CAPABILITIES.expired;
    return capabilities[featureName] === true;
}

/**
 * Get all capabilities for the verified subscription.
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
// Tier 1: Core Safety (adult blocking) — always active, never disabled
//   - ruleset_block
//
// Tier 2: Security Intelligence — requires security_intelligence flag
//   - adblock_malware
//
// Tier 3: Ad Filtering + Privacy — requires premium
//   - adblock_ads, adblock_trackers, adblock_youtube
//
// Tier 4: Optional / Quality-of-Life — requires premium + user opt-in
//   - adblock_annoyances, adblock_social
//   - DISABLED during grace/failure

/**
 * Map capabilities to rulesets that should be enabled.
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

    // Tier 1: Adult blocking — ALWAYS active, never disabled
    enable.push('ruleset_block');

    // Tier 2: Security Intelligence
    if (capabilities.security_intelligence) {
        enable.push('adblock_malware');
    }

    // Tier 3: Ad Filtering + Privacy
    if (capabilities.security_intelligence) {
        enable.push('adblock_ads');
        enable.push('adblock_trackers');
        enable.push('adblock_youtube');
    }

    // Tier 4: Optional / Quality-of-Life — disabled during grace/failure
    if (capabilities.security_intelligence && !isGraceOrFailure) {
        if (userPrefs?.annoyances) enable.push('adblock_annoyances');
        if (userPrefs?.social) enable.push('adblock_social');
    }

    for (const rs of allRulesets) {
        if (!enable.includes(rs)) disable.push(rs);
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
 */
function checkCacheValidity(cached) {
    if (!cached || !cached.lastVerifiedAt || !cached.verified) {
        return { valid: false, expired: true, graceActive: false };
    }
    const age = Date.now() - cached.lastVerifiedAt;
    if (age <= VERIFICATION_TTL_MS) {
        return { valid: true, expired: false, graceActive: false };
    }
    if (age <= GRACE_PERIOD_MS && cached.active === true && cached.plan !== 'free' && cached.plan !== 'expired') {
        return { valid: true, expired: true, graceActive: true };
    }
    return { valid: false, expired: true, graceActive: false };
}

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
