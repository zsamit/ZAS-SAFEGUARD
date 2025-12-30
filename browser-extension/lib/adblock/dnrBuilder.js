/**
 * ZAS Safeguard - DNR Rule Builder
 * 
 * Generates Chrome DeclarativeNetRequest rules:
 * - Converts filter patterns to DNR format
 * - Groups rules by category
 * - Manages dynamic rules for allowlists
 * - Respects Chrome's rule limits
 */

// Rule ID ranges to prevent collisions
const RULE_ID_RANGES = {
    STATIC_BASE: 1,           // Static rules start here
    DYNAMIC_ALLOWLIST: 50000, // User allowlist rules
    DYNAMIC_CUSTOM: 55000,    // Custom user rules
    DYNAMIC_SITE_MODE: 60000  // Per-site mode overrides
};

// Chrome limits
const LIMITS = {
    MAX_STATIC_RULES: 30000,
    MAX_DYNAMIC_RULES: 5000,
    MAX_ENABLED_RULESETS: 50
};

// Category to ruleset mapping
const CATEGORY_RULESETS = {
    ads: 'adblock_ads',
    trackers: 'adblock_trackers',
    malware: 'adblock_malware',
    annoyances: 'adblock_annoyances',
    social: 'adblock_social'
};

/**
 * Build a DNR block rule from a domain pattern
 * @param {number} id - Rule ID
 * @param {string} domain - Domain or URL pattern to block
 * @param {string} category - Rule category (ads, trackers, etc.)
 * @returns {Object} - DNR rule object
 */
function buildBlockRule(id, domain, category = 'ads') {
    // Clean the domain pattern
    let urlFilter = domain;

    // If it's just a domain, wrap it properly
    if (!domain.includes('*') && !domain.includes('/')) {
        urlFilter = `||${domain}^`;
    }

    return {
        id: id,
        priority: 1,
        action: { type: 'block' },
        condition: {
            urlFilter: urlFilter,
            resourceTypes: [
                'script',
                'image',
                'stylesheet',
                'object',
                'xmlhttprequest',
                'sub_frame',
                'media',
                'font',
                'ping',
                'other'
            ]
        }
    };
}

/**
 * Build a DNR allow rule (for allowlist/whitelist)
 * @param {number} id - Rule ID
 * @param {string} domain - Domain to allow
 * @returns {Object} - DNR rule object
 */
function buildAllowRule(id, domain) {
    return {
        id: id,
        priority: 100, // Higher priority than block rules
        action: { type: 'allow' },
        condition: {
            requestDomains: [domain.replace(/^www\./, '')],
            resourceTypes: [
                'main_frame',
                'sub_frame',
                'script',
                'image',
                'stylesheet',
                'object',
                'xmlhttprequest',
                'media',
                'font',
                'ping',
                'other'
            ]
        }
    };
}

/**
 * Generate dynamic rules from an allowlist
 * @param {string[]} domains - List of domains to allow
 * @returns {Object[]} - Array of DNR rules
 */
function generateAllowlistRules(domains) {
    return domains.map((domain, index) =>
        buildAllowRule(RULE_ID_RANGES.DYNAMIC_ALLOWLIST + index, domain)
    );
}

/**
 * Apply allowlist rules dynamically
 * @param {string[]} domains - Domains to allow
 */
async function applyAllowlist(domains) {
    try {
        // Get existing dynamic rules
        const existing = await chrome.declarativeNetRequest.getDynamicRules();

        // Find allowlist rule IDs to remove
        const allowlistIds = existing
            .filter(r => r.id >= RULE_ID_RANGES.DYNAMIC_ALLOWLIST &&
                r.id < RULE_ID_RANGES.DYNAMIC_CUSTOM)
            .map(r => r.id);

        // Generate new rules
        const newRules = generateAllowlistRules(domains);

        // Check limits
        if (newRules.length > 500) {
            console.warn('[AdBlock DNR] Allowlist too large, truncating to 500');
            newRules.length = 500;
        }

        // Apply update
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: allowlistIds,
            addRules: newRules
        });

        console.log('[AdBlock DNR] Applied', newRules.length, 'allowlist rules');
        return true;
    } catch (error) {
        console.error('[AdBlock DNR] Error applying allowlist:', error);
        return false;
    }
}

/**
 * Enable or disable a static ruleset
 * @param {string} rulesetId - ID of the ruleset
 * @param {boolean} enabled - Whether to enable
 */
async function setRulesetEnabled(rulesetId, enabled) {
    try {
        if (enabled) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                enableRulesetIds: [rulesetId]
            });
        } else {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                disableRulesetIds: [rulesetId]
            });
        }

        console.log('[AdBlock DNR] Ruleset', rulesetId, enabled ? 'enabled' : 'disabled');
        return true;
    } catch (error) {
        console.error('[AdBlock DNR] Error toggling ruleset:', error);
        return false;
    }
}

/**
 * Enable/disable a category of blocking
 * @param {string} category - Category name (ads, trackers, etc.)
 * @param {boolean} enabled - Whether to enable
 */
async function setCategoryEnabled(category, enabled) {
    const rulesetId = CATEGORY_RULESETS[category];
    if (!rulesetId) {
        console.error('[AdBlock DNR] Unknown category:', category);
        return false;
    }

    return setRulesetEnabled(rulesetId, enabled);
}

/**
 * Get currently enabled rulesets
 * @returns {Promise<string[]>} - Array of enabled ruleset IDs
 */
async function getEnabledRulesets() {
    try {
        const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
        return rulesets;
    } catch (error) {
        console.error('[AdBlock DNR] Error getting rulesets:', error);
        return [];
    }
}

/**
 * Get rule count information
 * @returns {Promise<Object>} - Rule counts by category
 */
async function getRuleCounts() {
    try {
        const [dynamicRules, sessionRules] = await Promise.all([
            chrome.declarativeNetRequest.getDynamicRules(),
            chrome.declarativeNetRequest.getSessionRules()
        ]);

        const enabledRulesets = await getEnabledRulesets();

        return {
            dynamicCount: dynamicRules.length,
            sessionCount: sessionRules.length,
            enabledRulesets: enabledRulesets,
            limits: LIMITS
        };
    } catch (error) {
        console.error('[AdBlock DNR] Error getting rule counts:', error);
        return { dynamicCount: 0, sessionCount: 0, enabledRulesets: [], limits: LIMITS };
    }
}

/**
 * Clear all dynamic adblock rules
 */
async function clearDynamicRules() {
    try {
        const existing = await chrome.declarativeNetRequest.getDynamicRules();

        // Only clear adblock-related rules (ID >= 50000)
        const adblockIds = existing
            .filter(r => r.id >= RULE_ID_RANGES.DYNAMIC_ALLOWLIST)
            .map(r => r.id);

        if (adblockIds.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: adblockIds
            });
        }

        console.log('[AdBlock DNR] Cleared', adblockIds.length, 'dynamic rules');
        return true;
    } catch (error) {
        console.error('[AdBlock DNR] Error clearing rules:', error);
        return false;
    }
}

/**
 * Convert ABP-style filter to DNR urlFilter
 * @param {string} filter - ABP filter syntax
 * @returns {string} - DNR urlFilter syntax
 */
function convertAbpToDnr(filter) {
    let urlFilter = filter;

    // Remove common ABP prefixes/suffixes
    urlFilter = urlFilter.replace(/^\|\|/, '');
    urlFilter = urlFilter.replace(/\^$/, '');

    // Convert wildcard
    urlFilter = urlFilter.replace(/\*/g, '*');

    // Add domain prefix if needed
    if (!urlFilter.includes('*') && !urlFilter.startsWith('|')) {
        urlFilter = `*://*.${urlFilter}/*`;
    }

    return urlFilter;
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AdBlockDnrBuilder = {
        buildBlockRule,
        buildAllowRule,
        generateAllowlistRules,
        applyAllowlist,
        setRulesetEnabled,
        setCategoryEnabled,
        getEnabledRulesets,
        getRuleCounts,
        clearDynamicRules,
        convertAbpToDnr,
        RULE_ID_RANGES,
        LIMITS,
        CATEGORY_RULESETS
    };
}

export {
    buildBlockRule,
    buildAllowRule,
    generateAllowlistRules,
    applyAllowlist,
    setRulesetEnabled,
    setCategoryEnabled,
    getEnabledRulesets,
    getRuleCounts,
    clearDynamicRules,
    convertAbpToDnr,
    RULE_ID_RANGES,
    LIMITS,
    CATEGORY_RULESETS
};
