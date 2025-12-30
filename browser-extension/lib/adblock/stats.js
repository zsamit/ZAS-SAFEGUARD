/**
 * ZAS Safeguard - Ad Blocker Stats Module
 * 
 * Privacy-respecting telemetry:
 * - Blocked count by category (no URLs stored)
 * - Breakage event counts
 * - Ruleset size + update timestamps
 */

const STATS_STORAGE_KEY = 'adblock_stats';
const DAILY_STATS_KEY = 'adblock_daily_stats';

/**
 * Get today's date string in YYYY-MM-DD format
 */
function getTodayKey() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Initialize or get current stats
 */
async function getStats() {
    try {
        const result = await chrome.storage.local.get([STATS_STORAGE_KEY, DAILY_STATS_KEY]);
        const todayKey = getTodayKey();

        const stats = result[STATS_STORAGE_KEY] || {
            totalBlocked: 0,
            categories: {
                ads: 0,
                trackers: 0,
                malware: 0,
                annoyances: 0,
                social: 0
            },
            breakageEvents: 0,
            lastUpdated: null
        };

        const dailyStats = result[DAILY_STATS_KEY] || {};

        // Initialize today's stats if needed
        if (!dailyStats[todayKey]) {
            dailyStats[todayKey] = {
                ads: 0,
                trackers: 0,
                malware: 0,
                annoyances: 0,
                social: 0,
                total: 0
            };
        }

        return { stats, dailyStats, todayKey };
    } catch (error) {
        console.error('[AdBlock Stats] Error getting stats:', error);
        return {
            stats: { totalBlocked: 0, categories: {}, breakageEvents: 0 },
            dailyStats: {},
            todayKey: getTodayKey()
        };
    }
}

/**
 * Increment blocked count for a category
 * @param {string} category - One of: ads, trackers, malware, annoyances, social
 */
async function incrementBlocked(category = 'ads') {
    try {
        const { stats, dailyStats, todayKey } = await getStats();

        // Update total stats
        stats.totalBlocked++;
        stats.categories[category] = (stats.categories[category] || 0) + 1;
        stats.lastUpdated = Date.now();

        // Update daily stats
        dailyStats[todayKey][category] = (dailyStats[todayKey][category] || 0) + 1;
        dailyStats[todayKey].total++;

        // Also update the existing 'stats' key for popup compatibility
        const existingStats = await chrome.storage.local.get(['stats']);
        const popupStats = existingStats.stats || { blockedToday: 0, blockedTotal: 0 };
        popupStats.blockedToday = dailyStats[todayKey].total;
        popupStats.blockedTotal = stats.totalBlocked;

        await chrome.storage.local.set({
            [STATS_STORAGE_KEY]: stats,
            [DAILY_STATS_KEY]: dailyStats,
            stats: popupStats  // For popup.js compatibility
        });

        return stats;
    } catch (error) {
        console.error('[AdBlock Stats] Error incrementing blocked:', error);
    }
}

/**
 * Log a breakage event
 * @param {string} domain - Domain where breakage occurred
 */
async function logBreakageEvent(domain) {
    try {
        const { stats, dailyStats, todayKey } = await getStats();

        stats.breakageEvents++;
        dailyStats[todayKey].breakageEvents = (dailyStats[todayKey].breakageEvents || 0) + 1;

        await chrome.storage.local.set({
            [STATS_STORAGE_KEY]: stats,
            [DAILY_STATS_KEY]: dailyStats
        });

        console.log('[AdBlock Stats] Breakage event logged for:', domain);
    } catch (error) {
        console.error('[AdBlock Stats] Error logging breakage:', error);
    }
}

/**
 * Get stats for display (popup/dashboard)
 */
async function getDisplayStats() {
    const { stats, dailyStats, todayKey } = await getStats();

    return {
        blockedToday: dailyStats[todayKey]?.total || 0,
        blockedTotal: stats.totalBlocked || 0,
        todayByCategory: dailyStats[todayKey] || {},
        totalByCategory: stats.categories || {},
        breakageEvents: stats.breakageEvents || 0
    };
}

/**
 * Clean up old daily stats (keep last 30 days)
 */
async function cleanupOldStats() {
    try {
        const result = await chrome.storage.local.get([DAILY_STATS_KEY]);
        const dailyStats = result[DAILY_STATS_KEY] || {};

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        const cutoffKey = cutoffDate.toISOString().split('T')[0];

        const cleaned = {};
        for (const [key, value] of Object.entries(dailyStats)) {
            if (key >= cutoffKey) {
                cleaned[key] = value;
            }
        }

        await chrome.storage.local.set({ [DAILY_STATS_KEY]: cleaned });
        console.log('[AdBlock Stats] Cleaned up old stats');
    } catch (error) {
        console.error('[AdBlock Stats] Error cleaning stats:', error);
    }
}

/**
 * Reset today's stats (for testing)
 */
async function resetTodayStats() {
    const todayKey = getTodayKey();
    const result = await chrome.storage.local.get([DAILY_STATS_KEY]);
    const dailyStats = result[DAILY_STATS_KEY] || {};

    dailyStats[todayKey] = {
        ads: 0,
        trackers: 0,
        malware: 0,
        annoyances: 0,
        social: 0,
        total: 0
    };

    await chrome.storage.local.set({
        [DAILY_STATS_KEY]: dailyStats,
        stats: { blockedToday: 0, blockedTotal: 0 }
    });
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AdBlockStats = {
        getStats,
        incrementBlocked,
        logBreakageEvent,
        getDisplayStats,
        cleanupOldStats,
        resetTodayStats
    };
}

// For ES module environments
export {
    getStats,
    incrementBlocked,
    logBreakageEvent,
    getDisplayStats,
    cleanupOldStats,
    resetTodayStats
};
