/**
 * ZAS Safeguard - Background Service Worker
 * 
 * Handles:
 * - URL blocking via declarativeNetRequest
 * - Firebase sync for blocklists
 * - Tamper/uninstall detection
 * - Device ID management
 * - Offline fallback blocking
 * - Version management
 */

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    FIREBASE_API_ENDPOINT: 'https://us-central1-zas-safeguard.cloudfunctions.net',
    SYNC_INTERVAL_MINUTES: 15,
    OFFLINE_BLOCKLIST_KEY: 'offline_blocklist',
    DEVICE_ID_KEY: 'device_id',
    USER_TOKEN_KEY: 'user_token',
    POLICY_KEY: 'block_policy',
    LAST_SYNC_KEY: 'last_sync',
    VERSION_KEY: 'extension_version',
    CACHE_EXPIRY_HOURS: 24,
    ERROR_LOG_KEY: 'error_logs',
    MAX_RETRIES: 3,
    TIMEOUT_MS: 10000,
};

// Current extension version
const EXTENSION_VERSION = '1.0.0';

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

// Category-based blocklists for Study Mode
const CATEGORY_BLOCKLISTS = {
    social_media: [
        '*://*.facebook.com/*', '*://*.instagram.com/*', '*://*.twitter.com/*',
        '*://*.x.com/*', '*://*.tiktok.com/*', '*://*.snapchat.com/*',
        '*://*.linkedin.com/*', '*://*.pinterest.com/*', '*://*.tumblr.com/*',
        '*://*.whatsapp.com/*', '*://*.messenger.com/*', '*://*.telegram.org/*',
        '*://*.discord.com/*', '*://*.discordapp.com/*', '*://*.threads.net/*',
    ],
    gaming: [
        '*://*.twitch.tv/*', '*://*.steam.com/*', '*://*.steampowered.com/*',
        '*://*.epicgames.com/*', '*://*.roblox.com/*', '*://*.minecraft.net/*',
        '*://*.ea.com/*', '*://*.origin.com/*', '*://*.blizzard.com/*',
        '*://*.battle.net/*', '*://*.ign.com/*', '*://*.gamespot.com/*',
        '*://*.kotaku.com/*', '*://*.polygon.com/*', '*://*.gog.com/*',
    ],
    youtube: [
        '*://*.youtube.com/*', '*://*.youtu.be/*', '*://*.youtube-nocookie.com/*',
    ],
    reddit: [
        '*://*.reddit.com/*', '*://*.redd.it/*', '*://*.old.reddit.com/*',
    ],
};

// Active study session data
let activeStudySession = null;

// ============================================
// INITIALIZATION
// ============================================

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('ZAS Safeguard installed:', details.reason);

    if (details.reason === 'install') {
        // Generate device ID
        const deviceId = generateDeviceId();
        await chrome.storage.local.set({
            [CONFIG.DEVICE_ID_KEY]: deviceId,
            tosAgreed: false,  // Require TOS agreement
            planType: 'free'   // Default to free until they subscribe
        });

        // Set up default blocking rules
        await updateBlockingRules(DEFAULT_BLOCKLIST);

        // Redirect to dashboard for TOS agreement
        chrome.tabs.create({
            url: 'https://zasgloballlc.com/safeguard/app/?install=true&ext=zas-safeguard'
        });
    }

    // Set up periodic sync
    chrome.alarms.create('syncBlocklist', { periodInMinutes: CONFIG.SYNC_INTERVAL_MINUTES });
    chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
});

// Listen for TOS agreement from landing page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOS_AGREED') {
        chrome.storage.local.set({ tosAgreed: true });
        sendResponse({ success: true });
        console.log('TOS agreed by user');
    }
    if (message.type === 'PLAN_UPDATE') {
        chrome.storage.local.set({ planType: message.plan });
        sendResponse({ success: true });
        console.log('Plan updated:', message.plan);
    }
    if (message.type === 'STUDY_MODE_START') {
        console.log('[StudyMode] Received start message:', message.session);
        // Save to local storage
        chrome.storage.local.set({
            activeStudySession: message.session,
            studyBlockCategories: message.session.blockCategories
        }).then(() => {
            // Apply blocking immediately
            updateBlockingWithCategories(message.session.blockCategories);
            sendResponse({ success: true });
        });
    }
    if (message.type === 'STUDY_MODE_STOP') {
        console.log('[StudyMode] Received stop message');
        chrome.storage.local.remove(['activeStudySession', 'studyBlockCategories']).then(() => {
            updateBlockingRules(DEFAULT_BLOCKLIST);
            sendResponse({ success: true });
        });
    }
    if (message.type === 'CATEGORY_TOGGLE') {
        console.log('[Categories] Toggle:', message.category, message.enabled);
        // Store category settings
        chrome.storage.local.get(['categorySettings']).then(result => {
            const settings = result.categorySettings || {};
            settings[message.category] = message.enabled;
            chrome.storage.local.set({ categorySettings: settings });

            // Update blocking based on new settings
            applyCurrentCategorySettings();
            sendResponse({ success: true });
        });
    }
    if (message.type === 'SETTINGS_UPDATE') {
        console.log('[Settings] Update:', message.settings);
        chrome.storage.local.set({ userSettings: message.settings });
        sendResponse({ success: true });
    }
    return true;
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
// URL SAFETY SCANNER
// ============================================

// Load malware signatures
let malwareSignatures = null;
let urlScanCache = new Map();
const URL_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Initialize scanner on startup
async function initUrlScanner() {
    try {
        const response = await fetch(chrome.runtime.getURL('lib/malwareSignatures.json'));
        malwareSignatures = await response.json();
        console.log('[URLScanner] Loaded', malwareSignatures.total_entries, 'signatures');
    } catch (error) {
        console.error('[URLScanner] Failed to load signatures:', error);
    }
}

// Run on startup
initUrlScanner();

// Intercept navigation BEFORE page loads
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Only check main frame navigations
    if (details.frameId !== 0) return;

    const url = details.url;

    // Skip internal URLs
    if (url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://') ||
        url.startsWith('moz-extension://')) {
        return;
    }

    // Check if TOS is agreed
    const { tosAgreed } = await chrome.storage.local.get('tosAgreed');
    if (!tosAgreed) {
        console.log('[ZAS] TOS not agreed, skipping URL scan');
        return;
    }

    // Check if user has Pro plan for URL scanning
    const { planType } = await chrome.storage.local.get('planType');
    const isProPlan = ['pro_monthly', 'pro_yearly', 'pro', 'lifetime'].includes(planType);

    if (!isProPlan) {
        // Essential users don't get URL safety scanning
        console.log('[ZAS] Essential plan - URL scanning is Pro feature');
        return;
    }

    // Check URL safety (Pro feature)
    const scanResult = await scanUrlForThreats(url);

    if (scanResult.blocked) {
        // 100% BLOCKED - Definitely malicious
        console.log('[URLScanner] BLOCKED:', url, scanResult.category);

        const warningUrl = chrome.runtime.getURL('warnings/malwareBlocked.html') +
            `?url=${encodeURIComponent(url)}` +
            `&category=${scanResult.category}` +
            `&source=${scanResult.source}` +
            `&reason=${encodeURIComponent(scanResult.reason || '')}` +
            `&timestamp=${new Date().toISOString()}`;

        chrome.tabs.update(details.tabId, { url: warningUrl });
        logUrlScanEvent(scanResult);

    } else if (scanResult.suspicious) {
        // SUSPICIOUS - Recommend VirusTotal check
        console.log('[URLScanner] SUSPICIOUS:', url, scanResult.category);

        const warningUrl = chrome.runtime.getURL('warnings/suspiciousWarning.html') +
            `?url=${encodeURIComponent(url)}` +
            `&category=${scanResult.category}` +
            `&reason=${encodeURIComponent(scanResult.reason || '')}`;

        chrome.tabs.update(details.tabId, { url: warningUrl });
        logUrlScanEvent({ ...scanResult, result: 'warned' });
    }
});

/**
 * Scan URL for threats using multi-layer approach
 */
async function scanUrlForThreats(url) {
    // Check cache first
    const cacheKey = hashUrlForCache(url);
    const cached = urlScanCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
        return { ...cached.result, cached: true };
    }

    let result = {
        url: url,
        safe: true,
        blocked: false,
        category: 'clean',
        confidence: 100,
        source: null,
        reason: null
    };

    try {
        // Layer A: Pattern matching (100% block)
        const patternResult = checkMaliciousPatterns(url);
        if (patternResult.blocked) {
            result = { ...result, ...patternResult, source: 'pattern' };
            cacheUrlResult(cacheKey, result);
            return result;
        }

        // Layer B: Signature database (100% block)
        const signatureResult = checkSignatureDatabase(url);
        if (signatureResult.blocked) {
            result = { ...result, ...signatureResult, source: 'signature' };
            cacheUrlResult(cacheKey, result);
            return result;
        }

        // Layer C: Suspicious patterns (warning, not block)
        const suspiciousResult = checkSuspiciousPatterns(url);
        if (suspiciousResult.suspicious) {
            result = {
                ...result,
                ...suspiciousResult,
                safe: false,
                suspicious: true,
                source: 'heuristic'
            };
            cacheUrlResult(cacheKey, result);
            return result;
        }

        // Clean URL
        cacheUrlResult(cacheKey, result);
        return result;

    } catch (error) {
        console.error('[URLScanner] Error:', error);
        return result;
    }
}

/**
 * Layer C: Check suspicious patterns (warns but doesn't block)
 */
function checkSuspiciousPatterns(url) {
    // Patterns that are suspicious but not 100% malicious
    const SUSPICIOUS_PATTERNS = [
        /\.(tk|ml|ga|cf|gq)$/i,           // Suspicious free TLDs
        /bit\.ly\/\w+$/i,                  // URL shorteners
        /tinyurl\.com\/\w+$/i,
        /t\.co\/\w+$/i,
        /goo\.gl\/\w+$/i,
        /ow\.ly\/\w+$/i,
        /is\.gd\/\w+$/i,
        /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,  // IP addresses instead of domains
        /login.*\.(xyz|top|club|online)/i,     // Login on suspicious TLDs
        /free.*gift/i,
        /win.*iphone/i,
        /claim.*reward/i,
        /urgent.*action/i,
        /account.*locked/i,
        /verify.*email/i,
        /confirm.*order/i,
        /update.*payment/i,
    ];

    const urlLower = url.toLowerCase();

    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(url)) {
            return {
                suspicious: true,
                reason: 'suspicious_pattern',
                category: 'suspicious'
            };
        }
    }

    // Check for excessive subdomains (common in phishing)
    try {
        const urlObj = new URL(url);
        const subdomains = urlObj.hostname.split('.').length - 2;
        if (subdomains > 3) {
            return {
                suspicious: true,
                reason: 'excessive_subdomains',
                category: 'suspicious'
            };
        }
    } catch (e) { }

    return { suspicious: false };
}

/**
 * Layer A: Check malicious patterns
 */
function checkMaliciousPatterns(url) {
    const MALICIOUS_PATTERNS = [
        /phish/i, /verify-account/i, /confirm-identity/i, /account-suspended/i,
        /reset-password-now/i, /free-crypto/i, /crypto-giveaway/i, /wallet-drainer/i,
        /claim-airdrop/i, /binance-verify/i, /coinbase-verify/i, /metamask-verify/i,
        /steam-gift/i, /free-robux/i, /free-vbucks/i, /iphone-winner/i,
        /prize-claim/i, /lottery-winner/i, /virus-detected/i, /your-pc-infected/i,
        /grabify/i, /iplogger/i, /download-now-free/i,
        /paypa[l1].*\.(tk|ml|ga|cf)/i, /amaz[o0]n.*\.(tk|ml|ga)/i,
        /g[o0]{2}gle.*\.(tk|ml|ga)/i, /faceb[o0]{2}k.*\.(tk|ml|ga)/i
    ];

    const TRUSTED_DOMAINS = [
        'google.com', 'youtube.com', 'facebook.com', 'instagram.com',
        'twitter.com', 'x.com', 'microsoft.com', 'apple.com', 'amazon.com',
        'netflix.com', 'github.com', 'reddit.com', 'paypal.com', 'stripe.com',
        'zasgloballlc.com', 'zas-safeguard.web.app', 'firebase.google.com'
    ];

    const urlLower = url.toLowerCase();

    // Check trusted first
    for (const domain of TRUSTED_DOMAINS) {
        if (urlLower.includes(domain)) {
            return { blocked: false, reason: 'trusted' };
        }
    }

    // Check patterns
    for (const pattern of MALICIOUS_PATTERNS) {
        if (pattern.test(url)) {
            return {
                blocked: true,
                safe: false,
                reason: 'malicious_pattern',
                category: categorizeUrl(pattern.toString())
            };
        }
    }

    return { blocked: false };
}

/**
 * Layer B: Check signature database
 */
function checkSignatureDatabase(url) {
    if (!malwareSignatures) return { blocked: false };

    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.toLowerCase();

        const categories = [
            { list: malwareSignatures.phishing_domains, category: 'phishing' },
            { list: malwareSignatures.malware_domains, category: 'malware' },
            { list: malwareSignatures.crypto_scam_domains, category: 'crypto_scam' },
            { list: malwareSignatures.scam_domains, category: 'scam' },
            { list: malwareSignatures.ip_grabber_domains, category: 'ip_grabber' }
        ];

        for (const { list, category } of categories) {
            if (list && list.some(d => domain.includes(d) || domain === d)) {
                return { blocked: true, safe: false, category, reason: 'known_malicious' };
            }
        }
    } catch (e) { }

    return { blocked: false };
}

/**
 * Categorize URL threat
 */
function categorizeUrl(pattern) {
    const p = pattern.toLowerCase();
    if (p.includes('phish') || p.includes('verify') || p.includes('login')) return 'phishing';
    if (p.includes('crypto') || p.includes('wallet')) return 'crypto_scam';
    if (p.includes('virus') || p.includes('infected')) return 'malware';
    if (p.includes('prize') || p.includes('winner')) return 'scam';
    if (p.includes('grabify') || p.includes('iplogger')) return 'ip_grabber';
    return 'suspicious';
}

/**
 * Hash URL for caching
 */
function hashUrlForCache(url) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        hash = ((hash << 5) - hash) + url.charCodeAt(i);
        hash = hash & hash;
    }
    return hash.toString(36);
}

/**
 * Cache scan result
 */
function cacheUrlResult(key, result) {
    urlScanCache.set(key, { result, expires: Date.now() + URL_CACHE_DURATION });
    if (urlScanCache.size > 500) {
        const now = Date.now();
        for (const [k, v] of urlScanCache.entries()) {
            if (now > v.expires) urlScanCache.delete(k);
        }
    }
}

/**
 * Log URL scan event to Firestore
 */
async function logUrlScanEvent(scanResult) {
    try {
        const deviceId = await getDeviceId();
        const storage = await chrome.storage.local.get(CONFIG.USER_TOKEN_KEY);

        if (!storage[CONFIG.USER_TOKEN_KEY]) return;

        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logUrlScan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${storage[CONFIG.USER_TOKEN_KEY]}`
            },
            body: JSON.stringify({
                ...scanResult,
                deviceId,
                timestamp: new Date().toISOString()
            })
        });
    } catch (error) {
        console.error('[URLScanner] Log failed:', error);
    }
}


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
// STUDY MODE BLOCKING
// ============================================

// Sync study mode from storage and apply blocking
async function syncStudyMode() {
    try {
        const result = await chrome.storage.local.get(['activeStudySession', 'studyBlockCategories']);

        if (result.activeStudySession && result.studyBlockCategories) {
            const session = result.activeStudySession;
            const endTime = new Date(session.endTime);
            const now = new Date();

            if (now < endTime) {
                // Study mode is still active - apply category blocking
                console.log('[StudyMode] Active session, blocking categories:', result.studyBlockCategories);
                await updateBlockingWithCategories(result.studyBlockCategories);
                return true;
            } else {
                // Session expired - clear and restore default blocking
                console.log('[StudyMode] Session expired, clearing');
                await chrome.storage.local.remove(['activeStudySession', 'studyBlockCategories']);
                await updateBlockingRules(DEFAULT_BLOCKLIST);
            }
        }
    } catch (error) {
        console.error('[StudyMode] Sync error:', error);
    }
    return false;
}

// Update blocking rules with category-based blocking for study mode
async function updateBlockingWithCategories(categories) {
    try {
        // Start with default adult blocklist (always active)
        let allBlockedDomains = [...DEFAULT_BLOCKLIST];

        // Add category-specific blocks
        for (const category of categories) {
            if (CATEGORY_BLOCKLISTS[category]) {
                allBlockedDomains = allBlockedDomains.concat(CATEGORY_BLOCKLISTS[category]);
            }
        }

        // Remove duplicates
        allBlockedDomains = [...new Set(allBlockedDomains)];

        console.log('[StudyMode] Blocking', allBlockedDomains.length, 'domains');
        await updateBlockingRules(allBlockedDomains);

        return true;
    } catch (error) {
        console.error('[StudyMode] Failed to apply category blocking:', error);
        return false;
    }
}

// Apply blocking based on current category settings (from dashboard toggles)
async function applyCurrentCategorySettings() {
    try {
        const result = await chrome.storage.local.get(['categorySettings']);
        const settings = result.categorySettings || {};

        // Start with default blocklist (always active)
        let allBlockedDomains = [...DEFAULT_BLOCKLIST];

        // Add enabled category blocks
        for (const [category, enabled] of Object.entries(settings)) {
            if (enabled && CATEGORY_BLOCKLISTS[category]) {
                allBlockedDomains = allBlockedDomains.concat(CATEGORY_BLOCKLISTS[category]);
            }
        }

        // Remove duplicates
        allBlockedDomains = [...new Set(allBlockedDomains)];

        console.log('[Categories] Applying', allBlockedDomains.length, 'domains');
        await updateBlockingRules(allBlockedDomains);

    } catch (error) {
        console.error('[Categories] Failed to apply settings:', error);
    }
}

// Listen for study mode activation from dashboard
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.activeStudySession || changes.studyBlockCategories) {
            console.log('[StudyMode] Settings changed, syncing...');
            syncStudyMode();
        }
    }
});

// Check study mode on startup
chrome.runtime.onStartup.addListener(() => {
    syncStudyMode();
});

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
        // Extension was disabled - log security event for parent alert
        logSecurityEvent('extension_disabled', {
            deviceName: 'Browser Extension',
            action: 'disabled'
        });

        // Try to re-enable (won't work if user disabled, but logs the attempt)
        chrome.management.setEnabled(chrome.runtime.id, true);
    }
});

// Monitor for uninstall (before it happens if possible)
chrome.runtime.onSuspend.addListener(() => {
    logSecurityEvent('extension_suspend', {
        deviceName: 'Browser Extension',
        action: 'suspend_or_uninstall'
    });
});

// Note: DevTools detection via window.addEventListener('resize') is not possible in service workers
// The content script monitors for DevTools in active tabs instead
// See content.js for in-page tamper detection

async function logSecurityEvent(type, metadata = {}) {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token || !deviceId) return;

        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logSecurityEvent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                data: {
                    deviceId,
                    type,
                    metadata: {
                        ...metadata,
                        timestamp: Date.now(),
                        extensionVersion: EXTENSION_VERSION
                    }
                }
            })
        });

        console.log(`Security event logged: ${type}`);
    } catch (error) {
        console.error('Failed to log security event:', error);
        // Store locally for later sync
        const errorLogs = await chrome.storage.local.get(CONFIG.ERROR_LOG_KEY) || { [CONFIG.ERROR_LOG_KEY]: [] };
        errorLogs[CONFIG.ERROR_LOG_KEY].push({ type, metadata, timestamp: Date.now() });
        await chrome.storage.local.set(errorLogs);
    }
}

// Log blocked URL as security event (for alert threshold)
async function logBlockedAttempt(domain) {
    await logSecurityEvent('blocked_attempt', {
        domain,
        deviceName: 'Browser Extension'
    });
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

        // Log to activity logs
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

        // Also log as security event for parent alert threshold
        await logBlockedAttempt(hostname);
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
