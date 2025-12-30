/**
 * ZAS Safeguard - Filter List Manager
 * Fetches, caches, and manages community filter lists
 * 
 * Features:
 * - Fetches EasyList, EasyPrivacy, and other lists
 * - Caches parsed rules in Chrome storage
 * - Auto-updates via Chrome alarms
 * - Deduplicates rules across lists
 */

// Available filter lists
const FILTER_LISTS = {
    easylist: {
        name: 'EasyList',
        url: 'https://easylist.to/easylist/easylist.txt',
        enabled: true,
        category: 'ads'
    },
    easyprivacy: {
        name: 'EasyPrivacy',
        url: 'https://easylist.to/easylist/easyprivacy.txt',
        enabled: true,
        category: 'trackers'
    },
    fanboy_annoyance: {
        name: 'Fanboy Annoyance',
        url: 'https://easylist.to/easylist/fanboy-annoyance.txt',
        enabled: false, // Opt-in
        category: 'annoyances'
    },
    peter_lowe: {
        name: "Peter Lowe's Ad Server List",
        url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
        enabled: true,
        category: 'ads'
    }
};

// Storage keys
const STORAGE_KEYS = {
    FILTER_CACHE: 'adblock_filter_cache',
    FILTER_METADATA: 'adblock_filter_metadata',
    LAST_UPDATE: 'adblock_last_update',
    ENABLED_LISTS: 'adblock_enabled_lists'
};

// Update interval (24 hours)
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Initialize filter list manager
 * Sets up alarms and loads cached rules
 */
async function initFilterListManager() {
    console.log('[FilterListManager] Initializing...');

    // Set up update alarm
    if (typeof chrome !== 'undefined' && chrome.alarms) {
        chrome.alarms.create('filterListUpdate', {
            periodInMinutes: 24 * 60 // Daily
        });

        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === 'filterListUpdate') {
                updateAllFilterLists();
            }
        });
    }

    // Check if we need to update
    const metadata = await getFilterMetadata();
    const now = Date.now();

    if (!metadata.lastUpdate || (now - metadata.lastUpdate) > UPDATE_INTERVAL_MS) {
        console.log('[FilterListManager] Lists need update');
        await updateAllFilterLists();
    } else {
        console.log('[FilterListManager] Using cached lists');
    }

    return await getCachedRules();
}

/**
 * Update all enabled filter lists
 */
async function updateAllFilterLists() {
    console.log('[FilterListManager] Updating all filter lists...');

    const enabledLists = await getEnabledLists();
    const allNetworkRules = [];
    const allCosmeticRules = [];
    const stats = { lists: {}, totalRules: 0 };

    for (const [listId, listConfig] of Object.entries(FILTER_LISTS)) {
        if (!enabledLists.includes(listId)) continue;

        try {
            console.log(`[FilterListManager] Fetching ${listConfig.name}...`);
            const result = await fetchAndParseList(listConfig.url, listId);

            if (result) {
                allNetworkRules.push(...result.networkRules);
                allCosmeticRules.push(...result.cosmeticRules);
                stats.lists[listId] = result.stats;
                console.log(`[FilterListManager] ${listConfig.name}: ${result.stats.networkRules} network, ${result.stats.cosmeticRules} cosmetic`);
            }
        } catch (error) {
            console.error(`[FilterListManager] Failed to fetch ${listConfig.name}:`, error);
        }
    }

    // Deduplicate rules
    const deduped = deduplicateRules(allNetworkRules);
    stats.totalRules = deduped.length;
    stats.duplicatesRemoved = allNetworkRules.length - deduped.length;

    console.log(`[FilterListManager] Total: ${deduped.length} rules (${stats.duplicatesRemoved} duplicates removed)`);

    // Cache the results
    await cacheRules(deduped, allCosmeticRules, stats);

    // Apply rules to DNR
    await applyRulesToDNR(deduped);

    return { networkRules: deduped, cosmeticRules: allCosmeticRules, stats };
}

/**
 * Fetch and parse a single filter list
 */
async function fetchAndParseList(url, listId) {
    try {
        const response = await fetch(url, {
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();

        // Use the parser
        if (typeof self !== 'undefined' && self.FilterListParser) {
            return self.FilterListParser.parseFilterList(text, 10000); // Max 10K per list
        } else {
            console.error('[FilterListManager] Parser not loaded');
            return null;
        }
    } catch (error) {
        console.error(`[FilterListManager] Fetch error for ${listId}:`, error);
        return null;
    }
}

/**
 * Deduplicate rules based on urlFilter
 */
function deduplicateRules(rules) {
    const seen = new Set();
    const unique = [];
    let idCounter = 200000; // Start at 200000 for dynamic filter rules

    for (const rule of rules) {
        const key = rule.condition?.urlFilter || JSON.stringify(rule.condition);

        if (!seen.has(key)) {
            seen.add(key);
            // Reassign IDs to ensure uniqueness
            rule.id = idCounter++;
            unique.push(rule);
        }
    }

    return unique;
}

/**
 * Apply parsed rules to Chrome DNR
 */
async function applyRulesToDNR(rules) {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) {
        console.log('[FilterListManager] DNR not available');
        return;
    }

    try {
        // Get existing dynamic rules
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();

        // Filter out old filter list rules (IDs >= 200000)
        const rulesToRemove = existingRules
            .filter(r => r.id >= 200000)
            .map(r => r.id);

        // Chrome has a limit of 5000 dynamic rules
        const MAX_DYNAMIC_RULES = 5000;
        const rulesToAdd = rules.slice(0, MAX_DYNAMIC_RULES);

        // Update rules
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: rulesToRemove,
            addRules: rulesToAdd
        });

        console.log(`[FilterListManager] Applied ${rulesToAdd.length} dynamic rules`);

        if (rules.length > MAX_DYNAMIC_RULES) {
            console.warn(`[FilterListManager] Truncated ${rules.length - MAX_DYNAMIC_RULES} rules due to Chrome limit`);
        }
    } catch (error) {
        console.error('[FilterListManager] Failed to apply DNR rules:', error);
    }
}

/**
 * Cache parsed rules to storage
 */
async function cacheRules(networkRules, cosmeticRules, stats) {
    try {
        await chrome.storage.local.set({
            [STORAGE_KEYS.FILTER_CACHE]: {
                networkRules: networkRules.slice(0, 5000), // Limit cache size
                cosmeticRules: cosmeticRules.slice(0, 2000)
            },
            [STORAGE_KEYS.FILTER_METADATA]: {
                stats,
                lastUpdate: Date.now()
            }
        });
        console.log('[FilterListManager] Rules cached');
    } catch (error) {
        console.error('[FilterListManager] Cache error:', error);
    }
}

/**
 * Get cached rules from storage
 */
async function getCachedRules() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.FILTER_CACHE);
        return result[STORAGE_KEYS.FILTER_CACHE] || { networkRules: [], cosmeticRules: [] };
    } catch (error) {
        console.error('[FilterListManager] Error reading cache:', error);
        return { networkRules: [], cosmeticRules: [] };
    }
}

/**
 * Get filter metadata
 */
async function getFilterMetadata() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.FILTER_METADATA);
        return result[STORAGE_KEYS.FILTER_METADATA] || {};
    } catch (error) {
        return {};
    }
}

/**
 * Get enabled filter lists
 */
async function getEnabledLists() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.ENABLED_LISTS);
        if (result[STORAGE_KEYS.ENABLED_LISTS]) {
            return result[STORAGE_KEYS.ENABLED_LISTS];
        }
    } catch (error) {
        console.error('[FilterListManager] Error reading enabled lists:', error);
    }

    // Return default enabled lists
    return Object.entries(FILTER_LISTS)
        .filter(([_, config]) => config.enabled)
        .map(([id]) => id);
}

/**
 * Enable or disable a filter list
 */
async function setListEnabled(listId, enabled) {
    const enabledLists = await getEnabledLists();

    if (enabled && !enabledLists.includes(listId)) {
        enabledLists.push(listId);
    } else if (!enabled) {
        const index = enabledLists.indexOf(listId);
        if (index > -1) {
            enabledLists.splice(index, 1);
        }
    }

    await chrome.storage.local.set({
        [STORAGE_KEYS.ENABLED_LISTS]: enabledLists
    });

    // Trigger update
    await updateAllFilterLists();
}

/**
 * Force update filter lists
 */
async function forceUpdate() {
    return await updateAllFilterLists();
}

/**
 * Get list of available filter lists with status
 */
async function getAvailableLists() {
    const enabledLists = await getEnabledLists();
    const metadata = await getFilterMetadata();

    return Object.entries(FILTER_LISTS).map(([id, config]) => ({
        id,
        ...config,
        enabled: enabledLists.includes(id),
        ruleCount: metadata.stats?.lists?.[id]?.networkRules || 0
    }));
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initFilterListManager,
        updateAllFilterLists,
        setListEnabled,
        forceUpdate,
        getAvailableLists,
        getCachedRules,
        FILTER_LISTS
    };
}

// Expose globally for service worker
if (typeof self !== 'undefined') {
    self.FilterListManager = {
        init: initFilterListManager,
        update: updateAllFilterLists,
        setListEnabled,
        forceUpdate,
        getAvailableLists,
        getCachedRules,
        FILTER_LISTS
    };
}
