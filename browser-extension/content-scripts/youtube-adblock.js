/**
 * YouTube Ad Blocker - Phase 2: UX Safety Net (Speed-Burn Fallback)
 *
 * Runs in ISOLATED world. If Phase 1 (MAIN world JSON scrubbing) fails
 * and an ad slips through, this script:
 *   - Detects .ad-showing on the player OR ytd-ad-slot-renderer injection
 *   - Mutes + speeds video to 16x
 *   - Applies blur overlay so user never sees the ad
 *   - Polls for "Skip Ad" button and clicks it instantly
 *   - Lets telemetry beacons fire naturally (25/50/75%) so YouTube's backend
 *     sees a valid ad view — no throttling
 *
 * Does NOT:
 *   - Use display: none on the video container (backend detects this)
 *   - Jump currentTime to end (backend detects 5ms ad with no quartiles)
 */

(function () {
    'use strict';

    if (!window.location.hostname.includes('youtube.com')) return;

    console.log('[YouTube AdBlock] Phase 2 safety net initializing...');

    // ========================================
    // Cosmetic Filters — non-video ad elements in the page
    // These are safe to CSS-hide (feed ads, banners, promos)
    // ========================================

    const cosmeticStyles = document.createElement('style');
    cosmeticStyles.id = 'zas-youtube-cosmetic';
    cosmeticStyles.textContent = `
        /* Feed / sidebar / banner ads — safe to hide */
        ytd-ad-slot-renderer,
        ytd-in-feed-ad-layout-renderer,
        ytd-banner-promo-renderer,
        ytd-statement-banner-renderer,
        ytd-mealbar-promo-renderer,
        ytd-compact-promoted-video-renderer,
        ytd-promoted-sparkles-web-renderer,
        ytd-promoted-video-renderer,
        ytd-display-ad-renderer,
        ytd-action-companion-ad-renderer,
        ytd-player-legacy-desktop-watch-ads-renderer,
        #masthead-ad,
        ytd-primetime-promo-renderer {
            display: none !important;
        }

        /* Hide promoted in lists */
        ytd-rich-item-renderer:has(> ytd-ad-slot-renderer),
        ytd-video-renderer:has(> .ytd-promoted-sparkles-text-search-renderer) {
            display: none !important;
        }

        /* Hide "Ad" badges */
        .ytd-badge-supported-renderer[aria-label="Ad"],
        .badge-style-type-ad {
            display: none !important;
        }

        /* Speed-burn blur overlay — applied dynamically via JS */
        .zas-ad-overlay {
            position: absolute !important;
            top: 0 !important; left: 0 !important;
            width: 100% !important; height: 100% !important;
            background: rgba(0, 0, 0, 0.85) !important;
            backdrop-filter: blur(20px) !important;
            z-index: 9999 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            pointer-events: none !important;
        }
        .zas-ad-overlay::after {
            content: 'Skipping ad...' !important;
            color: rgba(255,255,255,0.5) !important;
            font-size: 14px !important;
            font-family: 'Roboto', Arial, sans-serif !important;
        }

        /* FORCE SEARCH BAR VISIBLE */
        #masthead #search,
        #masthead #search-form,
        #masthead ytd-searchbox,
        ytd-masthead #search,
        ytd-masthead #search-form,
        ytd-masthead ytd-searchbox,
        #container.ytd-searchbox,
        #search-input.ytd-searchbox,
        #search-icon-legacy,
        ytd-searchbox#search {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
        }

        /* Hide adblocker detection overlays — but NOT the video itself */
        ytd-enforcement-message-view-model,
        .style-scope.ytd-enforcement-message-view-model,
        tp-yt-paper-dialog.style-scope.ytd-popup-container,
        tp-yt-iron-overlay-backdrop {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
    `;

    if (document.head) {
        document.head.appendChild(cosmeticStyles);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.head.appendChild(cosmeticStyles);
        });
    }

    // ========================================
    // Search Bar Protection
    // ========================================

    function protectSearchBar() {
        const searchBox = document.querySelector('ytd-searchbox, #search, #search-form');
        if (searchBox) {
            searchBox.style.cssText = 'display: flex !important; visibility: visible !important; opacity: 1 !important;';
            let parent = searchBox.parentElement;
            for (let i = 0; i < 3 && parent; i++) {
                if (parent.style.display === 'none' || parent.style.visibility === 'hidden') {
                    parent.style.cssText = 'display: flex !important; visibility: visible !important;';
                }
                parent = parent.parentElement;
            }
        }
    }

    setInterval(protectSearchBar, 500);

    // ========================================
    // Phase 2: Speed-Burn Ad Handler
    // ========================================

    let adOverlay = null;
    let adActive = false;
    let skipPoller = null;
    let originalPlaybackRate = 1;
    let originalMuted = false;

    /**
     * Apply speed-burn to an ad: mute, 16x speed, blur overlay
     */
    function engageSpeedBurn() {
        const video = document.querySelector('video');
        const player = document.querySelector('.html5-video-player');
        if (!video || !player || adActive) return;

        adActive = true;
        console.log('[YouTube AdBlock] Phase 2: Ad detected — engaging speed-burn');

        // Save original state
        originalPlaybackRate = video.playbackRate;
        originalMuted = video.muted;

        // Mute immediately
        video.muted = true;

        // Set maximum playback rate — try 16, fallback chain
        try {
            video.playbackRate = 16;
        } catch (e) {
            try { video.playbackRate = 8; } catch (e2) {
                try { video.playbackRate = 4; } catch (e3) {
                    video.playbackRate = 2;
                }
            }
        }

        // Apply blur overlay to the player container
        if (!adOverlay) {
            adOverlay = document.createElement('div');
            adOverlay.className = 'zas-ad-overlay';
        }
        player.style.position = 'relative';
        player.appendChild(adOverlay);

        // Start polling for skip button (200ms interval)
        if (skipPoller) clearInterval(skipPoller);
        skipPoller = setInterval(trySkipAd, 200);
    }

    /**
     * Try to click the native Skip Ad button
     */
    function trySkipAd() {
        const skipSelectors = [
            '.ytp-ad-skip-button',
            '.ytp-skip-ad-button',
            '.ytp-ad-skip-button-modern',
            'button.ytp-ad-skip-button',
            '.ytp-ad-skip-button-slot button',
            '.videoAdUiSkipButton',
            'button[class*="skip"]'
        ];

        for (const selector of skipSelectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) {
                console.log('[YouTube AdBlock] Phase 2: Clicking skip button');
                btn.click();
                return;
            }
        }
    }

    /**
     * Disengage speed-burn — restore normal playback
     */
    function disengageSpeedBurn() {
        if (!adActive) return;

        adActive = false;
        console.log('[YouTube AdBlock] Phase 2: Ad finished — restoring playback');

        const video = document.querySelector('video');
        if (video) {
            video.playbackRate = originalPlaybackRate;
            video.muted = originalMuted;
        }

        // Remove overlay
        if (adOverlay && adOverlay.parentNode) {
            adOverlay.parentNode.removeChild(adOverlay);
        }

        // Stop skip poller
        if (skipPoller) {
            clearInterval(skipPoller);
            skipPoller = null;
        }
    }

    // ========================================
    // MutationObserver — dual signal detection
    // ========================================

    /**
     * Signal 1: Watch for .ad-showing class on video player
     * Signal 2: Watch for ytd-ad-slot-renderer DOM injection
     * Two independent signals so a class rename only breaks one.
     */
    function startAdObserver() {
        const player = document.querySelector('.html5-video-player');
        if (!player) {
            setTimeout(startAdObserver, 500);
            return;
        }

        // Observer for .ad-showing class changes on the player
        const classObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const isAdShowing = player.classList.contains('ad-showing');
                    if (isAdShowing && !adActive) {
                        engageSpeedBurn();
                    } else if (!isAdShowing && adActive) {
                        disengageSpeedBurn();
                    }
                }
            }
        });

        classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
        console.log('[YouTube AdBlock] Phase 2: Class observer started on player');

        // Also check immediately in case ad is already showing
        if (player.classList.contains('ad-showing')) {
            engageSpeedBurn();
        }
    }

    // Observer for ad slot DOM injection (catches banner-style in-player ads)
    function startDomObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        // Check if an ad slot was injected into the player area
                        if (node.tagName === 'YTD-AD-SLOT-RENDERER' ||
                            node.querySelector?.('ytd-ad-slot-renderer')) {
                            console.log('[YouTube AdBlock] Phase 2: Ad slot injected in DOM');
                            // Cosmetic CSS handles feed ads; check if this is a video ad
                            const player = document.querySelector('.html5-video-player');
                            if (player && player.classList.contains('ad-showing') && !adActive) {
                                engageSpeedBurn();
                            }
                        }
                    }
                }
            }
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });
        console.log('[YouTube AdBlock] Phase 2: DOM injection observer started');
    }

    // Also use an interval as a final safety net
    function adCheckLoop() {
        const player = document.querySelector('.html5-video-player');
        if (!player) return;

        const isAdShowing = player.classList.contains('ad-showing');
        if (isAdShowing && !adActive) {
            engageSpeedBurn();
        } else if (!isAdShowing && adActive) {
            disengageSpeedBurn();
        }
    }

    // ========================================
    // Initialize
    // ========================================

    function init() {
        startAdObserver();
        startDomObserver();
        setInterval(adCheckLoop, 1000); // Safety net interval
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
        if (skipPoller) clearInterval(skipPoller);
        disengageSpeedBurn();
    });

    console.log('[YouTube AdBlock] Phase 2 safety net ready');
})();
