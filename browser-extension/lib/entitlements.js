/**
 * ZAS Safeguard — Centralized Entitlements Module
 * 
 * Single source of truth for plan capabilities in the extension.
 * Used by background.js to determine what features to enable.
 * 
 * IMPORTANT: This module does NOT make any decisions about subscription
 * status. It only maps a verified server response to feature flags.
 */

// ============================================
// PLAN CAPABILITY MATRIX
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

// No capabilities — used for expired/cancelled/unknown plans
const NO_PREMIUM = {
    basic_blocking: true,   // Free tier always gets basic blocking
    ad_blocking: false,
    url_scanning: false,
    malware_protection: false,
    category_blocking: false,
    study_mode: false,
    advanced_alerts: false,
    analytics: false,
    cosmetic_filtering: false
};

// ============================================
// FEATURE ENTITLEMENTS
// ============================================

/**
 * Check if a specific feature is available for the current plan.
 * 
 * @param {string} featureName - Feature to check (e.g., 'ad_blocking', 'study_mode')
 * @param {object} verifiedSubscription - The verified server response
 * @returns {boolean} - Whether the feature is available
 */
function canUseFeature(featureName, verifiedSubscription) {
    if (!verifiedSubscription || !verifiedSubscription.verified) {
        // Not verified — only allow basic blocking
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
        ? (PLAN_CAPABILITIES[plan] || NO_PREMIUM)
        : NO_PREMIUM;

    return capabilities[featureName] === true;
}

/**
 * Get all capabilities for the verified subscription.
 * 
 * @param {object} verifiedSubscription - The verified server response
 * @returns {object} - All capability flags
 */
function getCapabilities(verifiedSubscription) {
    if (!verifiedSubscription || !verifiedSubscription.verified || !verifiedSubscription.active) {
        return NO_PREMIUM;
    }

    if (verifiedSubscription.capabilities) {
        return verifiedSubscription.capabilities;
    }

    const plan = verifiedSubscription.plan || 'free';
    return PLAN_CAPABILITIES[plan] || NO_PREMIUM;
}

/**
 * Map capabilities to rulesets that should be enabled.
 * 
 * Tier 1 (core): Always loaded first
 *   - ruleset_block (basic content blocking)
 *   - adblock_malware (security)
 * 
 * Tier 2 (privacy): Premium
 *   - adblock_trackers
 * 
 * Tier 3 (ad blocking): Premium
 *   - adblock_ads
 *   - adblock_youtube
 * 
 * Tier 4 (optional): Premium
 *   - adblock_annoyances
 *   - adblock_social
 * 
 * @param {object} capabilities - Capability flags
 * @returns {{ enable: string[], disable: string[] }}
 */
function getRulesetConfig(capabilities) {
    const allRulesets = [
        'ruleset_block',
        'adblock_ads',
        'adblock_trackers',
        'adblock_malware',
        'adblock_annoyances',
        'adblock_social',
        'adblock_youtube'
    ];

    const enable = [];
    const disable = [];

    // Tier 1: Core protection (free + premium)
    if (capabilities.basic_blocking) {
        enable.push('ruleset_block');
    }
    if (capabilities.malware_protection) {
        enable.push('adblock_malware');
    }

    // Tier 2: Privacy (premium)
    if (capabilities.ad_blocking) {
        enable.push('adblock_trackers');
    }

    // Tier 3: Ad blocking (premium)
    if (capabilities.ad_blocking) {
        enable.push('adblock_ads');
        enable.push('adblock_youtube');
    }

    // Tier 4: Optional (premium, user-controlled)
    if (capabilities.ad_blocking) {
        // These are user-controlled but require premium
        // Don't auto-enable — they'll be enabled by user preference
        // For now, keep them in disable unless user has turned them on
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
// VERIFICATION CACHE
// ============================================

const VERIFICATION_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const GRACE_PERIOD_MS = 60 * 60 * 1000;            // 1 hour

/**
 * Check if cached verification is still valid.
 * 
 * @param {object} cached - Cached verification data from storage
 * @returns {{ valid: boolean, expired: boolean, graceActive: boolean }}
 */
function checkCacheValidity(cached) {
    if (!cached || !cached.lastVerifiedAt || !cached.verified) {
        return { valid: false, expired: true, graceActive: false };
    }

    const now = Date.now();
    const age = now - cached.lastVerifiedAt;

    // Within TTL — fully valid
    if (age <= VERIFICATION_TTL_MS) {
        return { valid: true, expired: false, graceActive: false };
    }

    // Within grace period — valid but stale (should re-verify ASAP)
    if (age <= GRACE_PERIOD_MS && cached.active === true) {
        return { valid: true, expired: true, graceActive: true };
    }

    // Beyond grace period — invalid
    return { valid: false, expired: true, graceActive: false };
}

// Export for use as inline module in background.js
// (Service workers can't use ES modules with importScripts)
if (typeof globalThis !== 'undefined') {
    globalThis.ZASEntitlements = {
        PLAN_CAPABILITIES,
        NO_PREMIUM,
        canUseFeature,
        getCapabilities,
        getRulesetConfig,
        checkCacheValidity,
        VERIFICATION_TTL_MS,
        GRACE_PERIOD_MS
    };
}
