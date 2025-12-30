/**
 * ZAS Safeguard - Cosmetic Filtering Module
 * 
 * CSS-based element hiding:
 * - Domain-specific CSS selectors
 * - Hides banners, sponsored cards, overlays, popups
 * - Debounced MutationObserver
 * - Auto-stops after inactivity
 */

// Cosmetic filter storage key
const COSMETIC_FILTERS_KEY = 'adblock_cosmetic_filters';
const COSMETIC_ENABLED_KEY = 'adblock_cosmetic_enabled';

// Default cosmetic selectors (site-agnostic)
const GENERIC_SELECTORS = [
    // Ad containers
    '[class*="ad-container"]',
    '[class*="ad-wrapper"]',
    '[class*="ad-slot"]',
    '[class*="ad-unit"]',
    '[id*="ad-container"]',
    '[id*="ad-wrapper"]',
    '[id*="google_ads"]',
    '[id*="googleAds"]',
    '[class*="google-ad"]',

    // Sponsored content
    '[class*="sponsored"]',
    '[class*="Sponsored"]',
    '[data-ad]',
    '[data-ad-slot]',
    '[data-google-query-id]',

    // Common ad classes
    '.adsbygoogle',
    '.ad-banner',
    '.advertisement',
    '.advertisment',
    '.advert',

    // Overlays and popups
    '[class*="cookie-banner"]',
    '[class*="cookie-notice"]',
    '[class*="cookie-consent"]',
    '[class*="gdpr-banner"]',
    '[class*="newsletter-popup"]',
    '[class*="newsletter-modal"]',
    '[class*="subscribe-popup"]',

    // Social share buttons (optional)
    // '[class*="share-buttons"]',
    // '[class*="social-share"]',
];

// Site-specific selectors
const SITE_SELECTORS = {
    'youtube.com': [
        'ytd-ad-slot-renderer',
        'ytd-banner-promo-renderer',
        'ytd-video-masthead-ad-v3-renderer',
        'ytd-rich-item-renderer:has(.ytd-ad-slot-renderer)',
        '#player-ads',
        '.ytp-ad-module',
        '.video-ads'
    ],
    'facebook.com': [
        '[data-pagelet*="FeedUnit"]:has([aria-label*="Sponsored"])',
        'div[data-testid="fbfeed_story"]:has(a[href*="ads"])',
        'span:has-text("Sponsored")'
    ],
    'twitter.com': [
        'article:has(span:contains("Promoted"))',
        '[data-testid="placementTracking"]'
    ],
    'x.com': [
        'article:has(span:contains("Promoted"))',
        '[data-testid="placementTracking"]'
    ],
    'instagram.com': [
        'article:has(span:contains("Sponsored"))',
        'div:has(> span:contains("Sponsored"))'
    ],
    'reddit.com': [
        '.promotedlink',
        'shreddit-ad-post',
        '[data-testid="ad-container"]'
    ],
    'linkedin.com': [
        '.feed-shared-update-v2:has(.update-components-actor__description:contains("Promoted"))',
        '.ad-banner-container'
    ],
    'forbes.com': [
        '.article-body-container div[id^="m-"]',
        '.fbs-ad',
        '.ad-unit'
    ],
    'nytimes.com': [
        '.ad',
        '.Ad',
        '[data-testid*="ad"]'
    ]
};

// State
let styleElement = null;
let observer = null;
let lastActivityTime = Date.now();
let inactivityTimeout = null;
let cosmeticEnabled = true;

// Config
const CONFIG = {
    DEBOUNCE_MS: 300,          // Debounce time for MutationObserver
    INACTIVITY_TIMEOUT_MS: 30000, // Stop after 30s inactivity
    CHECK_INTERVAL_MS: 5000    // Check for new elements every 5s
};

/**
 * Get current hostname
 */
function getHostname() {
    try {
        return window.location.hostname.replace(/^www\./, '');
    } catch (e) {
        return '';
    }
}

/**
 * Get selectors for current site
 */
async function getSelectorsForSite() {
    const hostname = getHostname();
    let selectors = [...GENERIC_SELECTORS];

    // Add site-specific selectors
    for (const [site, siteSelectors] of Object.entries(SITE_SELECTORS)) {
        if (hostname.includes(site)) {
            selectors = selectors.concat(siteSelectors);
        }
    }

    // Load custom selectors from storage
    try {
        const result = await chrome.storage.local.get([COSMETIC_FILTERS_KEY]);
        const custom = result[COSMETIC_FILTERS_KEY] || {};

        if (custom[hostname]) {
            selectors = selectors.concat(custom[hostname]);
        }
        if (custom['*']) {
            selectors = selectors.concat(custom['*']);
        }
    } catch (e) {
        // Storage might not be available in all contexts
    }

    // Remove duplicates
    return [...new Set(selectors)];
}

/**
 * Generate CSS to hide elements
 */
function generateHideCSS(selectors) {
    if (!selectors.length) return '';

    return `
/* ZAS Safeguard Cosmetic Filtering */
${selectors.join(',\n')} {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    width: 0 !important;
    opacity: 0 !important;
    pointer-events: none !important;
    position: absolute !important;
    z-index: -9999 !important;
}
`;
}

/**
 * Inject cosmetic filter CSS
 */
async function injectCSS() {
    if (!cosmeticEnabled) return;

    try {
        const selectors = await getSelectorsForSite();
        const css = generateHideCSS(selectors);

        if (!css) return;

        // Remove existing style element
        if (styleElement && styleElement.parentNode) {
            styleElement.parentNode.removeChild(styleElement);
        }

        // Create and inject new style element
        styleElement = document.createElement('style');
        styleElement.id = 'zas-adblock-cosmetic';
        styleElement.type = 'text/css';
        styleElement.textContent = css;

        // Inject at document start if possible
        const target = document.head || document.documentElement;
        if (target) {
            target.appendChild(styleElement);
            console.log('[AdBlock Cosmetic] Injected', selectors.length, 'selectors');
        }
    } catch (error) {
        console.error('[AdBlock Cosmetic] Error injecting CSS:', error);
    }
}

/**
 * Remove injected CSS
 */
function removeCSS() {
    if (styleElement && styleElement.parentNode) {
        styleElement.parentNode.removeChild(styleElement);
        styleElement = null;
    }
}

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Record activity (resets inactivity timer)
 */
function recordActivity() {
    lastActivityTime = Date.now();
}

/**
 * Check for inactivity and stop observer if needed
 */
function checkInactivity() {
    const elapsed = Date.now() - lastActivityTime;
    if (elapsed > CONFIG.INACTIVITY_TIMEOUT_MS) {
        stopObserver();
        console.log('[AdBlock Cosmetic] Stopped due to inactivity');
    }
}

/**
 * Start MutationObserver for dynamic content
 */
function startObserver() {
    if (observer) return;

    const debouncedInject = debounce(injectCSS, CONFIG.DEBOUNCE_MS);

    observer = new MutationObserver((mutations) => {
        recordActivity();

        // Check if any mutations added new ad-like elements
        let shouldReinject = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldReinject = true;
                break;
            }
        }

        if (shouldReinject) {
            debouncedInject();
        }
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });

    // Set up inactivity check
    inactivityTimeout = setInterval(checkInactivity, CONFIG.CHECK_INTERVAL_MS);

    console.log('[AdBlock Cosmetic] Observer started');
}

/**
 * Stop MutationObserver
 */
function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (inactivityTimeout) {
        clearInterval(inactivityTimeout);
        inactivityTimeout = null;
    }
}

/**
 * Initialize cosmetic filtering
 */
async function init() {
    // Check if enabled
    try {
        const result = await chrome.storage.local.get([COSMETIC_ENABLED_KEY]);
        cosmeticEnabled = result[COSMETIC_ENABLED_KEY] !== false;
    } catch (e) {
        cosmeticEnabled = true;
    }

    if (!cosmeticEnabled) {
        console.log('[AdBlock Cosmetic] Disabled');
        return;
    }

    // Inject CSS immediately
    await injectCSS();

    // Start observer when DOM is ready
    if (document.body) {
        startObserver();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            startObserver();
        });
    }

    // Re-inject on user interaction (they may have scrolled to new content)
    document.addEventListener('scroll', debounce(() => {
        recordActivity();
        if (!observer) {
            startObserver();
        }
    }, 500), { passive: true });
}

/**
 * Enable cosmetic filtering
 */
async function enable() {
    cosmeticEnabled = true;
    await chrome.storage.local.set({ [COSMETIC_ENABLED_KEY]: true });
    await injectCSS();
    startObserver();
}

/**
 * Disable cosmetic filtering
 */
async function disable() {
    cosmeticEnabled = false;
    await chrome.storage.local.set({ [COSMETIC_ENABLED_KEY]: false });
    removeCSS();
    stopObserver();
}

/**
 * Add custom selector for current site
 */
async function addCustomSelector(selector) {
    const hostname = getHostname();

    try {
        const result = await chrome.storage.local.get([COSMETIC_FILTERS_KEY]);
        const custom = result[COSMETIC_FILTERS_KEY] || {};

        if (!custom[hostname]) {
            custom[hostname] = [];
        }

        if (!custom[hostname].includes(selector)) {
            custom[hostname].push(selector);
            await chrome.storage.local.set({ [COSMETIC_FILTERS_KEY]: custom });
            await injectCSS(); // Re-inject with new selector
        }
    } catch (error) {
        console.error('[AdBlock Cosmetic] Error adding selector:', error);
    }
}

/**
 * Check if cosmetic filtering is enabled
 */
function isEnabled() {
    return cosmeticEnabled;
}

// Auto-initialize when script loads
if (typeof document !== 'undefined') {
    init();
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AdBlockCosmetic = {
        init,
        enable,
        disable,
        isEnabled,
        addCustomSelector,
        injectCSS,
        removeCSS,
        getSelectorsForSite,
        GENERIC_SELECTORS,
        SITE_SELECTORS
    };
}

export {
    init,
    enable,
    disable,
    isEnabled,
    addCustomSelector,
    injectCSS,
    removeCSS,
    getSelectorsForSite,
    GENERIC_SELECTORS,
    SITE_SELECTORS
};
