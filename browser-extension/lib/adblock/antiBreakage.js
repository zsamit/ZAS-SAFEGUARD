/**
 * ZAS Safeguard - Anti-Breakage Module
 * 
 * Protects against site breakage:
 * - Reload-loop detection (>3 reloads in 10s)
 * - Automatic fallback to relaxed mode
 * - Logs breakage events
 * - Notifies via existing alert system
 */

import { setMode, MODES } from './siteModes.js';
import { logBreakageEvent } from './stats.js';

const RELOAD_TRACKING_KEY = 'adblock_reload_tracking';
const BREAKAGE_DOMAINS_KEY = 'adblock_breakage_domains';

// Configuration
const CONFIG = {
    MAX_RELOADS: 3,           // Number of reloads to trigger breakage detection
    TIME_WINDOW_MS: 10000,    // Time window to count reloads (10 seconds)
    COOLDOWN_MS: 300000,      // Cooldown before re-checking domain (5 minutes)
    AUTO_RECOVERY_MS: 3600000 // Auto-recover from relaxed mode (1 hour)
};

// In-memory tracking
let reloadTracking = new Map();
let breakageDomains = new Set();
let initialized = false;

/**
 * Extract domain from URL
 */
function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
        return null;
    }
}

/**
 * Initialize from storage
 */
async function init() {
    if (initialized) return;

    try {
        const result = await chrome.storage.local.get([BREAKAGE_DOMAINS_KEY]);
        const stored = result[BREAKAGE_DOMAINS_KEY] || [];
        breakageDomains = new Set(stored);
        initialized = true;

        console.log('[AdBlock AntiBreakage] Initialized with', breakageDomains.size, 'known breakage domains');
    } catch (error) {
        console.error('[AdBlock AntiBreakage] Init error:', error);
    }
}

/**
 * Track a page load/reload event
 * @param {string} url - The URL being loaded
 * @returns {Promise<boolean>} - True if breakage was detected
 */
async function trackPageLoad(url) {
    await init();

    const domain = extractDomain(url);
    if (!domain) return false;

    // Skip if domain is already in breakage list
    if (breakageDomains.has(domain)) {
        return false;
    }

    const now = Date.now();

    // Get or create tracking entry
    if (!reloadTracking.has(domain)) {
        reloadTracking.set(domain, []);
    }

    const timestamps = reloadTracking.get(domain);

    // Add current timestamp
    timestamps.push(now);

    // Remove old timestamps outside window
    const cutoff = now - CONFIG.TIME_WINDOW_MS;
    const filtered = timestamps.filter(ts => ts > cutoff);
    reloadTracking.set(domain, filtered);

    // Check for reload loop
    if (filtered.length >= CONFIG.MAX_RELOADS) {
        console.log('[AdBlock AntiBreakage] Reload loop detected for:', domain);
        return await handleBreakage(domain);
    }

    return false;
}

/**
 * Handle detected breakage
 * @param {string} domain - Domain with breakage
 */
async function handleBreakage(domain) {
    try {
        // Add to breakage list
        breakageDomains.add(domain);
        await chrome.storage.local.set({
            [BREAKAGE_DOMAINS_KEY]: Array.from(breakageDomains)
        });

        // Switch domain to relaxed mode
        await setMode(domain, MODES.RELAXED);

        // Log the event
        await logBreakageEvent(domain);

        // Clear reload tracking for this domain
        reloadTracking.delete(domain);

        // Notify via existing alert system
        await notifyBreakage(domain);

        console.log('[AdBlock AntiBreakage] Domain', domain, 'switched to relaxed mode');

        // Schedule auto-recovery
        setTimeout(() => {
            recoverDomain(domain);
        }, CONFIG.AUTO_RECOVERY_MS);

        return true;
    } catch (error) {
        console.error('[AdBlock AntiBreakage] Error handling breakage:', error);
        return false;
    }
}

/**
 * Attempt to recover a domain from relaxed mode
 * @param {string} domain - Domain to recover
 */
async function recoverDomain(domain) {
    // Check if domain is still in breakage list
    if (!breakageDomains.has(domain)) {
        return;
    }

    console.log('[AdBlock AntiBreakage] Attempting recovery for:', domain);

    // Remove from breakage list but keep in relaxed mode
    // User can manually switch back to strict if desired
    breakageDomains.delete(domain);
    await chrome.storage.local.set({
        [BREAKAGE_DOMAINS_KEY]: Array.from(breakageDomains)
    });
}

/**
 * Notify about breakage via existing alert system
 * @param {string} domain - Affected domain
 */
async function notifyBreakage(domain) {
    try {
        // Use existing security event logging
        chrome.runtime.sendMessage({
            type: 'ADBLOCK_BREAKAGE',
            domain: domain,
            timestamp: Date.now()
        }).catch(() => {
            // Ignore errors - message handler may not be ready
        });
    } catch (error) {
        console.error('[AdBlock AntiBreakage] Notify error:', error);
    }
}

/**
 * Check if a domain has known breakage issues
 * @param {string} urlOrDomain - URL or domain to check
 * @returns {Promise<boolean>}
 */
async function hasBreakage(urlOrDomain) {
    await init();

    const domain = urlOrDomain.includes('://')
        ? extractDomain(urlOrDomain)
        : urlOrDomain;

    return breakageDomains.has(domain);
}

/**
 * Manually report breakage for a domain
 * @param {string} domain - Domain to report
 */
async function reportBreakage(domain) {
    await init();
    return handleBreakage(domain);
}

/**
 * Clear breakage status for a domain
 * @param {string} domain - Domain to clear
 */
async function clearBreakage(domain) {
    await init();

    breakageDomains.delete(domain);
    await chrome.storage.local.set({
        [BREAKAGE_DOMAINS_KEY]: Array.from(breakageDomains)
    });

    // Optionally restore to strict mode
    await setMode(domain, MODES.STRICT);

    console.log('[AdBlock AntiBreakage] Breakage cleared for:', domain);
}

/**
 * Get all domains with breakage
 * @returns {Promise<string[]>}
 */
async function getBreakageDomains() {
    await init();
    return Array.from(breakageDomains);
}

/**
 * Clear all breakage data
 */
async function clearAll() {
    reloadTracking.clear();
    breakageDomains.clear();
    await chrome.storage.local.set({ [BREAKAGE_DOMAINS_KEY]: [] });
    console.log('[AdBlock AntiBreakage] All data cleared');
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AdBlockAntiBreakage = {
        trackPageLoad,
        hasBreakage,
        reportBreakage,
        clearBreakage,
        getBreakageDomains,
        clearAll,
        CONFIG
    };
}

export {
    trackPageLoad,
    hasBreakage,
    reportBreakage,
    clearBreakage,
    getBreakageDomains,
    clearAll,
    CONFIG
};
