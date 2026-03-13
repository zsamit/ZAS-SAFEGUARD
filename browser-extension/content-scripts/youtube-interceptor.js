/**
 * YouTube Ad Interceptor - Phase 1: MAIN World JSON Scrubbing
 * 
 * Intercepts YouTube's player config to remove ad data before it loads.
 * Must run at document_start in MAIN world.
 *
 * Phase 1 strategy: Monkeypatch both window.fetch AND XMLHttpRequest.prototype.open.
 * Intercept all requests targeting /youtubei/v1/player.
 * Parse the JSON, scrub ad arrays (adPlacements, playerAds, adSlots, adBreakParams),
 * and replace them with empty arrays before passing the response to YouTube's frontend.
 * Result: The ad lifecycle never begins — no missing telemetry flags are raised.
 */

(function () {
    'use strict';

    // Skip if not on YouTube
    if (!window.location.hostname.includes('youtube.com')) return;

    console.log('[YouTube Interceptor] Injecting Phase 1 (MAIN world)...');

    // ========================================
    // Anti-Detection: Prevent YouTube from detecting ad blocker
    // ========================================

    try {
        Object.defineProperty(window, 'google_ad_status', {
            get: () => 1,
            set: () => { },
            configurable: false
        });
    } catch (e) {
        // May already be defined, ignore
    }

    // ========================================
    // Shared: scrubAdPayload — one function for fetch + XHR
    // ========================================

    function scrubAdPayload(data) {
        if (!data || typeof data !== 'object') return data;

        // Replace ad arrays with empty arrays (not delete) to prevent
        // YouTube from detecting missing keys in schema validation
        const adKeys = ['adPlacements', 'adSlots', 'playerAds', 'adBreakParams'];
        for (const key of adKeys) {
            if (key in data) {
                data[key] = [];
            }
        }

        return data;
    }

    // ========================================
    // Intercept ytInitialPlayerResponse (inline data)
    // ========================================

    const checkPlayerResponse = () => {
        if (window.ytInitialPlayerResponse) {
            scrubAdPayload(window.ytInitialPlayerResponse);
        }
    };

    setInterval(checkPlayerResponse, 500);
    document.addEventListener('DOMContentLoaded', checkPlayerResponse);

    // ========================================
    // Phase 1A: Intercept Fetch for player API
    // ========================================

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const url = args[0]?.url || args[0];

        if (typeof url === 'string' && url.includes('/youtubei/v1/player')) {
            try {
                const response = await originalFetch.apply(this, args);
                const clone = response.clone();
                const data = await clone.json();

                if (data) {
                    scrubAdPayload(data);
                    console.log('[YouTube Interceptor] Fetch: scrubbed ads from player API');

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
    // Phase 1B: Intercept XHR for player API
    // Targeted to /youtubei/v1/player only — not aggressive
    // ========================================

    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
        const xhr = new OriginalXHR();
        const originalOpen = xhr.open.bind(xhr);
        let isPlayerRequest = false;

        xhr.open = function (method, url, ...rest) {
            if (typeof url === 'string' && url.includes('/youtubei/v1/player')) {
                isPlayerRequest = true;
            }
            return originalOpen(method, url, ...rest);
        };

        const originalSend = xhr.send.bind(xhr);
        xhr.send = function (...args) {
            if (isPlayerRequest) {
                xhr.addEventListener('load', function () {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data) {
                            scrubAdPayload(data);
                            Object.defineProperty(xhr, 'responseText', {
                                get: () => JSON.stringify(data),
                                configurable: true
                            });
                            Object.defineProperty(xhr, 'response', {
                                get: () => JSON.stringify(data),
                                configurable: true
                            });
                            console.log('[YouTube Interceptor] XHR: scrubbed ads from player API');
                        }
                    } catch (e) {
                        // Non-JSON response, leave untouched
                    }
                });
            }
            return originalSend(...args);
        };

        return xhr;
    };

    // Copy static properties from original XHR
    Object.keys(OriginalXHR).forEach(key => {
        try { window.XMLHttpRequest[key] = OriginalXHR[key]; } catch (e) { }
    });
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;

    console.log('[YouTube Interceptor] Phase 1 injection complete (fetch + XHR)');
})();
