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

    // Spoof ad blocker detection checks
    Object.defineProperty(window, 'google_ad_status', {
        get: () => 1,
        set: () => { },
        configurable: false
    });

    // Note: Trusted Types policy prevents injecting fake scripts

    // Hook into YouTube's ad blocker detection
    const originalDefineProperty = Object.defineProperty;
    Object.defineProperty = function (obj, prop, descriptor) {
        // Intercept detection of blocked ads
        if (prop === 'adBlockerDetected' || prop === 'adBlockDetected') {
            console.log('[YouTube Interceptor] Blocked ad-blocker detection');
            return obj;
        }
        return originalDefineProperty.apply(this, arguments);
    };

    // Spoof ytInitialData to remove ad blocker warnings
    const checkAndFixYtData = () => {
        if (window.ytInitialData) {
            try {
                // Remove ad blocker warning overlays
                if (window.ytInitialData.overlay?.enforcementMessageViewModel) {
                    delete window.ytInitialData.overlay.enforcementMessageViewModel;
                }
                // Remove any ad-blocker-related popup data
                if (window.ytInitialData.topbar?.notificationTopbarButtonRenderer?.icon?.iconType === 'ENFORCEMENT') {
                    delete window.ytInitialData.topbar.notificationTopbarButtonRenderer;
                }
            } catch (e) { }
        }
    };

    // Check periodically and on mutations
    setInterval(checkAndFixYtData, 1000);

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
        #container.ytd-searchbox {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
    `;
    document.documentElement.appendChild(antiDetectStyles);

    // ========================================
    // Intercept ytInitialPlayerResponse
    // ========================================

    // Store original property descriptor
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');

    // Override ytInitialPlayerResponse to remove ads
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get() {
            return this._ytInitialPlayerResponse;
        },
        set(value) {
            if (value && typeof value === 'object') {
                // Remove ad-related properties
                try {
                    delete value.adPlacements;
                    delete value.adSlots;
                    delete value.playerAds;
                    delete value.adBreakParams;

                    if (value.playbackTracking) {
                        delete value.playbackTracking.videostatsPlaybackUrl;
                        delete value.playbackTracking.videostatsWatchtimeUrl;
                    }

                    console.log('[YouTube Interceptor] Removed ad placements from initial response');
                } catch (e) {
                    // Ignore errors
                }
            }
            this._ytInitialPlayerResponse = value;
        }
    });

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
                    delete data.adPlacements;
                    delete data.adSlots;
                    delete data.playerAds;
                    delete data.adBreakParams;

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
    // Intercept XHR for legacy support
    // ========================================

    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._zasUrl = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        if (this._zasUrl && this._zasUrl.includes('/youtubei/v1/player')) {
            const originalOnReadyStateChange = this.onreadystatechange;

            this.onreadystatechange = function () {
                if (this.readyState === 4 && this.status === 200) {
                    try {
                        const data = JSON.parse(this.responseText);
                        delete data.adPlacements;
                        delete data.adSlots;
                        delete data.playerAds;

                        // Override response
                        Object.defineProperty(this, 'responseText', {
                            value: JSON.stringify(data),
                            writable: false
                        });

                        console.log('[YouTube Interceptor] Filtered ads from XHR');
                    } catch (e) {
                        // Ignore parsing errors
                    }
                }

                if (originalOnReadyStateChange) {
                    originalOnReadyStateChange.apply(this, arguments);
                }
            };
        }

        return originalXHRSend.apply(this, args);
    };

    console.log('[YouTube Interceptor] Injection complete');
})();
