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

import * as AdBlockEngine from './lib/adblock/engine.js';

// ============================================
// CONFIGURATION
// ============================================
// ─────────────────────────────────────────────────────────────
// CONFIG — all URLs centralised here (Issue 04A)
// No inline fetch URLs anywhere else in the file
// ─────────────────────────────────────────────────────────────
const CONFIG = {
    FIREBASE_API_ENDPOINT: 'https://us-central1-zas-safeguard.cloudfunctions.net',
    FIREBASE_FUNCTIONS_URL: 'https://us-central1-zas-safeguard.cloudfunctions.net',
    UPDATE_DEVICE_STATUS_URL: 'https://updatedevicestatus-xwlk3qzrrq-uc.a.run.app',
    REGISTER_DEVICE_URL: 'https://us-central1-zas-safeguard.cloudfunctions.net/registerDevice',
    CHECK_URL_REPUTATION_URL: 'https://us-central1-zas-safeguard.cloudfunctions.net/checkUrlReputation',

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
const EXTENSION_VERSION = '1.2.0';

// L-02: Token expiry constant (Firebase tokens expire after 1 hour)
const TOKEN_MAX_AGE_MS = 55 * 60 * 1000; // 55 minutes — refresh before expiry

/**
 * L-02: Returns a valid (non-expired) token or null if expired/missing.
 * Callers should handle null by skipping authenticated requests.
 */
async function getValidToken() {
    const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, 'token_timestamp']);
    const token = storage[CONFIG.USER_TOKEN_KEY];
    const timestamp = storage.token_timestamp || 0;
    if (!token) return null;
    if (Date.now() - timestamp > TOKEN_MAX_AGE_MS) {
        console.warn('[Auth] Token expired (>55 min). Requesting refresh.');
        requestTokenRefreshFromWebApp();
        return null;
    }
    return token;
}

/**
 * L-02: Ask any open ZAS dashboard tab to send a refreshed Firebase token.
 */
async function requestTokenRefreshFromWebApp() {
    try {
        const tabs = await chrome.tabs.query({
            url: ['*://*.zasgloballlc.com/*', '*://*.zas-safeguard.web.app/*', '*://localhost/*']
        });
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_TOKEN' }).catch(() => { });
        }
    } catch (e) {
        console.warn('[Auth] Token refresh request failed:', e.message);
    }
}

// L-02: Set up periodic token refresh alarm (every 45 minutes)
chrome.alarms.create('TOKEN_REFRESH', { periodInMinutes: 45 });
// Single unified alarm listener — all alarm names handled here
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'TOKEN_REFRESH') {
        requestTokenRefreshFromWebApp();
    } else if (alarm.name === 'syncBlocklist') {
        await syncWithFirebase();
    } else if (alarm.name === 'heartbeat') {
        await sendHeartbeat();
    }
});

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
// SUBSCRIPTION VERIFICATION — SERVER-VERIFIED
// ============================================
// ZAS Safeguard — AI Browser Security Platform
// chrome.storage.local is ONLY a cache. verifySubscription is the single entitlement authority.
// getBlockPolicy returns blocking rules only — never determines premium access.
//
// Source of truth chain:
//   Stripe → Firestore → verifySubscription → Extension cache → Enforcement
//
// Network failure policy (locked):
//   - Previously verified paid user: 1-hour grace → then fail closed
//   - Free user or no prior verification: fail closed immediately
//   - Tier 1 (adult_blocking / ruleset_block): ALWAYS active regardless of state
//   - Tier 4 (optional): disabled during grace/failure

const VERIFICATION_TTL_MS = 10 * 60 * 1000;    // 10 minutes
const GRACE_PERIOD_MS = 60 * 60 * 1000;         // 1 hour for verified paid users only
const VERIFY_ENDPOINT = `${CONFIG.FIREBASE_API_ENDPOINT}/verifySubscription`;

// ============================================
// PLAN CAPABILITY MATRIX (Locked — must match server)
// ============================================
// 8 feature flags × 4 plan tiers
// Layers:
//   Local protection:    adult_blocking (free), category_blocking (premium)
//   Cloud intelligence:  security_intelligence, url_scanning, advanced_alerts
//   User controls:       study_mode
//   Account controls:    analytics, dashboard_admin

const PLAN_CAPABILITIES = {
    free: {
        adult_blocking: true,
        security_intelligence: false,
        url_scanning: false,
        category_blocking: false,
        study_mode: false,
        analytics: false,
        dashboard_admin: false,
        advanced_alerts: false
    },
    trial: {
        adult_blocking: true,
        security_intelligence: true,
        url_scanning: true,
        category_blocking: true,
        study_mode: true,
        analytics: true,
        dashboard_admin: true,
        advanced_alerts: true
    },
    premium: {
        adult_blocking: true,
        security_intelligence: true,
        url_scanning: true,
        category_blocking: true,
        study_mode: true,
        analytics: true,
        dashboard_admin: true,
        advanced_alerts: true
    },
    expired: {
        adult_blocking: true,
        security_intelligence: false,
        url_scanning: false,
        category_blocking: false,
        study_mode: false,
        analytics: false,
        dashboard_admin: false,
        advanced_alerts: false
    }
};

/**
 * Check if a feature is available for the current verified plan.
 * @param {string} featureName - e.g. 'security_intelligence', 'study_mode'
 * @param {object|null} verifiedState - Cached verification from storage
 * @returns {boolean}
 */
function canUseFeature(featureName, verifiedState) {
    if (!verifiedState || !verifiedState.verified) {
        return featureName === 'adult_blocking';
    }
    if (verifiedState.capabilities) {
        return verifiedState.capabilities[featureName] === true;
    }
    const caps = verifiedState.active
        ? (PLAN_CAPABILITIES[verifiedState.plan] || PLAN_CAPABILITIES.expired)
        : PLAN_CAPABILITIES.expired;
    return caps[featureName] === true;
}

/**
 * Check if the cached verification is still valid.
 * Rules:
 *   - Within TTL (≤10min): fully valid
 *   - Within grace (≤1hr) AND previously verified active PAID user: valid but stale
 *   - Free users: NO grace period
 *   - Beyond grace or no prior verification: invalid → fail closed
 */
function checkCacheValidity(cached) {
    if (!cached || !cached.lastVerifiedAt || !cached.verified) {
        return { valid: false, expired: true, graceActive: false };
    }
    const age = Date.now() - cached.lastVerifiedAt;
    if (age <= VERIFICATION_TTL_MS) {
        return { valid: true, expired: false, graceActive: false };
    }
    // Grace period ONLY for previously verified active PAID users
    if (age <= GRACE_PERIOD_MS && cached.active === true && cached.plan !== 'free' && cached.plan !== 'expired') {
        return { valid: true, expired: true, graceActive: true };
    }
    return { valid: false, expired: true, graceActive: false };
}

/**
 * Verify subscription with the server (single entitlement authority).
 * This is the ONLY way to enable premium features.
 * @param {boolean} force - If true, skip cache check
 * @returns {object} Verified subscription state
 */
async function verifySubscriptionWithServer(force = false) {
    try {
        // Check cache first (unless forced)
        if (!force) {
            const stored = await chrome.storage.local.get(['_verifiedSubscription']);
            const cached = stored._verifiedSubscription;
            const cacheStatus = checkCacheValidity(cached);
            if (cacheStatus.valid && !cacheStatus.expired) {
                console.log('[Security] Using cached verification (valid)');
                return cached;
            }
            if (cacheStatus.graceActive) {
                console.warn('[Security] Cache stale — grace period active, re-verifying...');
            }
        }

        // Get auth token
        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];

        if (!token) {
            console.log('[Security] No auth token — free tier only');
            const freeState = {
                verified: true,
                active: false,
                plan: 'free',
                plan_status: 'inactive',
                capabilities: PLAN_CAPABILITIES.free,
                lastVerifiedAt: Date.now()
            };
            await chrome.storage.local.set({ _verifiedSubscription: freeState });
            return freeState;
        }

        // Call server verification endpoint
        console.log('[Security] Calling verifySubscription...');
        const response = await fetch(VERIFY_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ data: {} })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const responseData = await response.json();
        const result = responseData.result || responseData;

        if (!result.verified) {
            throw new Error('Server returned unverified response');
        }

        // Store verified state with timestamp
        const verifiedState = {
            ...result,
            lastVerifiedAt: Date.now()
        };

        await chrome.storage.local.set({
            _verifiedSubscription: verifiedState,
            // Legacy fields for backward compatibility
            planType: result.plan,
            subscriptionStatus: result.plan_status,
            trialEndDate: result.trial_end || null,
            subscriptionEndDate: result.current_period_end || null
        });

        console.log('[Security] Verification successful:', result.plan, result.plan_status);
        return verifiedState;

    } catch (error) {
        console.error('[Security] Verification failed:', error.message);

        // On network failure, check grace period
        const stored = await chrome.storage.local.get(['_verifiedSubscription']);
        const cached = stored._verifiedSubscription;
        const cacheStatus = checkCacheValidity(cached);

        if (cacheStatus.graceActive) {
            console.warn('[Security] Network failure — using grace period (paid user, 1hr max)');
            return cached;
        }

        // No valid cache — fail closed (free tier / core safety only)
        console.warn('[Security] No valid cache — fail closed, core safety only');
        const failSafeState = {
            verified: true,
            active: false,
            plan: 'expired',
            plan_status: 'inactive',
            capabilities: PLAN_CAPABILITIES.expired,
            lastVerifiedAt: Date.now(),
            failedVerification: true
        };
        await chrome.storage.local.set({ _verifiedSubscription: failSafeState });
        return failSafeState;
    }
}

/**
 * Enable or disable protection tiers based on VERIFIED server state.
 *
 * Tier 1: Core Safety — ruleset_block — ALWAYS active, never disabled
 * Tier 2: Security Intelligence — adblock_malware — requires security_intelligence
 * Tier 3: Ad Filtering + Privacy — adblock_ads, adblock_trackers, adblock_youtube — requires security_intelligence
 * Tier 4: Optional QoL — adblock_annoyances, adblock_social — requires security_intelligence + user opt-in; DISABLED during grace/failure
 *
 * @param {boolean} forceVerify - If true, bypass cache and force server re-verification
 */
async function enforceSubscriptionStatus(forceVerify = false) {
    try {
        // FAIL-CLOSED: Immediately disable ALL premium rulesets before async verification
        // This ensures no stale cache can keep premium features running
        const allPremiumRulesets = ['adblock_malware', 'adblock_ads', 'adblock_trackers', 'adblock_youtube', 'adblock_annoyances', 'adblock_social'];
        await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: ['ruleset_block'],  // Core safety always ON
            disableRulesetIds: allPremiumRulesets
        });
        console.log('[Security] Fail-closed: all premium rulesets disabled pending verification');

        // Now verify with server
        const verified = await verifySubscriptionWithServer(forceVerify);
        const capabilities = verified?.capabilities || PLAN_CAPABILITIES.expired;
        const isActive = verified?.active === true;
        const isGraceOrFailure = verified?.failedVerification === true ||
            (checkCacheValidity(verified).graceActive);

        console.log('[Security] Enforcing:', isActive ? 'PREMIUM' : 'FREE',
            '| Plan:', verified?.plan || 'unknown',
            '| Grace:', isGraceOrFailure);

        // Only re-enable premium rulesets if server confirms entitlement
        if (capabilities.security_intelligence) {
            const enableIds = ['adblock_malware', 'adblock_ads', 'adblock_trackers', 'adblock_youtube'];

            // Tier 4: Optional — disabled during grace/failure
            if (!isGraceOrFailure) {
                const config = await chrome.storage.local.get(['adblock_config']);
                const adConfig = config.adblock_config || {};
                if (adConfig.categories?.annoyances) enableIds.push('adblock_annoyances');
                if (adConfig.categories?.social) enableIds.push('adblock_social');
            }

            await chrome.declarativeNetRequest.updateEnabledRulesets({
                enableRulesetIds: enableIds,
                disableRulesetIds: []
            });
            console.log('[Security] Premium verified — rulesets re-enabled:', enableIds);
        } else {
            console.log('[Security] Not entitled — premium rulesets remain disabled');
        }

        // If not active, also clear dynamic rules
        if (!isActive) {
            const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
            const existingIds = existingRules.map(rule => rule.id);
            if (existingIds.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
            }
        }

        // Diagnostics
        const ruleCount = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
        console.log('[Security] Available static rules:', ruleCount);

    } catch (error) {
        console.error('[Security] Error enforcing protection status:', error);
        // On error, premium rulesets are already disabled (fail-closed above)
    }
}

// Periodic verification (every 5 minutes)
setInterval(enforceSubscriptionStatus, 5 * 60 * 1000);

// React to verified subscription changes only (not legacy fields)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes._verifiedSubscription) {
        enforceSubscriptionStatus();
    }
});


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
    await initAdBlockEngine();

    // Enforce subscription status AFTER adblock init — force server re-verification
    await enforceSubscriptionStatus(true);
});

// ============================================
// EXTERNAL MESSAGE HANDLER (from dashboard)
// ============================================
// Message allowlist — only these types are accepted
const ALLOWED_MESSAGE_TYPES = [
    'TOS_AGREED', 'PLAN_UPDATE', 'LOGIN', 'LOGOUT',
    'STUDY_MODE_START', 'STUDY_MODE_STOP', 'CATEGORY_TOGGLE',
    'SETTINGS_UPDATE', 'CHILD_LOCK', 'GET_EXTENSION_ID',
    'ADBLOCK_GET_STATS', 'ADBLOCK_SET_CATEGORY',
    'ADBLOCK_ADD_ALLOWLIST', 'ADBLOCK_REMOVE_ALLOWLIST'
];

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // Reject unknown message types
    if (!message || !ALLOWED_MESSAGE_TYPES.includes(message.type)) {
        console.warn('[Messages] Rejected unknown message type:', message?.type);
        sendResponse({ error: 'Unknown message type' });
        return true;
    }

    if (message.type === 'TOS_AGREED') {
        chrome.storage.local.set({ tosAgreed: true });
        sendResponse({ success: true });
        console.log('TOS agreed by user');
    }
    if (message.type === 'PLAN_UPDATE') {
        // SECURITY: Do NOT write plan directly to storage.
        // Instead, trigger server re-verification.
        console.log('[Subscription] PLAN_UPDATE received — triggering server verification');
        verifySubscriptionWithServer(true).then(() => {
            enforceSubscriptionStatus();
            sendResponse({ success: true });
        }).catch(err => {
            console.error('[Subscription] Re-verification after PLAN_UPDATE failed:', err);
            sendResponse({ success: false, error: 'Verification failed' });
        });
        return true; // Keep channel open for async
    }
    // Handle LOGIN from dashboard - store Firebase auth token
    if (message.type === 'LOGIN') {
        console.log('[Auth] Received LOGIN from dashboard');
        if (message.token) {
            chrome.storage.local.set({
                [CONFIG.USER_TOKEN_KEY]: message.token,
                loggedInUserId: message.userId,
                // L-02: Track token issue time for expiry detection
                token_timestamp: Date.now()
            }).then(async () => {
                // Register device with Firebase (creates device in Firestore)
                await registerDeviceWithFirebase(message.userId, message.token);
                // Sync immediately after login
                await syncWithFirebase();
                // Verify subscription with server after login
                await verifySubscriptionWithServer(true);
                await enforceSubscriptionStatus();
                sendResponse({ success: true });
            });
        } else {
            sendResponse({ success: false, error: 'No token provided' });
        }
    }
    // Handle LOGOUT from dashboard
    if (message.type === 'LOGOUT') {
        console.log('[Auth] Received LOGOUT from dashboard');
        chrome.storage.local.remove([
            CONFIG.USER_TOKEN_KEY, CONFIG.POLICY_KEY, 'loggedInUserId',
            '_verifiedSubscription', 'planType', 'subscriptionStatus',
            'trialEndDate', 'subscriptionEndDate'
        ]).then(() => {
            // Enforce free tier immediately after logout
            enforceSubscriptionStatus();
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
            // M-07: Removed dead ESSENTIAL_SITES duplicate — CHILD_LOCK_WHITELIST is used by applyChildLock()
            if (message.locked) {
                applyChildLock(true);
            } else {
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
            await AdBlockEngine.setCategory(message.category, message.enabled);
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
// syncBlocklist and heartbeat are handled in the unified alarm listener above

// ─────────────────────────────────────────────────────────────
// UNIFIED INTERNAL MESSAGE HANDLER  (Issue 05)
// Replaces 3 separate addListener registrations that caused
// racing duplicate handlers for PING / LOGIN / LOGOUT / DEV_TOOLS_OPENED.
// Rule: sync handlers return false, async return true.
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Message received:', message.type);

    // ── SYNC handlers — fire-and-forget, return false ──────────

    if (message.type === 'PING') {
        sendResponse({ status: 'alive', version: EXTENSION_VERSION });
        return false;
    }

    if (message.type === 'DEV_TOOLS_OPENED') {
        console.log('[Security] DevTools opened on:', message.url);
        logSecurityEvent('DEVTOOLS_OPENED', { url: message.url, severity: 'medium' });
        logTamperAttempt('dev_tools_opened');
        sendResponse({ received: true });
        return false;
    }

    if (message.type === 'ADBLOCK_BREAKAGE') {
        logSecurityEvent('ADBLOCK_BREAKAGE', { domain: message.domain, severity: 'low' });
        sendResponse({ received: true }); return false;
    }

    if (message.type === 'ADBLOCK_COSMETIC_STATS') {
        (async () => {
            for (let i = 0; i < Math.min(message.count, 100); i++)
                await incrementAdBlockStat('ads');
        })();
        sendResponse({ received: true }); return false;
    }

    if (message.type === 'VISIBILITY_CHANGE') {
        if (message.hidden) console.log('[ZAS] Tab hidden:', message.url);
        sendResponse({ received: true }); return false;
    }

    // ── ASYNC handlers — keep channel open, return true ────────

    if (message.type === 'PAGE_UNLOAD') {
        sendGracefulOffline(message.hint || 'page_unload');
        sendResponse({ received: true }); return true;
    }

    if (message.type === 'ADBLOCK_ENABLE') { handleAdBlockEnable().then(() => sendResponse({ success: true })); return true; }
    if (message.type === 'ADBLOCK_DISABLE') { handleAdBlockDisable().then(() => sendResponse({ success: true })); return true; }
    if (message.type === 'ADBLOCK_SET_CATEGORY') { handleAdBlockSetCategory(message.category, message.enabled).then(() => sendResponse({ success: true })); return true; }
    if (message.type === 'ADBLOCK_ADD_ALLOWLIST') { handleAdBlockAddAllowlist(message.domain).then(() => sendResponse({ success: true })); return true; }
    if (message.type === 'ADBLOCK_REMOVE_ALLOWLIST') { handleAdBlockRemoveAllowlist(message.domain).then(() => sendResponse({ success: true })); return true; }
    if (message.type === 'ADBLOCK_GET_ALLOWLIST') { handleAdBlockGetAllowlist().then(list => sendResponse({ allowlist: list })); return true; }
    if (message.type === 'ADBLOCK_SET_SITE_MODE') { handleAdBlockSetSiteMode(message.domain, message.mode).then(() => sendResponse({ success: true })); return true; }
    if (message.type === 'ADBLOCK_GET_STATS') { handleAdBlockGetStats().then(stats => sendResponse({ stats })); return true; }
    if (message.type === 'ADBLOCK_GET_CONFIG') { handleAdBlockGetConfig().then(config => sendResponse({ config })); return true; }

    if (message.type === 'GET_TOKEN') {
        (async () => {
            try {
                const validToken = await getValidToken();
                sendResponse({ token: validToken || null });
            } catch (e) {
                sendResponse({ token: null, error: e.message });
            }
        })();
        return true;
    }

    if (message.type === 'SCAN_URL') {
        scanUrlForThreats(message.url)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ safe: true, error: err.message }));
        return true;
    }

    // ── Delegated popup/dashboard types ────────────────────────
    const delegated = [
        'GET_STATUS', 'LOGIN', 'LOGOUT', 'SYNC_NOW', 'RESET_STATS',
        'REQUEST_UNLOCK', 'GET_DEVICE_ID', 'ANALYZE_CONTENT_FOR_ADULT',
        'AI_CONTENT_BLOCKED', 'CONTENT_BLOCKED', 'LOG_BLOCKED_SITE'
    ];
    if (delegated.includes(message.type)) {
        handleMessage(message, sender).then(sendResponse);
        return true;
    }

    console.warn('[Background] Unhandled message type:', message.type);
    sendResponse({ error: 'Unknown message type' });
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

    // Check if user has URL scanning entitlement (server-verified only)
    const storedVerified = await chrome.storage.local.get(['_verifiedSubscription']);
    const verifiedState = storedVerified._verifiedSubscription;
    const hasUrlScanning = canUseFeature('url_scanning', verifiedState);

    console.log('[URLScanner] Entitlement check:', { plan: verifiedState?.plan, hasUrlScanning });

    if (!hasUrlScanning) {
        // URL scanning requires verified entitlement
        console.log('[Security] URL scanning not available for current plan');
        return;
    }

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
            CONFIG.CHECK_URL_REPUTATION_URL,
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
    } catch (e) {
        console.warn('[URLScanner] checkSuspiciousPatterns: could not parse URL:', url, e.message);
    }

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
    } catch (e) {
        console.warn('[URLScanner] checkSignatureDatabase: could not parse URL:', url, e.message);
    }

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
 * L-01: Strips query params & fragment to prevent PII / token leaks
 */
async function logUrlScanEvent(scanResult) {
    try {
        const deviceId = await getDeviceId();
        const storage = await chrome.storage.local.get(CONFIG.USER_TOKEN_KEY);

        if (!storage[CONFIG.USER_TOKEN_KEY]) return;

        // L-01: Strip query parameters and fragment from URL for privacy
        let safeUrl = scanResult.url;
        try {
            const parsed = new URL(safeUrl);
            safeUrl = parsed.origin + parsed.pathname;
        } catch (e) { /* keep original if URL can't be parsed */ }

        await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logUrlScan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${storage[CONFIG.USER_TOKEN_KEY]}`
            },
            body: JSON.stringify({
                ...scanResult,
                url: safeUrl,
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
        // ENTITLEMENT CHECK — use verified subscription state
        // ============================================
        const storedVerified = await chrome.storage.local.get(['_verifiedSubscription']);
        const verifiedState = storedVerified._verifiedSubscription;
        const hasBlocking = canUseFeature('adult_blocking', verifiedState);
        if (!hasBlocking) {
            console.log('[Security] Protection inactive — no verified entitlement');
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
    checkChildLock();
    // Re-enforce entitlement on every browser startup (force re-verify)
    enforceSubscriptionStatus(true);
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

            // Verify subscription via dedicated endpoint (getBlockPolicy no longer returns sub data)
            console.log('[Sync] Triggering subscription verification...');
            await verifySubscriptionWithServer(true);
            await enforceSubscriptionStatus();

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

        // C-02 / M-02: Use fetch + keepalive instead of sendBeacon
        // sendBeacon cannot attach Authorization headers, so the endpoint
        // would receive unauthenticated requests. fetch + keepalive has the
        // same reliability guarantee during page unload but supports headers.
        const url = CONFIG.UPDATE_DEVICE_STATUS_URL;

        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: data,
            keepalive: true
        }).catch(e => { console.warn('[ZAS] Graceful offline fetch failed:', e.message); });

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

// ─────────────────────────────────────────────────────────────
// Issue 05: Listener #2 (VISIBILITY_CHANGE/PAGE_UNLOAD) removed.
// Now handled in the unified onMessage listener above.
// ─────────────────────────────────────────────────────────────

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
    } catch (e) {
        console.warn('[BlockLog] Could not parse URL for domain extraction:', url, e.message);
    }

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

    // ENTITLEMENT CHECK: use verified subscription state
    const storedVerified = await chrome.storage.local.get(['_verifiedSubscription']);
    const verifiedState = storedVerified._verifiedSubscription;
    const hasBlocking = canUseFeature('adult_blocking', verifiedState);
    if (!hasBlocking) {
        console.log('[Security] Protection inactive — skipping offline blocklist check');
        return;
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
        console.log(`[BlockLog] Logging blocked URL: ${hostname}`);

        const storage = await chrome.storage.local.get([CONFIG.USER_TOKEN_KEY, CONFIG.DEVICE_ID_KEY]);
        const token = storage[CONFIG.USER_TOKEN_KEY];
        const deviceId = storage[CONFIG.DEVICE_ID_KEY];

        if (!token) {
            console.log('[BlockLog] No token, skipping log');
            return;
        }

        console.log(`[BlockLog] Sending to logBlockEventHttp with token`);

        // Log to activity logs (use HTTP endpoint for fetch)
        const response = await fetch(`${CONFIG.FIREBASE_API_ENDPOINT}/logBlockEventHttp`, {
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

        console.log(`[BlockLog] Response status: ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[BlockLog] Error: ${errorText}`);
        }

        // Also log as security event for parent alert threshold
        await logBlockedAttempt(hostname);
    } catch (error) {
        console.error('[BlockLog] Error logging blocked URL:', error);
    }
}

// ─────────────────────────────────────────────────────────────
// Issue 05: Listener #3 registration removed.
// handleMessage() still exists — delegated from unified listener above.
// ─────────────────────────────────────────────────────────────

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

        case 'RESET_STATS':
            // Reset all ad blocker stats to 0
            await chrome.storage.local.set({
                stats: { blockedToday: 0, blockedTotal: 0 },
                adblock_stats: { totalBlocked: 0, categories: { ads: 0, trackers: 0, malware: 0, annoyances: 0, social: 0 }, breakageEvents: 0 },
                adblock_daily_stats: {}
            });
            console.log('[Stats] All stats reset to 0');
            return { success: true, message: 'Stats reset' };

        case 'REQUEST_UNLOCK':
            return await requestUnlock();

        case 'GET_DEVICE_ID':
            return { deviceId: await getDeviceId() };

        case 'ANALYZE_CONTENT_FOR_ADULT':
            return await analyzeContentForAdult(message.data);

        case 'AI_CONTENT_BLOCKED':
            await logAIBlock(message.url, message.classification, message.confidence);
            return { logged: true };

        case 'CONTENT_BLOCKED':
            await logContentBlock(message.url, message.reason);
            return { logged: true };

        case 'LOG_BLOCKED_SITE':
            console.log('[Security] Logging blocked site from blocked.html:', message.url);
            await logBlockedAttempt(message.url);
            return { logged: true, url: message.url };

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
        [CONFIG.USER_TOKEN_KEY]: token,
        // L-02: Track when token was stored for expiry detection
        token_timestamp: Date.now()
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
    youtube: 'adblock_youtube',
    annoyances: 'adblock_annoyances',
    social: 'adblock_social'
};

/**
 * Initialize the ad blocker engine — delegates to engine.js (Issue 02)
 */
async function initAdBlockEngine() {
    try {
        console.log('[AdBlock Engine] Delegating to engine.js...');
        const ok = await AdBlockEngine.init();

        // Apply critical allowlist (Firebase Auth domains, etc.) at startup
        const existingAllowlist = await handleAdBlockGetAllowlist();
        await applyAdBlockAllowlist(existingAllowlist);

        console.log('[AdBlock Engine] Initialized via engine.js:', ok);
        return ok;
    } catch (error) {
        console.error('[AdBlock Engine] Init error:', error);
        return false;
    }
}


// ─────────────────────────────────────────────────────────────
// Issue 02: Inline duplicates deleted.
// initFilterLists, fetchAndParseFilterList, deduplicateFilterRules,
// applyFilterListRules, applyAdBlockConfig, setupAdBlockFeedback
// — all now handled inside engine.js.
// ─────────────────────────────────────────────────────────────

/**
 * Increment blocked count for a category.
 * KEPT in background.js — has Firestore batch logging that engine.js doesn't.
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
                await chrome.storage.local.set({ adblock_pending_log: 0 });
            } catch (e) {
                console.warn('[AdBlock Engine] Firestore batch log failed:', e.message);
            }
        }
    } catch (error) {
        console.error('[AdBlock Engine] Stats error:', error);
    }
}

/**
 * Handle enabling the ad blocker
 */
// ─────────────────────────────────────────────────────────────
// Issue 02: handleAdBlock* functions — thin delegations to engine.js
// ─────────────────────────────────────────────────────────────
async function handleAdBlockEnable() { return await AdBlockEngine.enable(); }
async function handleAdBlockDisable() { return await AdBlockEngine.disable(); }
async function handleAdBlockSetCategory(category, enabled) { return await AdBlockEngine.setCategory(category, enabled); }

async function handleAdBlockAddAllowlist(domain) {
    await AdBlockEngine.addToAllowlist(domain);
    // Also apply our critical allowlist overlay
    const list = await AdBlockEngine.getAllowlist();
    await applyAdBlockAllowlist(list);
}

async function handleAdBlockRemoveAllowlist(domain) {
    await AdBlockEngine.removeFromAllowlist(domain);
    const list = await AdBlockEngine.getAllowlist();
    await applyAdBlockAllowlist(list);
}

async function handleAdBlockGetAllowlist() {
    return await AdBlockEngine.getAllowlist();
}

async function handleAdBlockSetSiteMode(domain, mode) {
    await AdBlockEngine.setSiteMode(domain, mode);
    if (mode === 'off') {
        await handleAdBlockAddAllowlist(domain);
    } else {
        await handleAdBlockRemoveAllowlist(domain);
    }
}

async function handleAdBlockGetStats() { return await AdBlockEngine.getStats(); }
async function handleAdBlockGetConfig() { return await AdBlockEngine.getConfig(); }

/**
 * Critical domains that must NEVER be blocked (Firebase Auth, etc.)
 * This is kept in background.js (not engine.js) because it's deployment-specific.
 */
const CRITICAL_ALLOWLIST = [
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'zassafeguard.com',
    'zas-safeguard.web.app',
    'firebaseapp.com',
    'cloudfunctions.net'
];

/**
 * Apply allowlist as dynamic DNR rules, merging critical domains.
 */
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

// ============================================
// STARTUP
// ============================================

// ─────────────────────────────────────────────────────────────
// Issue 04C: empty webNavigation.onCompleted listener removed.
// Was: chrome.webNavigation.onCompleted.addListener(async () => {})
// Re-add if future implementation is scoped.
// ─────────────────────────────────────────────────────────────

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
