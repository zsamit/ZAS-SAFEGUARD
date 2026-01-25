/**
 * YouTube Ad Interceptor - Advanced Script Injection
 * Intercepts YouTube's player config to remove ad data before it loads
 * Must run at document_start in MAIN world
 */

(function () {
    'use strict';

    // Skip if not on YouTube
    if (!window.location.hostname.includes('youtube.com')) return;

    console.log('[YouTube Interceptor] Injecting ad removal...');

    // ========================================
    // Anti-Detection: Prevent YouTube from detecting ad blocker
    // ========================================

    // Spoof ad blocker detection checks (safe approach)
    try {
        Object.defineProperty(window, 'google_ad_status', {
            get: () => 1,
            set: () => { },
            configurable: false
        });
    } catch (e) {
        // May already be defined, ignore
    }

    // NOTE: Removed global Object.defineProperty override as it breaks YouTube's internal code
    // This was causing the search bar and home button to disappear

    // Also remove the ad-blocker warning overlay via CSS
    const antiDetectStyles = document.createElement('style');
    antiDetectStyles.textContent = `
        /* Hide YouTube ad-blocker detection popups */
        ytd-enforcement-message-view-model,
        ytd-popup-container tp-yt-iron-overlay-backdrop,
        tp-yt-paper-dialog.ytd-enforcement-message-view-model,
        #error-screen[data-type="ad-blocker"],
        .yt-playability-error-supported-renderers,
        [aria-label="Ad blocker detected"] {
            display: none !important;
        }
        
        /* Ensure search bar stays visible */
        #search,
        #search-form,
        ytd-searchbox,
        #container.ytd-searchbox,
        #masthead #center,
        ytd-masthead #center,
        #guide-button,
        ytd-topbar-logo-renderer,
        #logo-icon {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
    `;
    document.documentElement.appendChild(antiDetectStyles);

    // ========================================
    // Intercept ytInitialPlayerResponse (safe approach)
    // ========================================

    // Clean ad data from player response
    function cleanPlayerResponse(data) {
        if (!data || typeof data !== 'object') return data;

        try {
            delete data.adPlacements;
            delete data.adSlots;
            delete data.playerAds;
            delete data.adBreakParams;
        } catch (e) {
            // Ignore errors
        }

        return data;
    }

    // Check and clean ytInitialPlayerResponse periodically
    const checkPlayerResponse = () => {
        if (window.ytInitialPlayerResponse) {
            cleanPlayerResponse(window.ytInitialPlayerResponse);
        }
    };

    // Run every 500ms
    setInterval(checkPlayerResponse, 500);

    // Also run on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', checkPlayerResponse);

    // ========================================
    // Intercept Fetch for player API
    // ========================================

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const url = args[0]?.url || args[0];

        // Check if this is a YouTube player API call
        if (typeof url === 'string' && url.includes('/youtubei/v1/player')) {
            try {
                const response = await originalFetch.apply(this, args);
                const clone = response.clone();
                const data = await clone.json();

                // Remove ad data
                if (data) {
                    cleanPlayerResponse(data);
                    console.log('[YouTube Interceptor] Filtered ads from player API');

                    // Return modified response
                    return new Response(JSON.stringify(data), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }

                return response;
            } catch (e) {
                return originalFetch.apply(this, args);
            }
        }

        return originalFetch.apply(this, args);
    };

    // ========================================
    // XHR Interception removed - was too aggressive
    // The fetch interception is sufficient for modern YouTube
    // ========================================

    console.log('[YouTube Interceptor] Injection complete (safe mode)');
})();
