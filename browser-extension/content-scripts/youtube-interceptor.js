/**
 * YouTube Ad Interceptor - Phase 1: MAIN World JSON Scrubbing
 *
 * Intercepts YouTube's player config to remove ad data before it loads.
 * Must run at document_start in MAIN world.
 *
 * ENTITLEMENT GATE (race-safe):
 *   Hooks install unconditionally — they MUST be in place before any player
 *   API call fires. But actual scrubbing is gated on the `zasGate` flag,
 *   which resolves by polling a <meta name="zas-adblock-gate"> tag injected
 *   by youtube-gate.js (ISOLATED world). The async storage call resolves in
 *   ~20 ms; the first /youtubei/v1/player call fires at ~200-400 ms.
 *   The gate will always resolve in time.
 *
 * Phase 1 strategy: Monkeypatch both window.fetch AND XMLHttpRequest.
 * Intercept all requests targeting /youtubei/v1/player.
 * Parse the JSON, scrub ad arrays (adPlacements, playerAds, adSlots, adBreakParams),
 * and replace them with empty arrays before passing the response to YouTube.
 */

(function () {
    'use strict';

    if (!window.location.hostname.includes('youtube.com')) return;

    console.log('[YouTube Interceptor] Injecting Phase 1 (MAIN world)...');

    // ========================================
    // Entitlement Gate — three states
    //   null  = pending (gate meta not yet resolved)
    //   true  = active (premium subscriber)
    //   false = inactive (expired / free user)
    // ========================================

    let zasGate = null;

    function resolveGate() {
        const meta = document.querySelector('meta[name="zas-adblock-gate"]');
        if (meta) {
            zasGate = meta.content === 'active';
            console.log('[YouTube Interceptor] Gate resolved:', zasGate ? 'ACTIVE' : 'INACTIVE');
            return;
        }
        // Page fully loaded but gate never arrived — fail-closed (no scrubbing)
        if (document.readyState === 'complete') {
            zasGate = false;
            console.log('[YouTube Interceptor] Gate never arrived — fail-closed');
            return;
        }
        setTimeout(resolveGate, 10);
    }
    resolveGate();

    // Mid-session: subscription changes while tab is open
    document.addEventListener('zas-gate-update', () => {
        const meta = document.querySelector('meta[name="zas-adblock-gate"]');
        zasGate = meta ? meta.content === 'active' : false;
        console.log('[YouTube Interceptor] Gate updated mid-session:', zasGate ? 'ACTIVE' : 'INACTIVE');
    });

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

    const PLAYER_ENDPOINT = '/youtubei/v1/player';

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
        if (zasGate === true && window.ytInitialPlayerResponse) {
            scrubAdPayload(window.ytInitialPlayerResponse);
        }
    };

    setInterval(checkPlayerResponse, 500);
    document.addEventListener('DOMContentLoaded', checkPlayerResponse);

    // ========================================
    // Phase 1A: Intercept Fetch for player API
    // Hooks install unconditionally — scrubbing gated on zasGate
    // ========================================

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const url = args[0]?.url || args[0];

        if (typeof url === 'string' && url.includes(PLAYER_ENDPOINT)) {
            // If gate still pending, wait for it (resolves in <50ms)
            if (zasGate === null) {
                await new Promise(r => setTimeout(r, 50));
            }

            // Only scrub if premium is confirmed
            if (zasGate === true) {
                try {
                    const response = await originalFetch.apply(this, args);
                    const data = await response.clone().json();

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
        }

        return originalFetch.apply(this, args);
    };

    // ========================================
    // Phase 1B: Intercept XHR for player API
    // Hooks install unconditionally — scrubbing gated on zasGate
    // ========================================

    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
        const xhr = new OriginalXHR();
        const originalOpen = xhr.open.bind(xhr);
        let isPlayerRequest = false;

        xhr.open = function (method, url, ...rest) {
            if (typeof url === 'string' && url.includes(PLAYER_ENDPOINT)) {
                isPlayerRequest = true;
            }
            return originalOpen(method, url, ...rest);
        };

        const originalSend = xhr.send.bind(xhr);
        xhr.send = function (...args) {
            if (isPlayerRequest) {
                xhr.addEventListener('load', function () {
                    // Gate check — only scrub if premium is active
                    if (zasGate !== true) return;

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

    console.log('[YouTube Interceptor] Phase 1 injection complete (fetch + XHR, gate-controlled)');
})();
