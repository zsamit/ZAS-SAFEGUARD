/**
 * ZAS Safeguard - Site Modes Module
 * 
 * Per-domain mode management:
 * - off: No blocking on this domain
 * - relaxed: Trackers only
 * - strict: Full blocking (default)
 */

const SITE_MODES_KEY = 'adblock_site_modes';

// Valid modes
const MODES = {
    OFF: 'off',
    RELAXED: 'relaxed',
    STRICT: 'strict'
};

// In-memory cache for fast lookups
let siteModeCache = new Map();
let cacheInitialized = false;

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string} - Domain without protocol
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace(/^www\./, '');
    } catch (e) {
        return url;
    }
}

/**
 * Initialize cache from storage
 */
async function initCache() {
    if (cacheInitialized) return;

    try {
        const result = await chrome.storage.local.get([SITE_MODES_KEY]);
        const modes = result[SITE_MODES_KEY] || {};

        siteModeCache = new Map(Object.entries(modes));
        cacheInitialized = true;

        console.log('[AdBlock SiteModes] Cache initialized with', siteModeCache.size, 'entries');
    } catch (error) {
        console.error('[AdBlock SiteModes] Error initializing cache:', error);
    }
}

/**
 * Get mode for a domain
 * @param {string} urlOrDomain - URL or domain
 * @returns {Promise<string>} - Mode: 'off', 'relaxed', or 'strict'
 */
async function getMode(urlOrDomain) {
    await initCache();

    const domain = urlOrDomain.includes('://') ? extractDomain(urlOrDomain) : urlOrDomain;

    // Check exact match first
    if (siteModeCache.has(domain)) {
        return siteModeCache.get(domain);
    }

    // Check parent domains (e.g., sub.example.com -> example.com)
    const parts = domain.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
        const parentDomain = parts.slice(i).join('.');
        if (siteModeCache.has(parentDomain)) {
            return siteModeCache.get(parentDomain);
        }
    }

    // Default to strict mode
    return MODES.STRICT;
}

/**
 * Set mode for a domain
 * @param {string} urlOrDomain - URL or domain
 * @param {string} mode - 'off', 'relaxed', or 'strict'
 */
async function setMode(urlOrDomain, mode) {
    if (!Object.values(MODES).includes(mode)) {
        console.error('[AdBlock SiteModes] Invalid mode:', mode);
        return false;
    }

    await initCache();

    const domain = urlOrDomain.includes('://') ? extractDomain(urlOrDomain) : urlOrDomain;

    // Update cache
    if (mode === MODES.STRICT) {
        // Remove from cache if setting to default
        siteModeCache.delete(domain);
    } else {
        siteModeCache.set(domain, mode);
    }

    // Persist to storage
    const modesObj = Object.fromEntries(siteModeCache);
    await chrome.storage.local.set({ [SITE_MODES_KEY]: modesObj });

    console.log('[AdBlock SiteModes] Set', domain, 'to', mode);
    return true;
}

/**
 * Remove mode override for a domain (revert to default strict)
 * @param {string} urlOrDomain - URL or domain
 */
async function removeMode(urlOrDomain) {
    return setMode(urlOrDomain, MODES.STRICT);
}

/**
 * Check if blocking should be applied for a domain
 * @param {string} urlOrDomain - URL or domain
 * @param {string} ruleCategory - Category of the rule (ads, trackers, etc.)
 * @returns {Promise<boolean>} - True if blocking should be applied
 */
async function shouldBlock(urlOrDomain, ruleCategory = 'ads') {
    const mode = await getMode(urlOrDomain);

    switch (mode) {
        case MODES.OFF:
            return false;
        case MODES.RELAXED:
            // Only block trackers in relaxed mode
            return ruleCategory === 'trackers';
        case MODES.STRICT:
        default:
            return true;
    }
}

/**
 * Get all domain modes
 * @returns {Promise<Object>} - Map of domain -> mode
 */
async function getAllModes() {
    await initCache();
    return Object.fromEntries(siteModeCache);
}

/**
 * Get domains by mode
 * @param {string} mode - Mode to filter by
 * @returns {Promise<string[]>} - List of domains with that mode
 */
async function getDomainsByMode(mode) {
    await initCache();

    const domains = [];
    for (const [domain, domainMode] of siteModeCache) {
        if (domainMode === mode) {
            domains.push(domain);
        }
    }
    return domains;
}

/**
 * Clear all site mode overrides
 */
async function clearAllModes() {
    siteModeCache.clear();
    await chrome.storage.local.set({ [SITE_MODES_KEY]: {} });
    console.log('[AdBlock SiteModes] All modes cleared');
}

/**
 * Listen for storage changes to keep cache in sync
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes[SITE_MODES_KEY]) {
        const newModes = changes[SITE_MODES_KEY].newValue || {};
        siteModeCache = new Map(Object.entries(newModes));
        console.log('[AdBlock SiteModes] Cache synced from storage');
    }
});

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AdBlockSiteModes = {
        MODES,
        getMode,
        setMode,
        removeMode,
        shouldBlock,
        getAllModes,
        getDomainsByMode,
        clearAllModes,
        extractDomain
    };
}

export {
    MODES,
    getMode,
    setMode,
    removeMode,
    shouldBlock,
    getAllModes,
    getDomainsByMode,
    clearAllModes,
    extractDomain
};
