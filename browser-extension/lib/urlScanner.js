/**
 * ZAS Safeguard - URL Scanner Module
 * Main orchestrator for multi-layer URL safety scanning
 */

// Import patterns (will be loaded via manifest)
let urlPatterns = null;
let malwareSignatures = null;
let scanCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const USER_TOKEN_KEY = 'user_token'; // Matches key set by background.js on login
const CHECK_URL_REPUTATION_URL = 'https://us-central1-zas-safeguard.cloudfunctions.net/checkUrlReputation';

/**
 * Initialize the scanner with required data
 */
async function initScanner() {
    try {
        // Load URL patterns
        const patternsResponse = await fetch(chrome.runtime.getURL('lib/urlPatterns.js'));
        const patternsCode = await patternsResponse.text();
        eval(patternsCode);

        // Load malware signatures
        const signaturesResponse = await fetch(chrome.runtime.getURL('lib/malwareSignatures.json'));
        malwareSignatures = await signaturesResponse.json();

        console.log('[URLScanner] Initialized with',
            malwareSignatures.total_entries, 'signatures');
        return true;
    } catch (error) {
        console.error('[URLScanner] Init failed:', error);
        return false;
    }
}

/**
 * Main URL scanning function - runs all layers
 * @param {string} url - URL to scan
 * @returns {Promise<object>} Scan result
 */
async function scanUrl(url) {
    // Check cache first
    const cacheKey = hashUrl(url);
    const cached = scanCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
        return { ...cached.result, cached: true };
    }

    const startTime = Date.now();
    let result = {
        url: url,
        safe: true,
        blocked: false,
        category: 'clean',
        confidence: 100,
        source: null,
        reason: null,
        scannedAt: new Date().toISOString(),
        scanTime: 0
    };

    try {
        // Layer A: Pattern matching (instant)
        const patternResult = checkPatterns(url);
        if (patternResult.blocked) {
            result = {
                ...result,
                safe: false,
                blocked: true,
                category: patternResult.category || 'suspicious',
                confidence: 95,
                source: 'pattern',
                reason: patternResult.reason,
                pattern: patternResult.pattern
            };
            cacheResult(cacheKey, result);
            return result;
        }

        // Layer B: Signature database
        const signatureResult = checkSignatures(url);
        if (signatureResult.blocked) {
            result = {
                ...result,
                safe: false,
                blocked: true,
                category: signatureResult.category,
                confidence: 98,
                source: 'signature',
                reason: 'known_malicious_domain'
            };
            cacheResult(cacheKey, result);
            return result;
        }

        // Layer C: Online reputation check (async)
        try {
            const reputationResult = await checkOnlineReputation(url);
            if (reputationResult && !reputationResult.safe) {
                result = {
                    ...result,
                    safe: false,
                    blocked: reputationResult.confidence > 70,
                    category: reputationResult.category,
                    confidence: reputationResult.confidence,
                    source: 'api',
                    reason: reputationResult.reason
                };
                cacheResult(cacheKey, result);
                return result;
            }
        } catch (apiError) {
            console.warn('[URLScanner] API check failed, continuing:', apiError);
        }

        // URL is clean
        result.scanTime = Date.now() - startTime;
        cacheResult(cacheKey, result);
        return result;

    } catch (error) {
        console.error('[URLScanner] Scan error:', error);
        result.error = error.message;
        return result;
    }
}

/**
 * Layer A: Check URL against hardcoded patterns
 */
function checkPatterns(url) {
    // Malicious patterns
    const MALICIOUS_PATTERNS = [
        /phish/i, /ph1sh/i, /verify-account/i, /confirm-identity/i,
        /account-suspended/i, /reset-password-now/i, /free-crypto/i,
        /crypto-giveaway/i, /wallet-drainer/i, /claim-airdrop/i,
        /binance-verify/i, /coinbase-verify/i, /metamask-verify/i,
        /steam-gift/i, /free-robux/i, /free-vbucks/i,
        /iphone-winner/i, /prize-claim/i, /lottery-winner/i,
        /download-now-free/i, /virus-detected/i, /your-pc-infected/i,
        /grabify/i, /iplogger/i,
        /paypa[l1].*\.(com|net)/i, /amaz[o0]n.*\.(com|net)/i,
        /g[o0]{2}gle.*\.(com|net)/i
    ];

    const TRUSTED_DOMAINS = [
        'google.com', 'youtube.com', 'facebook.com', 'instagram.com',
        'twitter.com', 'x.com', 'microsoft.com', 'apple.com',
        'amazon.com', 'netflix.com', 'github.com', 'reddit.com',
        'paypal.com', 'stripe.com', 'zasgloballlc.com'
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
                reason: 'malicious_pattern',
                pattern: pattern.toString(),
                category: categorizePattern(pattern)
            };
        }
    }

    return { blocked: false };
}

/**
 * Layer B: Check against signature database
 */
function checkSignatures(url) {
    if (!malwareSignatures) {
        return { blocked: false };
    }

    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.toLowerCase();

        // Check each category
        const categories = [
            { list: malwareSignatures.phishing_domains, category: 'phishing' },
            { list: malwareSignatures.malware_domains, category: 'malware' },
            { list: malwareSignatures.crypto_scam_domains, category: 'crypto_scam' },
            { list: malwareSignatures.scam_domains, category: 'scam' },
            { list: malwareSignatures.ip_grabber_domains, category: 'ip_grabber' },
            { list: malwareSignatures.ransomware_c2, category: 'ransomware' },
            { list: malwareSignatures.adult_phishing, category: 'adult_phishing' }
        ];

        for (const { list, category } of categories) {
            if (list && list.some(d => domain.includes(d) || domain === d)) {
                return { blocked: true, category };
            }
        }
    } catch (e) {
        console.warn('[URLScanner] checkSignatures: could not parse URL:', url, e.message);
    }

    return { blocked: false };
}

/**
 * Layer C: Online reputation check via Cloud Function
 * Issue 01 fix: reads token from chrome.storage.local instead of firebase.auth()
 */
async function checkOnlineReputation(url) {
    try {
        const stored = await chrome.storage.local.get([USER_TOKEN_KEY]);
        const token = stored[USER_TOKEN_KEY];
        if (!token) return null; // Not logged in — skip cloud check gracefully

        const response = await fetch(CHECK_URL_REPUTATION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ url })
        });

        if (!response.ok) return null;
        const result = await response.json();
        console.log('[URLScanner] Online check returned a result');
        return result;
    } catch (error) {
        console.warn('[URLScanner] Online check failed:', error.message);
        return null;
    }
}

// getCurrentUser() deleted — Issue 01: was using firebase.auth() which never
// exists in MV3 service workers. Replaced with chrome.storage.local reads above.

/**
 * Categorize pattern type
 */
function categorizePattern(pattern) {
    const p = pattern.toString().toLowerCase();
    if (p.includes('phish') || p.includes('verify') || p.includes('login')) return 'phishing';
    if (p.includes('crypto') || p.includes('wallet') || p.includes('bitcoin')) return 'crypto_scam';
    if (p.includes('virus') || p.includes('infected')) return 'malware';
    if (p.includes('prize') || p.includes('winner') || p.includes('free')) return 'scam';
    if (p.includes('grabify') || p.includes('iplogger')) return 'ip_grabber';
    return 'suspicious';
}

/**
 * Simple URL hash for caching
 */
function hashUrl(url) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

/**
 * Cache scan result
 */
function cacheResult(key, result) {
    scanCache.set(key, {
        result,
        expires: Date.now() + CACHE_DURATION
    });

    // Clean old entries
    if (scanCache.size > 1000) {
        const now = Date.now();
        for (const [k, v] of scanCache.entries()) {
            if (now > v.expires) scanCache.delete(k);
        }
    }
}

/**
 * Log scan to Firestore
 * Issue 01 fix: reads token from chrome.storage.local
 */
async function logScan(result, userId, deviceId) {
    try {
        const stored = await chrome.storage.local.get([USER_TOKEN_KEY]);
        const token = stored[USER_TOKEN_KEY];
        if (!token) return; // Not logged in — skip

        await fetch(
            'https://us-central1-zas-safeguard.cloudfunctions.net/logUrlScan',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    ...result,
                    userId,
                    deviceId
                })
            }
        );
    } catch (error) {
        console.error('[URLScanner] Log failed:', error.message);
    }
}

// Export for service worker
if (typeof self !== 'undefined') {
    self.urlScanner = {
        init: initScanner,
        scan: scanUrl,
        checkPatterns,
        checkSignatures,
        log: logScan
    };
}
