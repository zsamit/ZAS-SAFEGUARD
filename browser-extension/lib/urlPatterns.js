/**
 * ZAS Safeguard - URL Malicious Patterns (Layer A)
 * Hardcoded patterns for instant detection of known scam/phishing URLs
 */

// Suspicious URL patterns - instant block
const MALICIOUS_PATTERNS = [
    // Phishing patterns
    /phish/i,
    /ph1sh/i,
    /phising/i,
    /verify-account/i,
    /confirm-identity/i,
    /account-suspended/i,
    /account-verify/i,
    /secure-login/i,
    /login-verify/i,
    /update-billing/i,
    /payment-failed/i,
    /reset-password-now/i,
    /password-expire/i,

    // Crypto scams
    /free-crypto/i,
    /crypto-giveaway/i,
    /wallet-drainer/i,
    /claim-airdrop/i,
    /connect-wallet/i,
    /binance-verify/i,
    /coinbase-verify/i,
    /metamask-verify/i,
    /ethereum-claim/i,
    /bitcoin-double/i,
    /nft-mint-free/i,

    // Gaming scams
    /steam-gift/i,
    /free-robux/i,
    /free-vbucks/i,
    /roblox-free/i,
    /fortnite-free/i,
    /minecraft-free/i,
    /csgo-skins-free/i,

    // Fake giveaways
    /iphone-winner/i,
    /prize-claim/i,
    /lottery-winner/i,
    /you-have-won/i,
    /claim-prize/i,
    /gift-card-free/i,

    // Malware patterns
    /download-now-free/i,
    /install-update/i,
    /flash-player/i,
    /java-update/i,
    /virus-detected/i,
    /your-pc-infected/i,
    /clean-computer/i,

    // IP grabbers
    /grabify/i,
    /iplogger/i,
    /blasze/i,
    /ps3cfw/i,

    // Fake login pages
    /facebook-login\./i,
    /google-login\./i,
    /instagram-login\./i,
    /twitter-login\./i,
    /paypal-login\./i,
    /netflix-login\./i,
    /amazon-login\./i,

    // Suspicious TLDs with keywords
    /\.(tk|ml|ga|cf|gq)\/.*login/i,
    /\.(tk|ml|ga|cf|gq)\/.*account/i,
    /\.(tk|ml|ga|cf|gq)\/.*verify/i,

    // URL shortener abuse patterns
    /bit\.ly\/[a-z0-9]{5,}.*password/i,
    /tinyurl\.com\/.*login/i,

    // Known scam domains patterns
    /paypa[l1].*\.(com|net|org)/i,
    /amaz[o0]n.*\.(com|net|org)/i,
    /g[o0]{2}gle.*\.(com|net|org)/i,
    /micr[o0]s[o0]ft.*\.(com|net|org)/i,
    /faceb[o0]{2}k.*\.(com|net|org)/i,
    /instag[r4]am.*\.(com|net|org)/i,
    /netfl[i1]x.*\.(com|net|org)/i
];

// Suspicious query parameters
const SUSPICIOUS_PARAMS = [
    'password',
    'passwd',
    'ssn',
    'credit_card',
    'creditcard',
    'cardnumber',
    'cvv',
    'social_security',
    'bank_account',
    'routing_number',
    'wallet_key',
    'private_key',
    'seed_phrase'
];

// Known malicious URL shorteners
const MALICIOUS_SHORTENERS = [
    'adf.ly',
    'bc.vc',
    'sh.st',
    'ouo.io',
    'za.gl',
    'adfoc.us',
    'ay.gy',
    'linkshrink.net'
];

// Trusted domains (whitelist)
const TRUSTED_DOMAINS = [
    'google.com',
    'youtube.com',
    'facebook.com',
    'instagram.com',
    'twitter.com',
    'x.com',
    'microsoft.com',
    'apple.com',
    'amazon.com',
    'netflix.com',
    'github.com',
    'stackoverflow.com',
    'wikipedia.org',
    'reddit.com',
    'linkedin.com',
    'paypal.com',
    'stripe.com',
    'firebase.google.com',
    'zasgloballlc.com'
];

/**
 * Check URL against malicious patterns
 * @param {string} url - URL to check
 * @returns {object} - { blocked: boolean, reason: string, pattern: string }
 */
function checkPatterns(url) {
    const urlLower = url.toLowerCase();

    // Check trusted domains first
    for (const domain of TRUSTED_DOMAINS) {
        if (urlLower.includes(domain)) {
            return { blocked: false, reason: 'trusted_domain' };
        }
    }

    // Check malicious patterns
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

    // Check suspicious parameters
    try {
        const urlObj = new URL(url);
        for (const param of SUSPICIOUS_PARAMS) {
            if (urlObj.searchParams.has(param)) {
                return {
                    blocked: true,
                    reason: 'suspicious_parameter',
                    pattern: param,
                    category: 'data_harvesting'
                };
            }
        }
    } catch (e) {
        // Invalid URL
    }

    // Check malicious shorteners
    for (const shortener of MALICIOUS_SHORTENERS) {
        if (urlLower.includes(shortener)) {
            return {
                blocked: true,
                reason: 'malicious_shortener',
                pattern: shortener,
                category: 'malicious_redirect'
            };
        }
    }

    return { blocked: false };
}

/**
 * Categorize pattern type
 */
function categorizePattern(pattern) {
    const patternStr = pattern.toString().toLowerCase();

    if (patternStr.includes('phish') || patternStr.includes('login') || patternStr.includes('verify')) {
        return 'phishing';
    }
    if (patternStr.includes('crypto') || patternStr.includes('wallet') || patternStr.includes('bitcoin')) {
        return 'crypto_scam';
    }
    if (patternStr.includes('virus') || patternStr.includes('infected') || patternStr.includes('download')) {
        return 'malware';
    }
    if (patternStr.includes('prize') || patternStr.includes('winner') || patternStr.includes('free')) {
        return 'scam';
    }
    if (patternStr.includes('grabify') || patternStr.includes('iplogger')) {
        return 'ip_grabber';
    }
    return 'suspicious';
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkPatterns, TRUSTED_DOMAINS, MALICIOUS_PATTERNS };
}
