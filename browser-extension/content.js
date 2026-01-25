/**
 * ZAS Safeguard - Content Script
 * 
 * Runs on every page to:
 * - Detect developer tools opening
 * - Scan page content for adult keywords (backup blocking)
 * - Show blocking overlay if needed
 * - Monitor for bypass attempts
 */

(function () {
    'use strict';

    // ============================================
    // SKIP ALL BLOCKING ON ZAS DASHBOARD DOMAINS
    // Don't run DevTools detection, content scanning, etc on our own sites
    // ============================================
    const hostname = window.location.hostname;
    const isZasDomain =
        hostname.includes('zassafeguard.com') ||
        hostname.includes('zas-safeguard.web.app') ||
        hostname.includes('zasgloballlc.com') ||
        hostname === 'localhost';

    if (isZasDomain) {
        // Only run the extension ID announcement on ZAS domains
        const announceId = () => {
            const extensionId = chrome.runtime.id;
            console.log('[ZAS Content] Dashboard detected, skipping blocking. Extension ID:', extensionId);
            window.postMessage({
                source: 'zas-extension',
                type: 'EXTENSION_ID_ANNOUNCEMENT',
                extensionId: extensionId
            }, '*');
            try {
                localStorage.setItem('zasExtensionId', extensionId);
            } catch (e) { }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', announceId);
        } else {
            announceId();
        }
        return; // EXIT EARLY - don't run any other content script logic
    }

    // ============================================
    // DEVELOPER TOOLS DETECTION
    // ============================================

    let devToolsOpen = false;

    // Method 1: Check debug timing
    const detectDevTools = () => {
        const start = performance.now();
        debugger; // This pauses if dev tools are open
        const end = performance.now();

        if (end - start > 100) {
            if (!devToolsOpen) {
                devToolsOpen = true;
                reportDevToolsOpen();
            }
        }
    };

    // Method 2: Console detection
    const consoleCheck = () => {
        const element = new Image();
        Object.defineProperty(element, 'id', {
            get: function () {
                if (!devToolsOpen) {
                    devToolsOpen = true;
                    reportDevToolsOpen();
                }
            }
        });
        console.log('%c', element);
    };

    // Method 3: Window size check (dev tools changes window size)
    let windowWidth = window.outerWidth;
    let windowHeight = window.outerHeight;

    const checkWindowSize = () => {
        const widthThreshold = window.outerWidth - window.innerWidth > 160;
        const heightThreshold = window.outerHeight - window.innerHeight > 160;

        if (widthThreshold || heightThreshold) {
            if (!devToolsOpen) {
                devToolsOpen = true;
                reportDevToolsOpen();
            }
        }
    };

    function reportDevToolsOpen() {
        try {
            chrome.runtime.sendMessage({
                type: 'DEV_TOOLS_OPENED',
                url: window.location.href
            }, () => {
                if (chrome.runtime.lastError) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }

        // Show warning
        showDevToolsWarning();
    }

    function showDevToolsWarning() {
        const warning = document.createElement('div');
        warning.id = 'zas-devtools-warning';
        warning.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
        color: white;
        padding: 16px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      ">
        ⚠️ <strong>ZAS Safeguard:</strong> Developer tools detected. This action has been logged and reported.
      </div>
    `;

        if (!document.getElementById('zas-devtools-warning')) {
            document.body.appendChild(warning);

            // Remove after 5 seconds
            setTimeout(() => {
                warning.remove();
            }, 5000);
        }
    }

    // Run detection periodically (be careful not to impact performance)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setInterval(checkWindowSize, 1000);
        });
    } else {
        setInterval(checkWindowSize, 1000);
    }

    // ============================================
    // CONTENT SCANNING (BACKUP BLOCKING)
    // ============================================

    const ADULT_KEYWORDS = [
        'porn', 'xxx', 'adult content', 'nsfw', 'nude', 'naked',
        'sex video', 'adult video', 'erotic', 'hentai', 'cam girl'
    ];

    function scanPageContent() {
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        const title = document.title?.toLowerCase() || '';
        const url = window.location.href.toLowerCase();

        // Check title and URL first (faster)
        for (const keyword of ADULT_KEYWORDS) {
            if (title.includes(keyword) || url.includes(keyword)) {
                showBlockingOverlay('Adult content detected');
                return true;
            }
        }

        // Check body content (limit check to first 5000 chars for performance)
        const textToCheck = bodyText.substring(0, 5000);
        let matchCount = 0;

        for (const keyword of ADULT_KEYWORDS) {
            if (textToCheck.includes(keyword)) {
                matchCount++;
                if (matchCount >= 2) {
                    showBlockingOverlay('Adult content detected');
                    return true;
                }
            }
        }

        return false;
    }

    function showBlockingOverlay(reason) {
        // Don't show on extension pages
        if (window.location.href.startsWith('chrome-extension://')) return;

        const overlay = document.createElement('div');
        overlay.id = 'zas-blocking-overlay';
        overlay.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, #1e1e2e 0%, #0f0f1a 100%);
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: white;
      ">
        <div style="
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, #4C5EFF 0%, #6366f1 100%);
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 24px;
          overflow: hidden;
        "><img src="${chrome.runtime.getURL('icons/icon128.png')}" alt="ZAS" style="width: 60px; height: 60px;"></div>
        
        <h1 style="
          font-size: 28px;
          font-weight: 700;
          margin: 0 0 16px 0;
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        ">Content Blocked</h1>
        
        <p style="
          font-size: 16px;
          color: #9ca3af;
          margin: 0 0 32px 0;
          max-width: 400px;
          text-align: center;
        ">
          ZAS Safeguard has blocked this content for your protection.
        </p>
        
        <p style="
          font-size: 14px;
          color: #6b7280;
        ">${reason}</p>
        
        <button onclick="history.back()" style="
          margin-top: 32px;
          padding: 12px 32px;
          background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
          Go Back
        </button>
      </div>
    `;

        // Remove existing overlay if any
        const existing = document.getElementById('zas-blocking-overlay');
        if (existing) existing.remove();

        // Add overlay
        document.documentElement.appendChild(overlay);

        // Prevent scrolling
        document.body.style.overflow = 'hidden';

        // Log the block
        try {
            chrome.runtime.sendMessage({
                type: 'CONTENT_BLOCKED',
                url: window.location.href,
                reason
            }, () => {
                if (chrome.runtime.lastError) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    // Scan content when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanPageContent);
    } else {
        // Use setTimeout to let page render first
        setTimeout(scanPageContent, 500);
    }

    // Re-scan on dynamic content changes (for SPAs)
    const observer = new MutationObserver((mutations) => {
        // Debounce scanning
        clearTimeout(window.zasScanTimeout);
        window.zasScanTimeout = setTimeout(scanPageContent, 1000);
    });

    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // ============================================
    // COSMETIC FILTERING (AD BLOCKER)
    // Hides ad elements via CSS injection
    // ============================================

    // Generic ad selectors (site-agnostic) - EXPANDED
    const COSMETIC_SELECTORS = [
        // Ad containers
        '[class*="ad-container"]',
        '[class*="ad-wrapper"]',
        '[class*="ad-slot"]',
        '[class*="ad-unit"]',
        '[class*="ad-box"]',
        '[class*="ad_container"]',
        '[class*="ad_wrapper"]',
        '[class*="ad_slot"]',
        '[class*="adContainer"]',
        '[class*="adWrapper"]',
        '[class*="adSlot"]',
        '[id*="ad-container"]',
        '[id*="ad-wrapper"]',
        '[id*="ad_container"]',
        '[id*="ad_wrapper"]',
        '[id*="google_ads"]',
        '[id*="googleAds"]',
        '[class*="google-ad"]',
        '[class*="GoogleAd"]',
        // Common ad IDs
        '#ad', '#ads', '#advertising', '#advertisement',
        '#sidebar-ad', '#header-ad', '#footer-ad',
        '#top-ad', '#bottom-ad', '#right-ad', '#left-ad',
        // Sponsored content
        '[class*="sponsored"]',
        '[class*="Sponsored"]',
        '[class*="promoted"]',
        '[class*="Promoted"]',
        '[data-ad]',
        '[data-ad-slot]',
        '[data-ad-unit]',
        '[data-google-query-id]',
        '[data-dfp]',
        '[data-advertisement]',
        // Common ad classes
        '.adsbygoogle',
        '.ad-banner',
        '.ad-placeholder',
        '.ad-leaderboard',
        '.ad-rectangle',
        '.ad-skyscraper',
        '.ad-native',
        '.advertisement',
        '.advertisment',
        '.advert',
        '.ads',
        '.adsbox',
        '.adbanner',
        '.adblock',
        // Specific ad network classes
        '.GoogleActiveViewElement',
        '.pubads',
        '.dfp-ad',
        '.taboola',
        '.outbrain',
        '.mgid',
        '.content-ad',
        '.native-ad',
        '.inline-ad',
        // iframes commonly used for ads
        'iframe[src*="doubleclick"]',
        'iframe[src*="googlesyndication"]',
        'iframe[src*="googleadservices"]',
        'iframe[src*="facebook.com/plugins"]',
        'iframe[id*="ad"]',
        'iframe[class*="ad"]',
        // Overlays and popups (annoyances)
        '[class*="cookie-banner"]',
        '[class*="cookie-notice"]',
        '[class*="cookie-consent"]',
        '[class*="cookie-popup"]',
        '[class*="cookieBanner"]',
        '[class*="gdpr-banner"]',
        '[class*="gdpr-notice"]',
        '[class*="newsletter-popup"]',
        '[class*="newsletter-modal"]',
        '[class*="subscribe-popup"]',
        '[class*="paywall"]',
        '[class*="Paywall"]',
        // Tracking pixels
        'img[src*="pixel"]',
        'img[width="1"][height="1"]',
        'img[src*="tracking"]'
    ];

    // Site-specific selectors
    const SITE_COSMETIC_SELECTORS = {
        'youtube.com': [
            'ytd-ad-slot-renderer',
            'ytd-banner-promo-renderer',
            'ytd-video-masthead-ad-v3-renderer',
            '#player-ads',
            '.ytp-ad-module',
            '.video-ads'
        ],
        'facebook.com': [
            '[data-pagelet*="FeedUnit"]:has([aria-label*="Sponsored"])'
        ],
        'reddit.com': [
            '.promotedlink',
            'shreddit-ad-post',
            '[data-testid="ad-container"]'
        ],
        'forbes.com': [
            '.fbs-ad',
            '.ad-unit'
        ]
    };

    // Cosmetic filtering state
    let cosmeticStyleElement = null;
    let cosmeticEnabled = true;
    let cosmeticObserver = null;
    let cosmeticLastActivity = Date.now();
    let cosmeticInactivityTimer = null;
    const COSMETIC_DEBOUNCE_MS = 300;
    const COSMETIC_INACTIVITY_MS = 30000; // 30 seconds

    /**
     * Get hostname without www
     */
    function getCosmeticHostname() {
        try {
            return window.location.hostname.replace(/^www\./, '');
        } catch (e) {
            return '';
        }
    }

    /**
     * Get selectors for current site
     */
    function getCosmeticSelectors() {
        const hostname = getCosmeticHostname();

        // Sites that should NOT use generic selectors (they have specific handling)
        const excludeGenericSites = ['youtube.com', 'youtu.be'];
        const useGeneric = !excludeGenericSites.some(site => hostname.includes(site));

        let selectors = useGeneric ? [...COSMETIC_SELECTORS] : [];

        // Add site-specific selectors
        for (const [site, siteSelectors] of Object.entries(SITE_COSMETIC_SELECTORS)) {
            if (hostname.includes(site)) {
                selectors = selectors.concat(siteSelectors);
            }
        }

        return [...new Set(selectors)];
    }

    /**
     * Generate CSS to hide ad elements
     */
    function generateCosmeticCSS(selectors) {
        if (!selectors.length) return '';

        return `
/* ZAS Safeguard Ad Blocker - Cosmetic Filtering */
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
    async function injectCosmeticCSS() {
        if (!cosmeticEnabled) return;

        try {
            // Check if cosmetic filtering is enabled in settings
            const result = await chrome.storage.local.get(['adblock_engine_config']);
            const config = result.adblock_engine_config;
            if (config && config.cosmeticEnabled === false) {
                cosmeticEnabled = false;
                return;
            }

            const selectors = getCosmeticSelectors();
            const css = generateCosmeticCSS(selectors);

            if (!css) return;

            // Remove existing style element
            if (cosmeticStyleElement && cosmeticStyleElement.parentNode) {
                cosmeticStyleElement.parentNode.removeChild(cosmeticStyleElement);
            }

            // Create and inject new style element
            cosmeticStyleElement = document.createElement('style');
            cosmeticStyleElement.id = 'zas-adblock-cosmetic';
            cosmeticStyleElement.type = 'text/css';
            cosmeticStyleElement.textContent = css;

            // Inject at document start if possible
            const target = document.head || document.documentElement;
            if (target) {
                target.appendChild(cosmeticStyleElement);

                // Count how many elements would be hidden by our selectors
                let hiddenCount = 0;
                try {
                    for (const selector of selectors) {
                        try {
                            const elements = document.querySelectorAll(selector);
                            hiddenCount += elements.length;
                        } catch (e) {
                            // Invalid selector, skip
                        }
                    }
                } catch (e) {
                    // Counting failed, that's okay
                }

                console.log('[ZAS AdBlock] Cosmetic: Injected', selectors.length, 'selectors, hiding', hiddenCount, 'elements');

                // Report to background if we blocked anything
                if (hiddenCount > 0) {
                    try {
                        chrome.runtime.sendMessage({
                            type: 'ADBLOCK_COSMETIC_STATS',
                            count: hiddenCount,
                            domain: getCosmeticHostname()
                        }, () => {
                            if (chrome.runtime.lastError) { /* ignore */ }
                        });
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (error) {
            console.log('[ZAS AdBlock] Cosmetic error:', error.message);
        }
    }

    /**
     * Debounce helper
     */
    function cosmeticDebounce(func, wait) {
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
     * Record cosmetic activity
     */
    function recordCosmeticActivity() {
        cosmeticLastActivity = Date.now();
    }

    /**
     * Check for inactivity and stop observer
     */
    function checkCosmeticInactivity() {
        const elapsed = Date.now() - cosmeticLastActivity;
        if (elapsed > COSMETIC_INACTIVITY_MS) {
            stopCosmeticObserver();
            console.log('[ZAS AdBlock] Cosmetic: Stopped due to inactivity');
        }
    }

    /**
     * Start cosmetic MutationObserver
     */
    function startCosmeticObserver() {
        if (cosmeticObserver) return;

        const debouncedInject = cosmeticDebounce(injectCosmeticCSS, COSMETIC_DEBOUNCE_MS);

        cosmeticObserver = new MutationObserver((mutations) => {
            recordCosmeticActivity();

            // Check if any mutations added new elements
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

        cosmeticObserver.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });

        // Set up inactivity check
        cosmeticInactivityTimer = setInterval(checkCosmeticInactivity, 5000);

        console.log('[ZAS AdBlock] Cosmetic observer started');
    }

    /**
     * Stop cosmetic MutationObserver
     */
    function stopCosmeticObserver() {
        if (cosmeticObserver) {
            cosmeticObserver.disconnect();
            cosmeticObserver = null;
        }
        if (cosmeticInactivityTimer) {
            clearInterval(cosmeticInactivityTimer);
            cosmeticInactivityTimer = null;
        }
    }

    /**
     * Initialize cosmetic filtering
     */
    async function initCosmeticFiltering() {
        // Skip on extension pages
        if (window.location.href.startsWith('chrome-extension://')) return;
        if (window.location.href.startsWith('chrome://')) return;

        // Inject CSS immediately
        await injectCosmeticCSS();

        // Start observer when DOM is ready
        if (document.body) {
            startCosmeticObserver();
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                startCosmeticObserver();
            });
        }

        // Re-inject on scroll (new content may load)
        document.addEventListener('scroll', cosmeticDebounce(() => {
            recordCosmeticActivity();
            if (!cosmeticObserver) {
                startCosmeticObserver();
            }
        }, 500), { passive: true });
    }

    // Initialize cosmetic filtering
    initCosmeticFiltering();

    // ============================================
    // EXTENSION CHECK
    // ============================================

    // Periodically verify extension is still running
    setInterval(() => {
        try {
            chrome.runtime.sendMessage({ type: 'PING' }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('ZAS Safeguard: Extension communication lost');
                }
            });
        } catch (e) { /* ignore */ }
    }, 30000);

    // ============================================
    // AI CONTENT ANALYSIS (Pro Feature)
    // ============================================

    async function analyzePageForAdultContent() {
        try {
            // Check if user has Pro plan
            const storage = await chrome.storage.local.get(['planType', 'aiAnalysisEnabled']);

            const planType = storage.planType || '';
            if (!['pro_monthly', 'pro_yearly', 'pro', 'lifetime'].includes(planType.toLowerCase())) {
                return; // Not a Pro user
            }

            // Check if AI analysis is enabled
            if (storage.aiAnalysisEnabled === false) {
                return; // AI analysis disabled in settings
            }

            // Don't analyze extension pages or already analyzed pages
            if (window.location.href.startsWith('chrome-extension://')) return;
            if (window.location.href.startsWith('chrome://')) return;

            // Check if already analyzed (use sessionStorage for caching)
            const cacheKey = `zas_analyzed_${btoa(window.location.href).substring(0, 20)}`;
            if (sessionStorage.getItem(cacheKey)) return;

            // Collect page data
            const pageData = {
                title: document.title || '',
                text: document.body?.innerText?.substring(0, 3000) || '',
                url: window.location.href
            };

            // Skip if page has too little content
            if (pageData.text.length < 100) return;

            // Send to background script for analysis (use callback style)
            chrome.runtime.sendMessage({
                type: 'ANALYZE_CONTENT_FOR_ADULT',
                data: pageData
            }, (result) => {
                if (chrome.runtime.lastError) {
                    console.log('[ZAS] AI analysis error:', chrome.runtime.lastError.message);
                    return;
                }

                // Mark as analyzed
                sessionStorage.setItem(cacheKey, 'analyzed');

                // Block if adult content detected
                if (result?.blocked) {
                    showBlockingOverlay(result.reason || 'AI detected adult content');

                    // Log the AI block
                    try {
                        chrome.runtime.sendMessage({
                            type: 'AI_CONTENT_BLOCKED',
                            url: pageData.url,
                            classification: result.classification,
                            confidence: result.confidence
                        }, () => {
                            if (chrome.runtime.lastError) { /* ignore */ }
                        });
                    } catch (e) { /* ignore */ }
                }
            });

        } catch (error) {
            console.log('[ZAS] AI content analysis skipped:', error.message);
        }
    }

    // Run AI analysis after page loads (with delay for page to render)
    if (document.readyState === 'complete') {
        setTimeout(analyzePageForAdultContent, 2000);
    } else {
        window.addEventListener('load', () => {
            setTimeout(analyzePageForAdultContent, 2000);
        });
    }

    // ============================================
    // DASHBOARD MESSAGE RELAY
    // Listen for messages from ZAS Dashboard and relay to background
    // ============================================

    window.addEventListener('message', (event) => {
        // Only accept messages from same origin and with zas-dashboard source
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'zas-dashboard') return;

        console.log('[ZAS Content] Received dashboard message:', event.data.type);

        // Relay to background script (use callback style, not Promise)
        const { source, ...message } = event.data;
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    console.log('[ZAS Content] Background error:', chrome.runtime.lastError.message);
                } else {
                    console.log('[ZAS Content] Background response:', response);
                }
            });
        } catch (error) {
            console.log('[ZAS Content] sendMessage failed:', error);
        }
    });

    // ============================================
    // AUTO-ANNOUNCE EXTENSION ID TO DASHBOARD
    // When on ZAS domains, send extension ID so dashboard can communicate
    // ============================================

    function announceExtensionIdToDashboard() {
        const hostname = window.location.hostname;
        const isZasDomain =
            hostname.includes('zas-safeguard.web.app') ||
            hostname.includes('zassafeguard.com') ||
            hostname.includes('zasgloballlc.com') ||
            hostname === 'localhost';

        if (isZasDomain) {
            // Get extension ID and send to page
            const extensionId = chrome.runtime.id;
            console.log('[ZAS Content] Announcing extension ID to dashboard:', extensionId);

            // Post message to page - dashboard will listen for this
            window.postMessage({
                source: 'zas-extension',
                type: 'EXTENSION_ID_ANNOUNCEMENT',
                extensionId: extensionId
            }, '*');

            // Also store in localStorage for persistence
            try {
                localStorage.setItem('zasExtensionId', extensionId);
            } catch (e) {
                // localStorage might be blocked
            }
        }
    }

    // Announce on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', announceExtensionIdToDashboard);
    } else {
        announceExtensionIdToDashboard();
    }

    // ============================================
    // GRACEFUL OFFLINE DETECTION
    // Prevents false tamper alerts when user closes browser normally
    // ============================================

    // Track visibility changes
    document.addEventListener('visibilitychange', () => {
        try {
            chrome.runtime.sendMessage({
                type: 'VISIBILITY_CHANGE',
                hidden: document.hidden,
                url: window.location.href
            }, () => {
                if (chrome.runtime.lastError) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
    });

    // Track page hide (tab close, navigation away)
    window.addEventListener('pagehide', (event) => {
        try {
            chrome.runtime.sendMessage({
                type: 'PAGE_UNLOAD',
                hint: event.persisted ? 'pagehide_persisted' : 'pagehide',
                url: window.location.href
            }, () => {
                if (chrome.runtime.lastError) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
    });

    // Track before unload (page refresh, close)
    window.addEventListener('beforeunload', () => {
        try {
            chrome.runtime.sendMessage({
                type: 'PAGE_UNLOAD',
                hint: 'beforeunload',
                url: window.location.href
            }, () => {
                if (chrome.runtime.lastError) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
    });

})();
