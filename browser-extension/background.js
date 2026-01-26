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
 * - Ad Blocker Engine (NEW)
 */

// Import Ad Blocker modules (inline for service worker compatibility)
// Note: Service workers don't support ES modules well, so we use inline loading
let AdBlockEngine = null;
let AdBlockStats = null;
let AdBlockAntiBreakage = null;
let FilterListParser = null;
let FilterListManager = null;

// Filter list modules will be loaded inline during init
// (ES modules with "type": "module" don't support importScripts)

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    FIREBASE_API_ENDPOINT: 'https://us-central1-zas-safeguard.cloudfunctions.net',
    FIREBASE_FUNCTIONS_URL: 'https://us-central1-zas-safeguard.cloudfunctions.net',
    // 2nd gen Cloud Run function URLs
    UPDATE_DEVICE_STATUS_URL: 'https://updatedevicestatus-xwlk3qzrrq-uc.a.run.app',
    REGISTER_DEVICE_URL: 'https://us-central1-zas-safeguard.cloudfunctions.net/registerDevice',
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
// SUBSCRIPTION STATUS CHECK
// ============================================

/**
 * Check if user has an active subscription or trial
 * Returns true if features should be enabled, false otherwise
 */
async function checkSubscriptionStatus() {
    try {
        const stored = await chrome.storage.local.get([
            'planType',
            'subscriptionPlan',
            'subscriptionStatus',
            'trialEndDate',
            'subscriptionEndDate'
        ]);

        const planType = stored.planType || stored.subscriptionPlan || '';
        const status = stored.subscriptionStatus || '';

        // Lifetime users always have access
        if (planType === 'lifetime' || status === 'lifetime') {
            console.log('[Subscription] Lifetime access');
            return true;
        }

        // Check if status is active
        const activeStatuses = ['active', 'trialing', 'trial'];
        if (activeStatuses.includes(status)) {
            console.log('[Subscription] Active subscription:', status);
            return true;
        }

        // Check if subscription is past_due but still in grace period
        if (status === 'past_due') {
            console.log('[Subscription] Past due - allowing grace period');
            return true;
        }

        // Check trial end date
        if (stored.trialEndDate) {
            const trialEnd = new Date(stored.trialEndDate);
            if (trialEnd > new Date()) {
                console.log('[Subscription] Trial still active until:', trialEnd);
                return true;
            }
        }

        // Check subscription end date
        if (stored.subscriptionEndDate) {
            const subEnd = new Date(stored.subscriptionEndDate);
            if (subEnd > new Date()) {
                console.log('[Subscription] Subscription still active until:', subEnd);
                return true;
            }
        }

        // Check for active pro plans
        const proPlanTypes = ['pro_monthly', 'pro_yearly', 'essential_monthly', 'essential_yearly'];
        if (proPlanTypes.includes(planType)) {
            // If they have a plan type but no status, check with sync
            console.log('[Subscription] Has plan type but unclear status, allowing');
            return true;
        }

        // No valid subscription found
        console.log('[Subscription] No active subscription found:', { planType, status });
        return false;

    } catch (error) {
        console.error('[Subscription] Error checking status:', error);
        // On error, default to allowing (don't lock out users due to bugs)
        return true;
    }
}

/**
 * Enable or disable ALL extension blocking features based on subscription status
 * This includes both static and dynamic rulesets
 */
async function enforceSubscriptionStatus() {
    const isSubscribed = await checkSubscriptionStatus();

    console.log('[Subscription] Enforcing status:', isSubscribed ? 'ACTIVE' : 'EXPIRED');

    try {
        // Get all available static rulesets
        const availableRulesets = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();

        // List of static ruleset IDs from manifest.json
        const allRulesets = [
            'ruleset_block',
            'adblock_ads',
            'adblock_trackers',
            'adblock_malware',
            'adblock_annoyances',
            'adblock_social',
            'adblock_youtube'
        ];

        if (isSubscribed) {
            // Enable blocking rulesets (use the ones that were enabled in manifest)
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                enableRulesetIds: ['ruleset_block', 'adblock_ads', 'adblock_trackers', 'adblock_malware', 'adblock_youtube']
            });
            console.log('[Subscription] Blocking rulesets ENABLED');
        } else {
            // Disable ALL rulesets when subscription is inactive
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                disableRulesetIds: allRulesets
            });

            // Also clear dynamic rules
            const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
            const existingIds = existingRules.map(rule => rule.id);
            if (existingIds.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
            }

            console.log('[Subscription] ALL blocking DISABLED - subscription inactive');
        }
    } catch (error) {
        console.error('[Subscription] Error enforcing status:', error);
    }
}

// Check subscription status periodically (every 5 minutes)
setInterval(enforceSubscriptionStatus, 5 * 60 * 1000);

// Also check on storage changes (when subscription status updates)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        const subscriptionKeys = ['subscriptionStatus', 'planType', 'subscriptionPlan', 'trialEndDate'];
        const hasSubscriptionChange = subscriptionKeys.some(key => key in changes);
        if (hasSubscriptionChange) {
            console.log('[Subscription] Status changed, enforcing...');
            enforceSubscriptionStatus();
        }
    }
});

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
            tosAgreed: false,  // Require TOS + Privacy Policy agreement
            planType: 'free'   // Default to free until they subscribe
        });

        // Set up default blocking rules
        await updateBlockingRules(DEFAULT_BLOCKLIST);

        // Open welcome page for Terms of Service & Privacy Policy agreement
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome/welcome.html')
        });
    }

    // Set up periodic sync
    chrome.alarms.create('syncBlocklist', { periodInMinutes: CONFIG.SYNC_INTERVAL_MINUTES });
    chrome.alarms.create('heartbeat', { periodInMinutes: 1 });

    // Initialize Ad Blocker Engine
    initAdBlockEngine();
});

// Listen for TOS agreement from landing page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOS_AGREED') {
        chrome.storage.local.set({ tosAgreed: true });
        sendResponse({ success: true });
        console.log('TOS agreed by user');
    }
    if (message.type === 'PLAN_UPDATE') {
        chrome.storage.local.set({
            planType: message.plan,
            subscriptionStatus: message.status || message.plan
        });
        sendResponse({ success: true });
        console.log('Plan updated:', message.plan, 'Status:', message.status);
    }
    // Handle LOGIN from dashboard - store Firebase auth token
    if (message.type === 'LOGIN') {
        console.log('[Auth] Received LOGIN from dashboard');
        if (message.token) {
            chrome.storage.local.set({
                [CONFIG.USER_TOKEN_KEY]: message.token,
                loggedInUserId: message.userId
            }).then(async () => {
                // Register device with Firebase (creates device in Firestore)
                await registerDeviceWithFirebase(message.userId, message.token);
                // Sync immediately after login
                syncWithFirebase();
                sendResponse({ success: true });
            });
        } else {
            sendResponse({ success: false, error: 'No token provided' });
        }
    }
    // Handle LOGOUT from dashboard
    if (message.type === 'LOGOUT') {
        console.log('[Auth] Received LOGOUT from dashboard');
        chrome.storage.local.remove([CONFIG.USER_TOKEN_KEY, CONFIG.POLICY_KEY, 'loggedInUserId']).then(() => {
            sendResponse({ success: true });
        });
    }
    if (message.type === 'STUDY_MODE_START') {
        console.log('[StudyMode] Received start message from dashboard:', message.session);
        chrome.storage.local.set({
            activeStudySession: message.session,
            studyBlockCategories: message.session.blockCategories
        }).then(async () => {
            // Apply blocking immediately!
            await updateBlockingWithCategories(message.session.blockCategories);
            console.log('[StudyMode] Focus Mode blocking ACTIVE for:', message.session.blockCategories);
            sendResponse({ success: true });
        });
        return true; // Keep channel open for async
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
    if (message.type === 'CHILD_LOCK') {
        console.log('[ChildLock] Received lock command:', message.locked);
        chrome.storage.local.set({
            childLocked: message.locked,
            childLockTime: new Date().toISOString()
        }).then(() => {
            if (message.locked) {
                // Lock everything - only allow essential sites
                const ESSENTIAL_SITES = [
                    '*://*.google.com/*', '*://*.google.com/*',
                    '*://*.zasgloballlc.com/*', '*://*.zas-safeguard.web.app/*'
                ];
                // Block all by redirecting all URLs except essential
                applyChildLock(true);
            } else {
                // Unlock - restore normal blocking
                applyChildLock(false);
            }
            sendResponse({ success: true });
        });
    }
    if (message.type === 'GET_EXTENSION_ID') {
        // Return extension ID for dashboard to use
        sendResponse({ extensionId: chrome.runtime.id });
    }

    // ============================================
    // AD BLOCKER HANDLERS
    // ============================================

    if (message.type === 'ADBLOCK_GET_STATS') {
        handleAdBlockGetStats()
            .then(stats => sendResponse({ stats }))
            .catch(error => sendResponse({ error: error.message }));
        return true; // Async response
    }

    if (message.type === 'ADBLOCK_SET_CATEGORY') {
        (async () => {
            const result = await chrome.storage.local.get([ADBLOCK_CONFIG_KEY]);
            const config = result[ADBLOCK_CONFIG_KEY] || { ...ADBLOCK_DEFAULT_CONFIG };
            config.categories[message.category] = message.enabled;
            await chrome.storage.local.set({ [ADBLOCK_CONFIG_KEY]: config });
            await applyAdBlockConfig(config);
            sendResponse({ success: true, config });
        })();
        return true;
    }

    if (message.type === 'ADBLOCK_ADD_ALLOWLIST') {
        handleAdBlockAddAllowlist(message.domain)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === 'ADBLOCK_REMOVE_ALLOWLIST') {
        handleAdBlockRemoveAllowlist(message.domain)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ error: error.message }));
        return true;
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
// INTERNAL MESSAGE HANDLER (from content scripts)
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received internal message:', message.type);

    if (message.type === 'CHILD_LOCK') {
        console.log('[ChildLock] Lock command from content script:', message.locked);
        chrome.storage.local.set({
            childLocked: message.locked,
            childLockTime: new Date().toISOString()
        }).then(() => {
            applyChildLock(message.locked);
            sendResponse({ success: true });
        });
        return true; // Keep channel open for async response
    }

    if (message.type === 'STUDY_MODE_START') {
        console.log('[StudyMode] Start from content script:', message.session);
        chrome.storage.local.set({
            activeStudySession: message.session,
            studyBlockCategories: message.session.blockCategories
        }).then(async () => {
            // Directly apply blocking NOW - don't wait for debounced listener
            await updateBlockingWithCategories(message.session.blockCategories);
            console.log('[StudyMode] Blocking applied for categories:', message.session.blockCategories);
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === 'STUDY_MODE_STOP') {
        console.log('[StudyMode] Stop from content script');
        chrome.storage.local.remove(['activeStudySession', 'studyBlockCategories']).then(() => {
            updateBlockingRules(DEFAULT_BLOCKLIST);
            sendResponse({ success: true });
        });
        return true;
    }

    // Handle DevTools detection from content script
    if (message.type === 'DEV_TOOLS_OPENED') {
        console.log('[Security] DevTools opened detected on:', message.url);
        logSecurityEvent('DEVTOOLS_OPENED', {
            url: message.url,
            reason: 'Developer tools were opened on a monitored page',
            severity: 'medium'
        });
        sendResponse({ received: true });
        return false;
    }

    if (message.type === 'PING') {
        sendResponse({ status: 'alive', version: EXTENSION_VERSION });
        return false;
    }

    // ============================================
    // AD BLOCKER MESSAGE HANDLERS
    // ============================================

    if (message.type === 'ADBLOCK_ENABLE') {
        handleAdBlockEnable().then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === 'ADBLOCK_DISABLE') {
        handleAdBlockDisable().then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === 'ADBLOCK_SET_CATEGORY') {
        handleAdBlockSetCategory(message.category, message.enabled)
            .then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === 'ADBLOCK_ADD_ALLOWLIST') {
        handleAdBlockAddAllowlist(message.domain)
            .then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === 'ADBLOCK_REMOVE_ALLOWLIST') {
        handleAdBlockRemoveAllowlist(message.domain)
            .then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === 'ADBLOCK_GET_ALLOWLIST') {
        handleAdBlockGetAllowlist().then(list => sendResponse({ allowlist: list }));
        return true;
    }

    if (message.type === 'ADBLOCK_SET_SITE_MODE') {
        handleAdBlockSetSiteMode(message.domain, message.mode)
            .then(() => sendResponse({ success: true }));
        return true;
    }

    if (message.type === 'ADBLOCK_GET_STATS') {
        handleAdBlockGetStats().then(stats => sendResponse({ stats }));
        return true;
    }

    if (message.type === 'ADBLOCK_GET_CONFIG') {
        handleAdBlockGetConfig().then(config => sendResponse({ config }));
        return true;
    }

    if (message.type === 'ADBLOCK_BREAKAGE') {
        console.log('[AdBlock] Breakage reported for:', message.domain);
        logSecurityEvent('ADBLOCK_BREAKAGE', {
            domain: message.domain,
            timestamp: message.timestamp,
            severity: 'low'
        });
        sendResponse({ received: true });
        return false;
    }

    // Handle cosmetic filter stats from content script
    if (message.type === 'ADBLOCK_COSMETIC_STATS') {
        console.log('[AdBlock] Cosmetic stats from', message.domain, ':', message.count, 'elements blocked');
        // Increment stats by the count of hidden elements
        (async () => {
            for (let i = 0; i < Math.min(message.count, 100); i++) {
                await incrementAdBlockStat('ads');
            }
        })();
        sendResponse({ received: true });
        return false;
    }

    // Handle URL scan from popup
    if (message.type === 'SCAN_URL') {
        console.log('[URLScanner] Popup scan request for:', message.url);
        scanUrlForThreats(message.url)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ safe: true, error: error.message }));
        return true; // Async response
    }

    return false;
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

    // TAMPER DETECTION: Detect navigation to chrome://extensions (potential disable/uninstall attempt)
    if (url.startsWith('chrome://extensions') || url.startsWith('edge://extensions')) {
        console.log('[Tamper] User navigated to extensions page - potential tamper attempt');

        // Log as security event (sends alert to parent/dashboard)
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY, 'loggedInUserId']);
        if (storage[CONFIG.USER_TOKEN_KEY] && storage[CONFIG.DEVICE_ID_KEY]) {
            try {
                await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logSecurityEvent`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${storage[CONFIG.USER_TOKEN_KEY]}`
                    },
                    body: JSON.stringify({
                        deviceId: storage[CONFIG.DEVICE_ID_KEY],
                        eventType: 'TAMPER_ATTEMPT',
                        details: {
                            action: 'extensions_page_opened',
                            message: 'User opened browser extensions page - may attempt to disable protection'
                        }
                    })
                });
                console.log('[Tamper] Alert sent to dashboard');
            } catch (err) {
                console.error('[Tamper] Failed to send alert:', err);
            }
        }
        // Don't block - just alert
        return;
    }

    // Skip other internal URLs
    if (url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://') ||
        url.startsWith('moz-extension://')) {
        return;
    }

    // Check if TOS + Privacy Policy is agreed
    const { tosAgreed } = await chrome.storage.local.get('tosAgreed');
    if (!tosAgreed) {
        console.log('[ZAS] TOS not agreed, skipping URL scan');
        return;
    }

    // Check if user has Pro plan for URL scanning (check multiple storage keys)
    const stored = await chrome.storage.local.get(['planType', 'subscriptionPlan', 'subscriptionStatus']);
    const planType = stored.planType || stored.subscriptionPlan || '';
    const status = stored.subscriptionStatus || '';

    // Be flexible with plan matching
    const isProPlan =
        planType === 'lifetime' ||
        planType === 'pro' ||
        planType.includes('pro') ||
        status === 'lifetime' ||
        ['pro_monthly', 'pro_yearly', 'essential_monthly', 'essential_yearly'].includes(planType);

    console.log('[URLScanner] Plan check:', { planType, status, isProPlan });

    // if (!isProPlan) {
    //     // Free users don't get URL safety scanning
    //     console.log('[ZAS] Free plan - URL scanning is Pro feature (Check disabled for testing)');
    //     // return;
    // }

    console.log('[URLScanner] Scanning:', url);

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

        // Layer D: Cloud Function API (Google Safe Browsing + AI) - REAL detection
        try {
            const cloudResult = await checkUrlViaCloudFunction(url);
            if (cloudResult && !cloudResult.safe) {
                result = {
                    ...result,
                    safe: false,
                    blocked: cloudResult.category === 'malware' || cloudResult.category === 'phishing',
                    suspicious: true,
                    category: cloudResult.category,
                    confidence: cloudResult.confidence || 90,
                    source: cloudResult.source || 'api',
                    reason: cloudResult.reason || `Detected by ${cloudResult.source}`
                };
                cacheUrlResult(cacheKey, result);
                return result;
            }
        } catch (apiError) {
            console.log('[URLScanner] Cloud API check failed, using local only:', apiError.message);
            // Continue with local-only result if API fails
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
 * Layer D: Call Cloud Function for Google Safe Browsing API + AI detection
 */
async function checkUrlViaCloudFunction(url) {
    // Get stored auth token
    const stored = await chrome.storage.local.get(['userToken', 'loggedInUserId']);
    if (!stored.userToken || !stored.loggedInUserId) {
        console.log('[URLScanner] Not logged in, skipping cloud check');
        return null;
    }

    try {
        const response = await fetch(
            'https://us-central1-zas-safeguard.cloudfunctions.net/checkUrlReputation',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${stored.userToken}`
                },
                body: JSON.stringify({
                    data: { url }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Cloud API returned ${response.status}`);
        }

        const result = await response.json();
        console.log('[URLScanner] Cloud API result:', result);

        // Cloud Functions wrap response in { result: ... }
        return result.result || result;

    } catch (error) {
        console.error('[URLScanner] Cloud API error:', error);
        return null;
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
        /grabify/i, /iplogger/i, /download-now-free/i, /malware_test/i,
        /malware/i, /ransomware/i, /trojan/i, /keylogger/i, /spyware/i,
        /paypa[l1].*\.(tk|ml|ga|cf)/i, /amaz[o0]n.*\.(tk|ml|ga)/i,
        /g[o0]{2}gle.*\.(tk|ml|ga)/i, /faceb[o0]{2}k.*\.(tk|ml|ga)/i
    ];

    const TRUSTED_DOMAINS = [
        'google.com', 'youtube.com', 'facebook.com', 'instagram.com',
        'twitter.com', 'x.com', 'microsoft.com', 'apple.com', 'amazon.com',
        'netflix.com', 'github.com', 'reddit.com', 'paypal.com', 'stripe.com',
        'zasgloballlc.com', 'zas-safeguard.web.app', 'zassafeguard.com',
        'firebase.google.com', 'firebaseapp.com', 'googleapis.com',
        'identitytoolkit.googleapis.com', 'securetoken.googleapis.com',
        'cloudfunctions.net', 'firebaseio.com', 'firebasestorage.app'
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
            console.log('[URLScanner] MATCHED PATTERN:', pattern, 'for URL:', url);
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
        // ============================================
        // SUBSCRIPTION CHECK - Disable features if not subscribed
        // ============================================
        const isSubscribed = await checkSubscriptionStatus();
        if (!isSubscribed) {
            console.log('[Blocking] Subscription inactive - disabling all blocking rules');
            // Clear all existing rules
            const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
            const existingIds = existingRules.map(rule => rule.id);
            if (existingIds.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
            }
            return false;
        }

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
        let adultDomains = [...DEFAULT_BLOCKLIST];
        let studyDomains = [];

        // Add category-specific blocks (these are Study Mode blocks)
        for (const category of categories) {
            if (CATEGORY_BLOCKLISTS[category]) {
                studyDomains = studyDomains.concat(CATEGORY_BLOCKLISTS[category]);
            }
        }

        // Remove duplicates
        studyDomains = [...new Set(studyDomains)];

        console.log('[StudyMode] Blocking', studyDomains.length, 'study domains +', adultDomains.length, 'adult domains');

        // Clear existing dynamic rules
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = existingRules.map(rule => rule.id);

        if (existingIds.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: existingIds
            });
        }

        // Create rules for adult content (default reason)
        // Start at 1000 to avoid conflict with static rules (1-100 reserved)
        const adultRules = adultDomains.map((domain, index) => {
            let urlFilter = domain;
            if (!domain.includes('*')) {
                urlFilter = `*://*.${domain}/*`;
            }
            return {
                id: 1000 + index, // Start at 1000 to avoid static rule conflicts
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

        // Create rules for Study Mode (custom reason)
        const studyRules = studyDomains.map((domain, index) => {
            let urlFilter = domain;
            if (!domain.includes('*')) {
                urlFilter = `*://*.${domain}/*`;
            }
            return {
                id: 5000 + index, // Start at 5000 to avoid conflict with adult rules
                priority: 1,
                action: {
                    type: 'redirect',
                    redirect: {
                        extensionPath: '/blocked/blocked.html?reason=Study%20Mode%20-%20Focus%20Session%20Active'
                    }
                },
                condition: {
                    urlFilter,
                    resourceTypes: ['main_frame', 'sub_frame']
                }
            };
        });

        // Add all rules
        const allRules = [...adultRules, ...studyRules];
        const maxRules = Math.min(allRules.length, 4999);
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: allRules.slice(0, maxRules)
        });

        console.log('[StudyMode] Applied', maxRules, 'total blocking rules');
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
// Debounce to prevent multiple rapid calls
let studyModeSyncTimeout = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.activeStudySession || changes.studyBlockCategories) {
            console.log('[StudyMode] Settings changed, syncing (debounced)...');
            // Debounce: wait 500ms before syncing to avoid duplicate calls
            if (studyModeSyncTimeout) {
                clearTimeout(studyModeSyncTimeout);
            }
            studyModeSyncTimeout = setTimeout(() => {
                syncStudyMode();
                studyModeSyncTimeout = null;
            }, 500);
        }
    }
});

// Check study mode on startup
chrome.runtime.onStartup.addListener(() => {
    syncStudyMode();
    checkChildLock(); // Also check child lock on startup
});

// ============================================
// CHILD LOCK (Parent-controlled device lock)
// ============================================

// Whitelist for when device is child-locked (only essential sites allowed)
const CHILD_LOCK_WHITELIST = [
    'google.com', 'www.google.com', 'classroom.google.com', 'docs.google.com',
    'drive.google.com', 'meet.google.com', 'calendar.google.com',
    'zasgloballlc.com', 'zas-safeguard.web.app', 'zassafeguard.com',
    'khanacademy.org', 'wikipedia.org', 'britannica.com',
    'coursera.org', 'edx.org', 'duolingo.com'
];

// Apply child lock - blocks everything except whitelist
async function applyChildLock(locked) {
    if (locked) {
        console.log('[ChildLock] Activating device lock');

        // Create rules to block everything EXCEPT whitelisted domains
        // This uses a "block all then allow specific" approach
        const blockAllRule = {
            id: 99999, // High ID for the block-all rule
            priority: 1,
            action: {
                type: 'redirect',
                redirect: {
                    extensionPath: '/blocked/blocked.html?reason=Device%20locked%20by%20parent'
                }
            },
            condition: {
                urlFilter: '*://*/*',
                resourceTypes: ['main_frame']
            }
        };

        // Clear existing dynamic rules
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = existingRules.map(rule => rule.id);

        if (existingIds.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: existingIds
            });
        }

        // Add whitelist rules with higher priority
        // Using requestDomains for reliable domain matching (includes all paths like /app)
        const whitelistRules = CHILD_LOCK_WHITELIST.map((domain, index) => ({
            id: 10000 + index,
            priority: 2, // Higher priority than block-all (priority 1)
            action: { type: 'allow' },
            condition: {
                requestDomains: [domain],
                resourceTypes: ['main_frame']
            }
        }));

        console.log('[ChildLock] Adding', whitelistRules.length, 'whitelist rules + 1 block-all rule');

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [blockAllRule, ...whitelistRules]
        });

        console.log('[ChildLock] Device locked - only', CHILD_LOCK_WHITELIST.length, 'sites allowed');

    } else {
        console.log('[ChildLock] Deactivating device lock');
        // Restore normal blocking
        await updateBlockingRules(DEFAULT_BLOCKLIST);
    }
}

// Check child lock status on startup
async function checkChildLock() {
    const result = await chrome.storage.local.get(['childLocked']);
    if (result.childLocked) {
        console.log('[ChildLock] Device is locked, applying lock');
        await applyChildLock(true);
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
        // Note: onCall functions expect {data: {...}} format
        const response = await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/getBlockPolicy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ data: { deviceId } })
        });

        if (!response.ok) {
            throw new Error(`Sync failed: ${response.status}`);
        }

        const responseData = await response.json();
        // onCall functions return {result: ...} wrapper
        const data = responseData.result || responseData;

        if (data.success && data.policy) {
            // Update blocking rules
            await updateBlockingRules(data.policy.blockedDomains || []);

            // Store policy
            await chrome.storage.local.set({
                [CONFIG.POLICY_KEY]: data.policy
            });

            // IMPORTANT: Save subscription plan for URL scanning feature
            if (data.subscription) {
                await chrome.storage.local.set({
                    planType: data.subscription.plan,
                    subscriptionStatus: data.subscription.status
                });
                console.log('[Sync] Subscription plan saved:', data.subscription.plan, data.subscription.status);
            }

            // COMMAND EXECUTION: Process server-side commands
            if (data.commands) {
                const currentLockState = await chrome.storage.local.get(['childLocked']);
                const serverLocked = data.commands.childLocked;

                // Only apply if state changed from server
                if (serverLocked !== currentLockState.childLocked) {
                    console.log('[Sync] Command received: childLocked =', serverLocked);
                    await chrome.storage.local.set({
                        childLocked: serverLocked,
                        childLockTime: data.commands.lockTime || new Date().toISOString()
                    });
                    await applyChildLock(serverLocked);
                    console.log('[Sync] Lock command executed:', serverLocked ? 'LOCKED' : 'UNLOCKED');
                }
            }

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

// Get user timezone for quiet hours calculation
function getUserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {
        return 'America/Los_Angeles';
    }
}

// Get device info from browser
function getDeviceInfo() {
    const ua = navigator.userAgent;
    let deviceType = 'unknown';
    let browser = 'unknown';

    // Detect device type
    if (/Macintosh|MacIntel|MacPPC|Mac68K/.test(ua)) {
        deviceType = 'macOS';
    } else if (/Win32|Win64|Windows|WinCE/.test(ua)) {
        deviceType = 'Windows';
    } else if (/Linux/.test(ua)) {
        deviceType = 'Linux';
    } else if (/iPad/.test(ua)) {
        deviceType = 'iPad';
    } else if (/iPhone/.test(ua)) {
        deviceType = 'iPhone';
    } else if (/Android/.test(ua)) {
        deviceType = 'Android';
    }

    // Detect browser
    if (/Chrome/.test(ua) && !/Chromium/.test(ua)) {
        browser = 'Chrome';
    } else if (/Firefox/.test(ua)) {
        browser = 'Firefox';
    } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
        browser = 'Safari';
    } else if (/Edg/.test(ua)) {
        browser = 'Edge';
    }

    return { deviceType, browser };
}

/**
 * Register device with Firebase (creates device document in Firestore)
 * Called on login to ensure device appears in dashboard
 */
async function registerDeviceWithFirebase(userId, token) {
    try {
        const storage = await chrome.storage.local.get([CONFIG.DEVICE_ID_KEY]);
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!deviceId || !userId) {
            console.warn('[RegisterDevice] Missing deviceId or userId');
            return;
        }

        const { deviceType, browser } = getDeviceInfo();
        const deviceName = `${browser} on ${deviceType}`;

        console.log(`[RegisterDevice] Registering ${deviceId} for user ${userId}...`);

        const response = await fetch(CONFIG.REGISTER_DEVICE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                deviceId,
                userId,
                deviceName,
                deviceType,
                browser,
                timezone: getUserTimezone()
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log('[RegisterDevice] Device registered successfully:', result);
        } else {
            console.error('[RegisterDevice] Failed to register:', response.status);
        }
    } catch (error) {
        console.error('[RegisterDevice] Error registering device:', error);
    }
}

async function sendHeartbeat() {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token) return;

        // This updates lastSeen in Firestore with full device status
        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logBlockEvent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                deviceId,
                type: 'heartbeat',
                metadata: {
                    timestamp: Date.now(),
                    timezone: getUserTimezone(),
                    status: 'online',
                    extensionVersion: EXTENSION_VERSION
                }
            })
        });
    } catch (error) {
        // Silently fail heartbeat
    }
}

/**
 * Send graceful offline signal to server
 * This prevents email spam when user closes browser normally
 */
async function sendGracefulOffline(reason = 'browser_closed') {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token || !deviceId) return;

        // Send beacon (works even during page unload)
        const data = JSON.stringify({
            data: {
                deviceId,
                status: 'offline',
                offlineReason: 'graceful',
                hint: reason,
                timestamp: Date.now(),
                timezone: getUserTimezone()
            }
        });

        // Use sendBeacon for reliability during page unload
        // Falls back to fetch if sendBeacon unavailable
        // Using 2nd gen Cloud Run URL for updateDeviceStatus
        const url = CONFIG.UPDATE_DEVICE_STATUS_URL;

        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
        } else {
            // Fallback with keepalive
            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: data,
                keepalive: true
            }).catch(() => { });
        }

        console.log('[ZAS] Graceful offline signal sent:', reason);
    } catch (error) {
        console.error('[ZAS] Failed to send graceful offline:', error);
    }
}

// Listen for service worker suspend (browser closing)
chrome.runtime.onSuspend.addListener(() => {
    console.log('[ZAS] Service worker suspending - sending graceful offline');
    sendGracefulOffline('service_worker_suspend');
});

// Handle visibility changes via messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'VISIBILITY_CHANGE') {
        if (message.hidden) {
            // Tab is hidden, but don't send offline yet - wait for actual unload
            console.log('[ZAS] Tab hidden:', message.url);
        }
    }

    if (message.type === 'PAGE_UNLOAD') {
        // Page is unloading - this is a graceful close
        sendGracefulOffline(message.hint || 'page_unload');
    }
});

// ============================================
// TAMPER DETECTION
// ============================================

// Monitor for extension disable attempts
chrome.management.onDisabled.addListener((info) => {
    if (info.id === chrome.runtime.id) {
        // Extension was disabled - log security event for parent alert (INSTANT)
        logSecurityEvent('DISABLE_ATTEMPT', {
            reason: 'Extension was disabled',
            severity: 'high'
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

        const response = await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logSecurityEventHttp`, {
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

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Security event failed (${response.status}):`, errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json().catch(() => null);
        console.log(`Security event logged: ${type}`, result);
    } catch (error) {
        console.error('Failed to log security event:', error);
        // Store locally for later sync
        const errorLogs = await chrome.storage.local.get(CONFIG.ERROR_LOG_KEY) || { [CONFIG.ERROR_LOG_KEY]: [] };
        errorLogs[CONFIG.ERROR_LOG_KEY].push({ type, metadata, timestamp: Date.now() });
        await chrome.storage.local.set(errorLogs);
    }
}

// Log blocked URL as security event (for alert threshold)
async function logBlockedAttempt(url) {
    // Extract domain from URL
    let domain = url;
    try {
        domain = new URL(url).hostname;
    } catch (e) { }

    await logSecurityEvent('BLOCKED_SITE', {
        url: url,
        reason: `Blocked site: ${domain}`,
        severity: 'low'
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

    // NEVER block these critical domains (Google Auth, Firebase, ZAS)
    const SAFE_DOMAINS = [
        'accounts.google.com',
        'apis.google.com',
        'securetoken.googleapis.com',
        'identitytoolkit.googleapis.com',
        'zas-safeguard.firebaseapp.com',
        'zas-safeguard.web.app',
        'zassafeguard.com',
        'firebaseinstallations.googleapis.com',
        'firebaselogging.googleapis.com'
    ];

    if (SAFE_DOMAINS.some(safe => hostname.includes(safe) || safe.includes(hostname))) {
        return; // Never block auth domains
    }

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

        // Log to activity logs (use HTTP endpoint for fetch)
        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logBlockEventHttp`, {
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

        case 'ANALYZE_CONTENT_FOR_ADULT':
            return await analyzeContentForAdult(message.data);

        case 'AI_CONTENT_BLOCKED':
            await logAIBlock(message.url, message.classification, message.confidence);
            return { logged: true };

        case 'CONTENT_BLOCKED':
            await logContentBlock(message.url, message.reason);
            return { logged: true };

        case 'LOG_BLOCKED_SITE':
            // Called from blocked.html when a site is blocked
            console.log('[Security] Logging blocked site from blocked.html:', message.url);
            await logBlockedAttempt(message.url);
            return { logged: true, url: message.url };

        case 'PING':
            return { pong: true };

        default:
            return { error: 'Unknown message type' };
    }
}

// AI Content Analysis for Adult Detection
async function analyzeContentForAdult(pageData) {
    try {
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];

        if (!token) {
            return { blocked: false, reason: 'not_logged_in' };
        }

        // Call the Firebase Cloud Function
        const response = await fetch(`${CONFIG.FIREBASE_FUNCTIONS_URL}/analyzeContentForAdult`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ data: pageData })
        });

        if (!response.ok) {
            console.log('[ZAS] AI analysis request failed:', response.status);
            return { blocked: false, reason: 'request_failed' };
        }

        const result = await response.json();
        return result.result || result;

    } catch (error) {
        console.error('[ZAS] AI analysis error:', error);
        return { blocked: false, error: error.message };
    }
}

// Log tamper attempts (DevTools, extension disable attempts, etc.)
async function logTamperAttempt(type) {
    try {
        const storage = await chrome.storage.local.get(['stats', CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const stats = storage.stats || { blockedToday: 0, blockedTotal: 0, tamperAttempts: 0 };
        stats.tamperAttempts = (stats.tamperAttempts || 0) + 1;
        stats.lastTamperAttempt = { type, timestamp: Date.now() };
        await chrome.storage.local.set({ stats });

        console.log('[ZAS] Tamper attempt logged:', type);
    } catch (error) {
        console.error('[ZAS] Failed to log tamper attempt:', error);
    }
}

async function logAIBlock(url, classification, confidence) {
    try {
        await incrementAdBlockStat('sites');
        console.log('[ZAS] AI blocked:', url, classification, confidence);
    } catch (error) {
        console.error('[ZAS] Failed to log AI block:', error);
    }
}

async function logContentBlock(url, reason) {
    try {
        await incrementAdBlockStat('sites');
        console.log('[ZAS] Content blocked:', url, reason);
    } catch (error) {
        console.error('[ZAS] Failed to log block:', error);
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
// AD BLOCKER ENGINE FUNCTIONS
// ============================================

// Ad blocker configuration storage keys
const ADBLOCK_CONFIG_KEY = 'adblock_engine_config';
const ADBLOCK_ALLOWLIST_KEY = 'adblock_allowlist';
const ADBLOCK_SITE_MODES_KEY = 'adblock_site_modes';
const ADBLOCK_STATS_KEY = 'adblock_stats';
const ADBLOCK_DAILY_STATS_KEY = 'adblock_daily_stats';

// Default adblock configuration
const ADBLOCK_DEFAULT_CONFIG = {
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

// Category to ruleset mapping
const ADBLOCK_CATEGORY_RULESETS = {
    ads: 'adblock_ads',
    trackers: 'adblock_trackers',
    malware: 'adblock_malware',
    annoyances: 'adblock_annoyances',
    social: 'adblock_social'
};

/**
 * Initialize the ad blocker engine
 */
async function initAdBlockEngine() {
    try {
        console.log('[AdBlock Engine] Initializing...');

        // Load or create config
        const result = await chrome.storage.local.get([ADBLOCK_CONFIG_KEY]);
        const config = result[ADBLOCK_CONFIG_KEY] || { ...ADBLOCK_DEFAULT_CONFIG };

        // Apply initial ruleset state
        await applyAdBlockConfig(config);

        // Set up DNR feedback listener for stats
        setupAdBlockFeedback();

        // Initialize filter lists (EasyList/EasyPrivacy) - inline implementation
        try {
            console.log('[AdBlock Engine] Initializing filter lists...');
            await initFilterLists();
        } catch (filterError) {
            console.warn('[AdBlock Engine] Filter list init error:', filterError.message);
        }

        // Apply critical allowlist (Firebase Auth domains, etc.) at startup
        const existingAllowlist = await handleAdBlockGetAllowlist();
        await applyAdBlockAllowlist(existingAllowlist);

        console.log('[AdBlock Engine] Initialized successfully');
        return true;
    } catch (error) {
        console.error('[AdBlock Engine] Init error:', error);
        return false;
    }
}

// ============================================
// FILTER LIST MANAGEMENT (EasyList/EasyPrivacy)
// ============================================

const FILTER_LISTS = {
    easylist: {
        name: 'EasyList',
        url: 'https://easylist.to/easylist/easylist.txt',
        enabled: true
    },
    easyprivacy: {
        name: 'EasyPrivacy',
        url: 'https://easylist.to/easylist/easyprivacy.txt',
        enabled: true
    },
    peter_lowe: {
        name: "Peter Lowe's List",
        url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
        enabled: true
    }
};

const FILTER_CACHE_KEY = 'adblock_filter_cache';
const FILTER_LAST_UPDATE_KEY = 'adblock_filter_last_update';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Initialize filter lists - fetches and applies EasyList/EasyPrivacy
 */
async function initFilterLists() {
    try {
        // Check if we have cached rules that are recent
        const storage = await chrome.storage.local.get([FILTER_CACHE_KEY, FILTER_LAST_UPDATE_KEY]);
        const lastUpdate = storage[FILTER_LAST_UPDATE_KEY] || 0;
        const cachedRules = storage[FILTER_CACHE_KEY] || [];
        const now = Date.now();

        // Use cache if recent
        if (cachedRules.length > 0 && (now - lastUpdate) < UPDATE_INTERVAL_MS) {
            console.log('[FilterLists] Using cached rules:', cachedRules.length);
            await applyFilterListRules(cachedRules);
            return;
        }

        // Fetch fresh rules
        console.log('[FilterLists] Fetching fresh filter lists...');
        const allRules = [];

        for (const [listId, listConfig] of Object.entries(FILTER_LISTS)) {
            if (!listConfig.enabled) continue;

            try {
                console.log(`[FilterLists] Fetching ${listConfig.name}...`);
                const rules = await fetchAndParseFilterList(listConfig.url);
                console.log(`[FilterLists] ${listConfig.name}: ${rules.length} rules`);
                allRules.push(...rules);
            } catch (e) {
                console.warn(`[FilterLists] Failed to fetch ${listConfig.name}:`, e.message);
            }
        }

        // Deduplicate
        const uniqueRules = deduplicateFilterRules(allRules);
        console.log('[FilterLists] Total unique rules:', uniqueRules.length);

        // Cache and apply
        await chrome.storage.local.set({
            [FILTER_CACHE_KEY]: uniqueRules.slice(0, 5000), // Store up to 5K
            [FILTER_LAST_UPDATE_KEY]: now
        });

        await applyFilterListRules(uniqueRules);

    } catch (error) {
        console.error('[FilterLists] Error:', error);
    }
}

/**
 * Fetch and parse a single filter list
 */
async function fetchAndParseFilterList(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const lines = text.split('\n');
    const rules = [];
    let ruleId = 200000; // Start at 200000 for dynamic filter rules

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Skip comments, empty lines, cosmetic rules
        if (!line || line.startsWith('!') || line.startsWith('[') ||
            line.includes('##') || line.includes('#@#')) {
            continue;
        }

        // Skip exception rules for now
        if (line.startsWith('@@')) continue;

        // Parse the pattern
        let pattern = line;

        // Remove options for simplicity
        const dollarIndex = pattern.lastIndexOf('$');
        if (dollarIndex > 0) {
            pattern = pattern.substring(0, dollarIndex);
        }

        // Handle ||domain^ pattern
        if (pattern.startsWith('||')) {
            pattern = pattern.substring(2).replace(/[\^|]+$/, '');

            // Skip very short patterns or patterns with special chars
            if (pattern.length < 4 || pattern.includes('*') || pattern.includes('/')) {
                continue;
            }

            rules.push({
                id: ruleId++,
                priority: 1,
                action: { type: 'block' },
                condition: {
                    urlFilter: `||${pattern}`,
                    resourceTypes: ['script', 'image', 'stylesheet', 'xmlhttprequest', 'sub_frame', 'other']
                }
            });

            // Limit rules per list
            if (rules.length >= 2000) break;
        }
    }

    return rules;
}

/**
 * Deduplicate rules by urlFilter
 */
function deduplicateFilterRules(rules) {
    const seen = new Set();
    const unique = [];
    let id = 200000;

    for (const rule of rules) {
        const key = rule.condition?.urlFilter;
        if (key && !seen.has(key)) {
            seen.add(key);
            rule.id = id++;
            unique.push(rule);
        }
    }

    return unique;
}

/**
 * Apply parsed filter rules to Chrome DNR
 */
let filterListUpdateInProgress = false;

async function applyFilterListRules(rules) {
    // Prevent concurrent updates
    if (filterListUpdateInProgress) {
        console.log('[FilterLists] Update already in progress, skipping');
        return;
    }

    filterListUpdateInProgress = true;

    try {
        // Get existing dynamic rules
        const existing = await chrome.declarativeNetRequest.getDynamicRules();
        console.log('[FilterLists] Existing dynamic rules:', existing.length);

        // Find all filter list rule IDs (>= 200000)
        const toRemove = existing.filter(r => r.id >= 200000).map(r => r.id);
        console.log('[FilterLists] Rules to remove:', toRemove.length);

        // Chrome limit: 5000 dynamic rules
        const sourceRules = rules.slice(0, 4500);

        // Build rules with SEQUENTIAL unique IDs starting from 200000
        const toAdd = [];
        const seenUrlFilters = new Set();
        let nextId = 200000;

        for (const rule of sourceRules) {
            // Skip invalid rules
            if (!rule.condition?.urlFilter) continue;

            // Skip duplicates
            const urlFilter = rule.condition.urlFilter;
            if (seenUrlFilters.has(urlFilter)) continue;
            seenUrlFilters.add(urlFilter);

            toAdd.push({
                id: nextId++,
                priority: 1,
                action: { type: 'block' },
                condition: {
                    urlFilter: urlFilter,
                    resourceTypes: ['script', 'image', 'stylesheet', 'xmlhttprequest', 'sub_frame', 'other'],
                    excludedRequestDomains: [
                        'identitytoolkit.googleapis.com',
                        'securetoken.googleapis.com',
                        'zassafeguard.com',
                        'zas-safeguard.web.app',
                        'firebaseapp.com',
                        'cloudfunctions.net'
                    ]
                }
            });
        }

        console.log('[FilterLists] Prepared', toAdd.length, 'unique rules (IDs: 200000 -', nextId - 1, ')');

        // ATOMIC update: remove and add in single call
        if (toRemove.length > 0 || toAdd.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: toRemove,
                addRules: toAdd
            });
            console.log('[FilterLists] Applied', toAdd.length, 'dynamic rules successfully');
        }
    } catch (error) {
        console.error('[FilterLists] Failed to apply rules:', error);
        // On failure, try to clear cache
        await chrome.storage.local.remove([FILTER_CACHE_KEY, FILTER_LAST_UPDATE_KEY]);
        console.log('[FilterLists] Cleared cache due to error');
    } finally {
        filterListUpdateInProgress = false;
    }
}

/**
 * Apply adblock configuration to DNR rulesets
 */
async function applyAdBlockConfig(config) {
    try {
        if (!config.enabled) {
            // Disable all adblock rulesets
            const rulesetIds = Object.values(ADBLOCK_CATEGORY_RULESETS);
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                disableRulesetIds: rulesetIds
            });
            return;
        }

        const enableIds = [];
        const disableIds = [];

        for (const [category, enabled] of Object.entries(config.categories)) {
            const rulesetId = ADBLOCK_CATEGORY_RULESETS[category];
            if (rulesetId) {
                if (enabled) {
                    enableIds.push(rulesetId);
                } else {
                    disableIds.push(rulesetId);
                }
            }
        }

        if (enableIds.length > 0 || disableIds.length > 0) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
                enableRulesetIds: enableIds,
                disableRulesetIds: disableIds
            });
        }

        console.log('[AdBlock Engine] Applied config:', { enabled: enableIds, disabled: disableIds });
    } catch (error) {
        console.error('[AdBlock Engine] Apply config error:', error);
    }
}

/**
 * Set up DNR feedback listener for tracking blocked requests
 */
function setupAdBlockFeedback() {
    // Domains to exclude from ad block counting (our own sites)
    const EXCLUDE_FROM_COUNTING = [
        'zassafeguard.com',
        'zas-safeguard.web.app',
        'zasgloballlc.com',
        'localhost'
    ];

    // Listen for matched rules to track stats
    if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
        chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
            // Skip counting for ZAS domains
            try {
                const url = new URL(info.request.url);
                const initiator = info.request.initiator ? new URL(info.request.initiator).hostname : '';

                // Don't count blocks that are FROM or TO our own sites
                if (EXCLUDE_FROM_COUNTING.some(d => url.hostname.includes(d) || initiator.includes(d))) {
                    return; // Skip counting
                }
            } catch (e) {
                // URL parsing failed, skip
            }

            // Determine category from ruleset ID
            const rulesetId = info.rule.rulesetId;
            let category = 'ads';

            for (const [cat, rsId] of Object.entries(ADBLOCK_CATEGORY_RULESETS)) {
                if (rsId === rulesetId) {
                    category = cat;
                    break;
                }
            }

            // Increment stats
            await incrementAdBlockStat(category);
        });

        console.log('[AdBlock Engine] Stats tracking enabled');
    } else {
        console.log('[AdBlock Engine] Stats tracking not available (declarativeNetRequestFeedback permission needed for debug mode)');
    }
}

/**
 * Increment blocked count for a category
 */
/**
 * Increment blocked count for a category
 */
async function incrementAdBlockStat(category = 'ads', amount = 1) {
    try {
        const todayKey = new Date().toISOString().split('T')[0];
        const result = await chrome.storage.local.get([ADBLOCK_STATS_KEY, ADBLOCK_DAILY_STATS_KEY, 'stats', CONFIG.USER_TOKEN_KEY, 'adblock_pending_log']);

        // Update total stats
        const stats = result[ADBLOCK_STATS_KEY] || { totalBlocked: 0, categories: {} };
        stats.totalBlocked += amount;
        stats.categories[category] = (stats.categories[category] || 0) + amount;
        stats.lastUpdated = Date.now();

        // Update daily stats
        const dailyStats = result[ADBLOCK_DAILY_STATS_KEY] || {};
        if (!dailyStats[todayKey]) {
            dailyStats[todayKey] = { ads: 0, trackers: 0, malware: 0, annoyances: 0, social: 0, total: 0 };
        }

        // Ensure category initialized
        if (typeof dailyStats[todayKey][category] !== 'number') {
            dailyStats[todayKey][category] = 0;
        }

        dailyStats[todayKey][category] += amount;
        dailyStats[todayKey].total += amount;

        // Update popup stats for compatibility
        const popupStats = result.stats || { blockedToday: 0, blockedTotal: 0 };
        popupStats.blockedToday = dailyStats[todayKey].total;
        popupStats.blockedTotal = stats.totalBlocked;

        // Track pending count for Firestore batch logging
        let pendingLog = result.adblock_pending_log || 0;
        pendingLog += amount;

        await chrome.storage.local.set({
            [ADBLOCK_STATS_KEY]: stats,
            [ADBLOCK_DAILY_STATS_KEY]: dailyStats,
            stats: popupStats,
            adblock_pending_log: pendingLog
        });

        console.log(`[AdBlock Engine] Stats updated: +${amount} ${category} (Today: ${dailyStats[todayKey].total})`);

        // Log to Firestore every 10 blocks (batch to reduce API calls)
        const token = result[CONFIG.USER_TOKEN_KEY];
        if (token && pendingLog >= 10) {
            try {
                await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logBlockEventHttp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        action: 'ad_blocked',
                        category: category,
                        count: pendingLog,
                        url: 'batch'
                    })
                });
                // Reset pending counter
                await chrome.storage.local.set({ adblock_pending_log: 0 });
                console.log('[AdBlock Engine] Synced', pendingLog, 'blocks to Firestore');
            } catch (e) {
                // Silent fail - will retry next batch
            }
        }
    } catch (error) {
        console.error('[AdBlock Engine] Stats error:', error);
    }
}

/**
 * Handle enabling the ad blocker
 */
async function handleAdBlockEnable() {
    const result = await chrome.storage.local.get([ADBLOCK_CONFIG_KEY]);
    const config = result[ADBLOCK_CONFIG_KEY] || { ...ADBLOCK_DEFAULT_CONFIG };
    config.enabled = true;
    await chrome.storage.local.set({ [ADBLOCK_CONFIG_KEY]: config });
    await applyAdBlockConfig(config);
    console.log('[AdBlock Engine] Enabled');
}

/**
 * Handle disabling the ad blocker
 */
async function handleAdBlockDisable() {
    const result = await chrome.storage.local.get([ADBLOCK_CONFIG_KEY]);
    const config = result[ADBLOCK_CONFIG_KEY] || { ...ADBLOCK_DEFAULT_CONFIG };
    config.enabled = false;
    await chrome.storage.local.set({ [ADBLOCK_CONFIG_KEY]: config });
    await applyAdBlockConfig(config);
    console.log('[AdBlock Engine] Disabled');
}

/**
 * Handle setting a category enabled/disabled
 */
async function handleAdBlockSetCategory(category, enabled) {
    const result = await chrome.storage.local.get([ADBLOCK_CONFIG_KEY]);
    const config = result[ADBLOCK_CONFIG_KEY] || { ...ADBLOCK_DEFAULT_CONFIG };

    if (config.categories.hasOwnProperty(category)) {
        config.categories[category] = enabled;
        await chrome.storage.local.set({ [ADBLOCK_CONFIG_KEY]: config });
        await applyAdBlockConfig(config);
        console.log('[AdBlock Engine] Category', category, enabled ? 'enabled' : 'disabled');
    }
}

/**
 * Handle adding domain to allowlist
 */
async function handleAdBlockAddAllowlist(domain) {
    const result = await chrome.storage.local.get([ADBLOCK_ALLOWLIST_KEY]);
    const allowlist = result[ADBLOCK_ALLOWLIST_KEY] || [];

    if (!allowlist.includes(domain)) {
        allowlist.push(domain);
        await chrome.storage.local.set({ [ADBLOCK_ALLOWLIST_KEY]: allowlist });
        await applyAdBlockAllowlist(allowlist);
        console.log('[AdBlock Engine] Added to allowlist:', domain);
    }
}

/**
 * Handle removing domain from allowlist
 */
async function handleAdBlockRemoveAllowlist(domain) {
    const result = await chrome.storage.local.get([ADBLOCK_ALLOWLIST_KEY]);
    let allowlist = result[ADBLOCK_ALLOWLIST_KEY] || [];

    allowlist = allowlist.filter(d => d !== domain);
    await chrome.storage.local.set({ [ADBLOCK_ALLOWLIST_KEY]: allowlist });
    await applyAdBlockAllowlist(allowlist);
    console.log('[AdBlock Engine] Removed from allowlist:', domain);
}

/**
 * Handle getting allowlist
 */
async function handleAdBlockGetAllowlist() {
    const result = await chrome.storage.local.get([ADBLOCK_ALLOWLIST_KEY]);
    return result[ADBLOCK_ALLOWLIST_KEY] || [];
}

/**
 * Apply allowlist as dynamic DNR rules
 */
// Critical domains that must NEVER be blocked (Firebase Auth, etc.)
const CRITICAL_ALLOWLIST = [
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'zassafeguard.com',
    'zas-safeguard.web.app',
    'firebaseapp.com',
    'cloudfunctions.net'
];

async function applyAdBlockAllowlist(domains) {
    try {
        const ALLOWLIST_RULE_START = 50000;

        // Merge user domains with critical domains (Firebase Auth, etc.)
        const allDomains = [...new Set([...CRITICAL_ALLOWLIST, ...domains])];

        // Get existing dynamic rules
        const existing = await chrome.declarativeNetRequest.getDynamicRules();

        // Find allowlist rule IDs to remove
        const allowlistIds = existing
            .filter(r => r.id >= ALLOWLIST_RULE_START && r.id < 55000)
            .map(r => r.id);

        // Generate new allow rules
        const newRules = allDomains.map((domain, index) => ({
            id: ALLOWLIST_RULE_START + index,
            priority: 100, // Higher priority than block rules
            action: { type: 'allow' },
            condition: {
                requestDomains: [domain.replace(/^www\./, '')],
                resourceTypes: ['main_frame', 'sub_frame', 'script', 'image', 'stylesheet', 'object', 'xmlhttprequest', 'media', 'font', 'ping', 'other']
            }
        }));

        // Apply update
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: allowlistIds,
            addRules: newRules.slice(0, 500) // Limit to 500
        });

        console.log('[AdBlock Engine] Applied', newRules.length, 'allowlist rules (including', CRITICAL_ALLOWLIST.length, 'critical domains)');
    } catch (error) {
        console.error('[AdBlock Engine] Allowlist error:', error);
    }
}

/**
 * Handle setting site mode
 */
async function handleAdBlockSetSiteMode(domain, mode) {
    const result = await chrome.storage.local.get([ADBLOCK_SITE_MODES_KEY]);
    const modes = result[ADBLOCK_SITE_MODES_KEY] || {};

    if (mode === 'strict') {
        delete modes[domain];
    } else {
        modes[domain] = mode;
    }

    await chrome.storage.local.set({ [ADBLOCK_SITE_MODES_KEY]: modes });

    // If mode is 'off', add to allowlist
    if (mode === 'off') {
        await handleAdBlockAddAllowlist(domain);
    } else {
        await handleAdBlockRemoveAllowlist(domain);
    }

    console.log('[AdBlock Engine] Set site mode:', domain, mode);
}

/**
 * Handle getting stats
 */
async function handleAdBlockGetStats() {
    const todayKey = new Date().toISOString().split('T')[0];
    const result = await chrome.storage.local.get([ADBLOCK_STATS_KEY, ADBLOCK_DAILY_STATS_KEY]);

    const stats = result[ADBLOCK_STATS_KEY] || { totalBlocked: 0, categories: {} };
    const dailyStats = result[ADBLOCK_DAILY_STATS_KEY] || {};

    return {
        blockedToday: dailyStats[todayKey]?.total || 0,
        blockedTotal: stats.totalBlocked || 0,
        todayByCategory: dailyStats[todayKey] || {},
        totalByCategory: stats.categories || {}
    };
}

/**
 * Handle getting config
 */
async function handleAdBlockGetConfig() {
    const result = await chrome.storage.local.get([ADBLOCK_CONFIG_KEY]);
    return result[ADBLOCK_CONFIG_KEY] || { ...ADBLOCK_DEFAULT_CONFIG };
}

// ============================================
// STARTUP
// ============================================

// Track navigation (Removed estimation logic per user request for real data only)
// Now relying purely on:
// 1. Cosmetic filter matches (from content script)
// 2. Navigation errors (blocked sites/frames)
chrome.webNavigation.onCompleted.addListener(async (details) => {
    // Listener kept empty to allow for future logic if needed, 
    // but removed estimation to ensure accuracy.
});

// Track failed navigations (blocked sites)
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
    // Check for blocked by client (DNR block)
    if (details.error === 'net::ERR_BLOCKED_BY_CLIENT') {
        const hostname = new URL(details.url).hostname;
        console.log('[ZAS] Navigation blocked by client:', hostname);

        // This is likely a blocked site (or a blocked ad frame)
        if (details.frameId === 0) {
            // Main frame blocked -> Site Blocked
            incrementAdBlockStat('sites');
        } else {
            // Subframe blocked -> Ad/Tracker Blocked
            incrementAdBlockStat('ads');
        }
    }
});


// Ensure blocking is active on service worker start
(async () => {
    await ensureOfflineBlocking();
    await initAdBlockEngine();
    console.log('ZAS Safeguard background service worker started');
})();
