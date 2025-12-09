/**
 * ZAS Safeguard - Error Logger
 * 
 * Centralized error handling with:
 * - Timeout wrapper
 * - Retry logic with exponential backoff
 * - Local fallback handling
 * - Firestore error logging
 */

// ============================================
// ERROR LOGGING
// ============================================

const ERROR_LOG_KEY = 'error_logs';
const MAX_LOCAL_ERRORS = 50;

/**
 * Log error locally (for later sync to Firestore)
 */
async function logErrorLocally(error, context = {}) {
    try {
        const storage = await chrome.storage.local.get(ERROR_LOG_KEY);
        const logs = storage[ERROR_LOG_KEY] || [];

        logs.push({
            timestamp: Date.now(),
            message: error.message || String(error),
            stack: error.stack || null,
            context,
            synced: false
        });

        // Keep only last N errors
        const trimmedLogs = logs.slice(-MAX_LOCAL_ERRORS);
        await chrome.storage.local.set({ [ERROR_LOG_KEY]: trimmedLogs });

        console.error('[ZAS Error]', error.message, context);
    } catch (e) {
        console.error('[ZAS] Failed to log error:', e);
    }
}

/**
 * Sync local errors to Firestore
 */
async function syncErrorsToFirestore(token, userId) {
    if (!token) return;

    try {
        const storage = await chrome.storage.local.get(ERROR_LOG_KEY);
        const logs = storage[ERROR_LOG_KEY] || [];
        const unsyncedLogs = logs.filter(l => !l.synced);

        if (unsyncedLogs.length === 0) return;

        const response = await fetch(`https://us-central1-zas-safeguard.cloudfunctions.net/logErrors`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId,
                errors: unsyncedLogs.slice(0, 20) // Batch 20 at a time
            })
        });

        if (response.ok) {
            // Mark as synced
            logs.forEach(l => l.synced = true);
            await chrome.storage.local.set({ [ERROR_LOG_KEY]: logs });
        }
    } catch (e) {
        // Silent fail - errors will sync later
    }
}

// ============================================
// FETCH WITH TIMEOUT & RETRY
// ============================================

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw error;
    }
}

/**
 * Fetch with retry and exponential backoff
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, timeoutMs = 10000) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetchWithTimeout(url, options, timeoutMs);
            return response;
        } catch (error) {
            lastError = error;

            // Log the failure
            await logErrorLocally(error, {
                url,
                attempt: attempt + 1,
                maxRetries
            });

            // Exponential backoff: 1s, 2s, 4s
            if (attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

/**
 * Safe fetch - never throws, returns null on failure
 */
async function safeFetch(url, options = {}, fallback = null) {
    try {
        const response = await fetchWithRetry(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        await logErrorLocally(error, { url, action: 'safeFetch' });
        return fallback;
    }
}

// ============================================
// VERSION CHECK
// ============================================

/**
 * Check if extension needs update
 */
async function checkForUpdates(currentVersion) {
    try {
        const response = await fetchWithTimeout(
            `https://us-central1-zas-safeguard.cloudfunctions.net/versionCheck?component=extension&clientVersion=${currentVersion}`,
            {},
            5000
        );

        if (!response.ok) return { updateRequired: false };

        const data = await response.json();

        if (data.updateRequired) {
            console.warn('[ZAS] Extension update REQUIRED. Please update to continue.');
            // Could show notification to user here
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        } else if (data.updateRecommended) {
            console.log('[ZAS] Extension update available:', data.latestVersion);
            chrome.action.setBadgeText({ text: 'new' });
            chrome.action.setBadgeBackgroundColor({ color: '#00BCD4' });
        }

        return data;
    } catch (error) {
        await logErrorLocally(error, { action: 'checkForUpdates' });
        return { updateRequired: false };
    }
}

// ============================================
// CACHE MANAGEMENT
// ============================================

/**
 * Check if cache is expired
 */
async function isCacheExpired(expiryHours = 24) {
    const storage = await chrome.storage.local.get('last_sync');
    const lastSync = storage.last_sync;

    if (!lastSync) return true;

    const expiryMs = expiryHours * 60 * 60 * 1000;
    return Date.now() - lastSync > expiryMs;
}

/**
 * Clear expired cache and force refresh
 */
async function handleCacheExpiry() {
    const expired = await isCacheExpired(24);

    if (expired) {
        console.log('[ZAS] Cache expired, forcing refresh...');
        return true; // Signal that sync is needed
    }

    return false;
}

// Export for use in background.js
if (typeof module !== 'undefined') {
    module.exports = {
        logErrorLocally,
        syncErrorsToFirestore,
        fetchWithTimeout,
        fetchWithRetry,
        safeFetch,
        checkForUpdates,
        isCacheExpired,
        handleCacheExpiry
    };
}
