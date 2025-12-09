/**
 * ZAS Safeguard - Background Service Worker
 * 
 * Handles:
 * - URL blocking via declarativeNetRequest
 * - Firebase sync for blocklists
 * - Tamper/uninstall detection
 * - Device ID management
 * - Offline fallback blocking
 */

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    FIREBASE_API_ENDPOINT: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net',
    SYNC_INTERVAL_MINUTES: 15,
    OFFLINE_BLOCKLIST_KEY: 'offline_blocklist',
    DEVICE_ID_KEY: 'device_id',
    USER_TOKEN_KEY: 'user_token',
    POLICY_KEY: 'block_policy',
    LAST_SYNC_KEY: 'last_sync',
};

// Default porn blocklist for offline/initial use
const DEFAULT_BLOCKLIST = [
    '*://*.pornhub.com/*', '*://*.xvideos.com/*', '*://*.xnxx.com/*',
    '*://*.xhamster.com/*', '*://*.redtube.com/*', '*://*.youporn.com/*',
    '*://*.tube8.com/*', '*://*.spankbang.com/*', '*://*.porn.com/*',
    '*://*.brazzers.com/*', '*://*.bangbros.com/*', '*://*.realitykings.com/*',
    '*://*.pornmd.com/*', '*://*.beeg.com/*', '*://*.eporner.com/*',
    '*://*.tnaflix.com/*', '*://*.drtuber.com/*', '*://*.hqporner.com/*',
    '*://*.vporn.com/*', '*://*.youjizz.com/*', '*://*.porntube.com/*',
];

// ============================================
// INITIALIZATION
// ============================================

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('ZAS Safeguard installed:', details.reason);

    if (details.reason === 'install') {
        // Generate device ID
        const deviceId = generateDeviceId();
        await chrome.storage.local.set({ [CONFIG.DEVICE_ID_KEY]: deviceId });

        // Set up default blocking rules
        await updateBlockingRules(DEFAULT_BLOCKLIST);

        // Open onboarding page
        chrome.tabs.create({ url: 'popup/popup.html?onboarding=true' });
    }

    // Set up periodic sync
    chrome.alarms.create('syncBlocklist', { periodInMinutes: CONFIG.SYNC_INTERVAL_MINUTES });
    chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'syncBlocklist') {
        await syncWithFirebase();
    } else if (alarm.name === 'heartbeat') {
        await sendHeartbeat();
    }
});

// ============================================
// DEVICE ID GENERATION
// ============================================

function generateDeviceId() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getDeviceId() {
    const result = await chrome.storage.local.get(CONFIG.DEVICE_ID_KEY);
    return result[CONFIG.DEVICE_ID_KEY];
}

// ============================================
// BLOCKING RULES MANAGEMENT
// ============================================

async function updateBlockingRules(blockedDomains) {
    try {
        // Convert domains to declarativeNetRequest rules
        const rules = blockedDomains.map((domain, index) => {
            // Clean domain pattern
            let urlFilter = domain;
            if (!domain.includes('*')) {
                urlFilter = `*://*.${domain}/*`;
            }

            return {
                id: index + 1,
                priority: 1,
                action: {
                    type: 'redirect',
                    redirect: {
                        extensionPath: '/blocked/blocked.html'
                    }
                },
                condition: {
                    urlFilter,
                    resourceTypes: ['main_frame', 'sub_frame']
                }
            };
        });

        // Clear existing dynamic rules
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = existingRules.map(rule => rule.id);

        if (existingIds.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: existingIds
            });
        }

        // Add new rules (max 5000 dynamic rules)
        const maxRules = Math.min(rules.length, 4999);
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: rules.slice(0, maxRules)
        });

        console.log(`Updated ${maxRules} blocking rules`);

        // Store for offline use
        await chrome.storage.local.set({
            [CONFIG.OFFLINE_BLOCKLIST_KEY]: blockedDomains,
            [CONFIG.LAST_SYNC_KEY]: Date.now()
        });

        return true;
    } catch (error) {
        console.error('Failed to update blocking rules:', error);
        return false;
    }
}

// ============================================
// FIREBASE SYNC
// ============================================

async function syncWithFirebase() {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token) {
            console.log('No auth token, skipping sync');
            return false;
        }

        // Call Firebase function to get block policy
        const response = await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/getBlockPolicy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ deviceId })
        });

        if (!response.ok) {
            throw new Error(`Sync failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.success && data.policy) {
            // Update blocking rules
            await updateBlockingRules(data.policy.blockedDomains || []);

            // Store policy
            await chrome.storage.local.set({
                [CONFIG.POLICY_KEY]: data.policy
            });

            console.log('Firebase sync successful');
            return true;
        }
    } catch (error) {
        console.error('Firebase sync error:', error);

        // On sync failure, ensure offline blocklist is active
        await ensureOfflineBlocking();
        return false;
    }
}

async function ensureOfflineBlocking() {
    const storage = await chrome.storage.local.get(CONFIG.OFFLINE_BLOCKLIST_KEY);
    const offlineList = storage[CONFIG.OFFLINE_BLOCKLIST_KEY];

    if (!offlineList || offlineList.length === 0) {
        // No offline list, use default
        await updateBlockingRules(DEFAULT_BLOCKLIST);
    }
}

// ============================================
// HEARTBEAT & MONITORING
// ============================================

async function sendHeartbeat() {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token) return;

        // This updates lastSeen in Firestore
        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logBlockEvent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                deviceId,
                type: 'heartbeat',
                metadata: { timestamp: Date.now() }
            })
        });
    } catch (error) {
        // Silently fail heartbeat
    }
}

// ============================================
// TAMPER DETECTION
// ============================================

// Monitor for extension disable attempts
chrome.management.onDisabled.addListener((info) => {
    if (info.id === chrome.runtime.id) {
        // Extension was disabled - log this event
        logTamperAttempt('extension_disabled');

        // Try to re-enable (won't work if user disabled, but logs the attempt)
        chrome.management.setEnabled(chrome.runtime.id, true);
    }
});

// Monitor for uninstall (before it happens if possible)
chrome.runtime.onSuspend.addListener(() => {
    logTamperAttempt('extension_suspend');
});

async function logTamperAttempt(type) {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token) return;

        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logBlockEvent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                deviceId,
                type: 'tamper',
                action: type,
                metadata: { timestamp: Date.now() }
            })
        });
    } catch (error) {
        console.error('Failed to log tamper attempt:', error);
    }
}

// ============================================
// WEB NAVIGATION MONITORING
// ============================================

// Additional URL checking via webNavigation
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Only check main frame
    if (details.frameId !== 0) return;

    const url = new URL(details.url);
    const hostname = url.hostname.replace('www.', '');

    // Check against local blocklist
    const storage = await chrome.storage.local.get(CONFIG.OFFLINE_BLOCKLIST_KEY);
    const blocklist = storage[CONFIG.OFFLINE_BLOCKLIST_KEY] || DEFAULT_BLOCKLIST;

    for (const blocked of blocklist) {
        const pattern = blocked.replace('*://*.', '').replace('/*', '');
        if (hostname.includes(pattern) || pattern.includes(hostname)) {
            // Log the block
            logBlockedUrl(details.url, hostname);

            // Redirect to blocked page
            chrome.tabs.update(details.tabId, {
                url: chrome.runtime.getURL('blocked/blocked.html')
            });
            return;
        }
    }
});

async function logBlockedUrl(url, hostname) {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token) return;

        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logBlockEvent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                deviceId,
                url: hostname, // Don't log full URL for privacy
                category: 'blocked',
                action: 'navigate_blocked'
            })
        });
    } catch (error) {
        // Silent fail
    }
}

// ============================================
// MESSAGE HANDLING FROM POPUP/CONTENT SCRIPTS
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
    switch (message.type) {
        case 'GET_STATUS':
            return await getStatus();

        case 'LOGIN':
            return await handleLogin(message.token, message.deviceId);

        case 'LOGOUT':
            return await handleLogout();

        case 'SYNC_NOW':
            return await syncWithFirebase();

        case 'REQUEST_UNLOCK':
            return await requestUnlock();

        case 'GET_DEVICE_ID':
            return { deviceId: await getDeviceId() };

        case 'DEV_TOOLS_OPENED':
            await logTamperAttempt('dev_tools_opened');
            return { logged: true };

        default:
            return { error: 'Unknown message type' };
    }
}

async function getStatus() {
    const storage = await chrome.storage.local.get([
        CONFIG.USER_TOKEN_KEY,
        CONFIG.POLICY_KEY,
        CONFIG.LAST_SYNC_KEY,
        CONFIG.DEVICE_ID_KEY
    ]);

    return {
        isAuthenticated: !!storage[CONFIG.USER_TOKEN_KEY],
        policy: storage[CONFIG.POLICY_KEY] || null,
        lastSync: storage[CONFIG.LAST_SYNC_KEY] || null,
        deviceId: storage[CONFIG.DEVICE_ID_KEY] || null,
        isBlocking: true // Always blocking
    };
}

async function handleLogin(token, userId) {
    await chrome.storage.local.set({
        [CONFIG.USER_TOKEN_KEY]: token
    });

    // Sync immediately
    await syncWithFirebase();

    return { success: true };
}

async function handleLogout() {
    // In owner mode, logout is not allowed
    const storage = await chrome.storage.local.get(CONFIG.POLICY_KEY);
    const policy = storage[CONFIG.POLICY_KEY];

    if (policy?.ultra_strict) {
        return { success: false, error: 'Logout disabled in Owner Mode' };
    }

    await chrome.storage.local.remove([CONFIG.USER_TOKEN_KEY, CONFIG.POLICY_KEY]);

    // Keep blocking with default list
    await updateBlockingRules(DEFAULT_BLOCKLIST);

    return { success: true };
}

async function requestUnlock() {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token) {
            return { success: false, error: 'Not authenticated' };
        }

        const response = await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/requestUnlock`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ deviceId })
        });

        return await response.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// STARTUP
// ============================================

// Ensure blocking is active on service worker start
(async () => {
    await ensureOfflineBlocking();
    console.log('ZAS Safeguard background service worker started');
})();
