/**
 * ZAS Safeguard - Ad Blocker Engine
 * 
 * Main orchestrator for the ad blocking system:
 * - Initializes DNR rulesets on startup
 * - Coordinates static/dynamic rules
 * - Exposes APIs for settings management
 * - Integrates with Firebase sync
 */

import * as DnrBuilder from './dnrBuilder.js';
import * as SiteModes from './siteModes.js';
import * as AntiBreakage from './antiBreakage.js';
import * as Stats from './stats.js';

const ENGINE_CONFIG_KEY = 'adblock_engine_config';
const ENGINE_ALLOWLIST_KEY = 'adblock_allowlist';

// Default configuration
const DEFAULT_CONFIG = {
    enabled: true,
    categories: {
        ads: true,
        trackers: true,
        malware: true,
        annoyances: false,
        social: false
    },
    cosmeticEnabled: true,
    antiBreakageEnabled: true
};

// Engine state
let engineConfig = { ...DEFAULT_CONFIG };
let isInitialized = false;

/**
 * Initialize the ad blocker engine
 */
async function init() {
    if (isInitialized) return;

    try {
        console.log('[AdBlock Engine] Initializing...');

        // Load saved config
        const result = await chrome.storage.local.get([ENGINE_CONFIG_KEY]);
        if (result[ENGINE_CONFIG_KEY]) {
            engineConfig = { ...DEFAULT_CONFIG, ...result[ENGINE_CONFIG_KEY] };
        }

        // Apply initial ruleset state
        await applyConfig();

        // Set up DNR feedback listener for stats
        setupDnrFeedback();

        // Clean up old stats periodically
        Stats.cleanupOldStats();

        isInitialized = true;
        console.log('[AdBlock Engine] Initialized successfully');

        return true;
    } catch (error) {
        console.error('[AdBlock Engine] Init error:', error);
        return false;
    }
}

/**
 * Apply current configuration to DNR rulesets
 * Includes subscription entitlement check — premium categories only
 * enabled if user has security_intelligence capability.
 */
async function applyConfig() {
    if (!engineConfig.enabled) {
        await disableAll();
        return;
    }

    // ── Entitlement gate: check if user has premium capabilities ──
    const PREMIUM_CATEGORIES = ['ads', 'trackers', 'malware', 'youtube'];
    let hasPremium = false;

    try {
        const stored = await chrome.storage.local.get(['_verifiedSubscription']);
        const sub = stored._verifiedSubscription;
        if (sub && sub.capabilities && sub.capabilities.security_intelligence === true) {
            hasPremium = true;
        }
    } catch (e) {
        console.warn('[AdBlock Engine] Could not check entitlement:', e.message);
    }

    // Apply each category setting
    for (const [category, enabled] of Object.entries(engineConfig.categories)) {
        // If this is a premium category, gate on entitlement
        if (PREMIUM_CATEGORIES.includes(category) && !hasPremium) {
            await DnrBuilder.setCategoryEnabled(category, false);
            continue;
        }
        await DnrBuilder.setCategoryEnabled(category, enabled);
    }

    // Apply allowlist
    const result = await chrome.storage.local.get([ENGINE_ALLOWLIST_KEY]);
    const allowlist = result[ENGINE_ALLOWLIST_KEY] || [];
    if (allowlist.length > 0) {
        await DnrBuilder.applyAllowlist(allowlist);
    }

    if (!hasPremium) {
        console.log('[AdBlock Engine] Premium categories disabled — no entitlement');
    }
}

/**
 * Set up DNR feedback listener for tracking blocked requests
 */
function setupDnrFeedback() {
    // Listen for matched rules via declarativeNetRequestFeedback
    if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
        chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
            // Determine category from rule ID
            const category = getCategoryFromRuleId(info.rule.ruleId, info.rule.rulesetId);

            // Increment stats
            Stats.incrementBlocked(category);
        });
    }
}

/**
 * Determine category from rule ID or ruleset ID
 */
function getCategoryFromRuleId(ruleId, rulesetId) {
    // Map ruleset IDs to categories
    const rulesetToCategory = {
        'adblock_ads': 'ads',
        'adblock_trackers': 'trackers',
        'adblock_malware': 'malware',
        'adblock_annoyances': 'annoyances',
        'adblock_social': 'social'
    };

    return rulesetToCategory[rulesetId] || 'ads';
}

/**
 * Enable the ad blocker
 */
async function enable() {
    engineConfig.enabled = true;
    await saveConfig();
    await applyConfig();
    console.log('[AdBlock Engine] Enabled');
}

/**
 * Disable the ad blocker
 */
async function disable() {
    engineConfig.enabled = false;
    await saveConfig();
    await disableAll();
    console.log('[AdBlock Engine] Disabled');
}

/**
 * Disable all ad blocking rulesets
 */
async function disableAll() {
    for (const category of Object.keys(engineConfig.categories)) {
        await DnrBuilder.setCategoryEnabled(category, false);
    }
    await DnrBuilder.clearDynamicRules();
}

/**
 * Set a category enabled/disabled
 * @param {string} category - Category name (ads, trackers, etc.)
 * @param {boolean} enabled - Whether to enable
 */
async function setCategory(category, enabled) {
    if (engineConfig.categories.hasOwnProperty(category)) {
        engineConfig.categories[category] = enabled;
        await saveConfig();
        await DnrBuilder.setCategoryEnabled(category, enabled);
        console.log('[AdBlock Engine] Category', category, enabled ? 'enabled' : 'disabled');
    }
}

/**
 * Add domain to allowlist
 * @param {string} domain - Domain to allow
 */
async function addToAllowlist(domain) {
    const result = await chrome.storage.local.get([ENGINE_ALLOWLIST_KEY]);
    const allowlist = result[ENGINE_ALLOWLIST_KEY] || [];

    if (!allowlist.includes(domain)) {
        allowlist.push(domain);
        await chrome.storage.local.set({ [ENGINE_ALLOWLIST_KEY]: allowlist });
        await DnrBuilder.applyAllowlist(allowlist);

        // Also set site mode to off
        await SiteModes.setMode(domain, SiteModes.MODES.OFF);

        console.log('[AdBlock Engine] Added to allowlist:', domain);
    }
}

/**
 * Remove domain from allowlist
 * @param {string} domain - Domain to remove
 */
async function removeFromAllowlist(domain) {
    const result = await chrome.storage.local.get([ENGINE_ALLOWLIST_KEY]);
    let allowlist = result[ENGINE_ALLOWLIST_KEY] || [];

    allowlist = allowlist.filter(d => d !== domain);
    await chrome.storage.local.set({ [ENGINE_ALLOWLIST_KEY]: allowlist });
    await DnrBuilder.applyAllowlist(allowlist);

    // Reset site mode to strict
    await SiteModes.setMode(domain, SiteModes.MODES.STRICT);

    console.log('[AdBlock Engine] Removed from allowlist:', domain);
}

/**
 * Get current allowlist
 * @returns {Promise<string[]>}
 */
async function getAllowlist() {
    const result = await chrome.storage.local.get([ENGINE_ALLOWLIST_KEY]);
    return result[ENGINE_ALLOWLIST_KEY] || [];
}

/**
 * Set site-specific mode
 * @param {string} domain - Domain
 * @param {string} mode - 'off', 'relaxed', or 'strict'
 */
async function setSiteMode(domain, mode) {
    await SiteModes.setMode(domain, mode);

    // If mode is 'off', add to allowlist for DNR
    if (mode === SiteModes.MODES.OFF) {
        await addToAllowlist(domain);
    } else {
        await removeFromAllowlist(domain);
    }
}

/**
 * Get site mode for a domain
 * @param {string} domain - Domain to check
 * @returns {Promise<string>}
 */
async function getSiteMode(domain) {
    return SiteModes.getMode(domain);
}

/**
 * Track page load for anti-breakage detection
 * @param {string} url - URL being loaded
 */
async function trackPageLoad(url) {
    if (engineConfig.antiBreakageEnabled) {
        await AntiBreakage.trackPageLoad(url);
    }
}

/**
 * Get current statistics
 * @returns {Promise<Object>}
 */
async function getStats() {
    return Stats.getDisplayStats();
}

/**
 * Get engine configuration
 * @returns {Object}
 */
function getConfig() {
    return { ...engineConfig };
}

/**
 * Update engine configuration
 * @param {Object} newConfig - Partial config to merge
 */
async function updateConfig(newConfig) {
    engineConfig = { ...engineConfig, ...newConfig };

    // Handle nested categories object
    if (newConfig.categories) {
        engineConfig.categories = { ...engineConfig.categories, ...newConfig.categories };
    }

    await saveConfig();
    await applyConfig();
}

/**
 * Save configuration to storage
 */
async function saveConfig() {
    await chrome.storage.local.set({ [ENGINE_CONFIG_KEY]: engineConfig });
}

/**
 * Get rule count information
 */
async function getRuleCounts() {
    return DnrBuilder.getRuleCounts();
}

/**
 * Check if engine is enabled
 */
function isEnabled() {
    return engineConfig.enabled;
}

/**
 * Handle messages from popup/dashboard
 */
function handleMessage(message, sender, sendResponse) {
    switch (message.action) {
        case 'adblock_enable':
            enable().then(() => sendResponse({ success: true }));
            return true;

        case 'adblock_disable':
            disable().then(() => sendResponse({ success: true }));
            return true;

        case 'adblock_setCategory':
            setCategory(message.category, message.enabled)
                .then(() => sendResponse({ success: true }));
            return true;

        case 'adblock_addAllowlist':
            addToAllowlist(message.domain)
                .then(() => sendResponse({ success: true }));
            return true;

        case 'adblock_removeAllowlist':
            removeFromAllowlist(message.domain)
                .then(() => sendResponse({ success: true }));
            return true;

        case 'adblock_getAllowlist':
            getAllowlist().then(list => sendResponse({ allowlist: list }));
            return true;

        case 'adblock_setSiteMode':
            setSiteMode(message.domain, message.mode)
                .then(() => sendResponse({ success: true }));
            return true;

        case 'adblock_getSiteMode':
            getSiteMode(message.domain)
                .then(mode => sendResponse({ mode }));
            return true;

        case 'adblock_getStats':
            getStats().then(stats => sendResponse({ stats }));
            return true;

        case 'adblock_getConfig':
            sendResponse({ config: getConfig() });
            return false;

        case 'adblock_updateConfig':
            updateConfig(message.config)
                .then(() => sendResponse({ success: true }));
            return true;

        case 'adblock_getRuleCounts':
            getRuleCounts().then(counts => sendResponse({ counts }));
            return true;

        default:
            return false;
    }
}

// Export for use in background.js
if (typeof window !== 'undefined') {
    window.AdBlockEngine = {
        init,
        enable,
        disable,
        isEnabled,
        getConfig,
        updateConfig,
        setCategory,
        addToAllowlist,
        removeFromAllowlist,
        getAllowlist,
        setSiteMode,
        getSiteMode,
        trackPageLoad,
        getStats,
        getRuleCounts,
        handleMessage,
        DEFAULT_CONFIG
    };
}

export {
    init,
    enable,
    disable,
    isEnabled,
    getConfig,
    updateConfig,
    setCategory,
    addToAllowlist,
    removeFromAllowlist,
    getAllowlist,
    setSiteMode,
    getSiteMode,
    trackPageLoad,
    getStats,
    getRuleCounts,
    handleMessage,
    DEFAULT_CONFIG
};
