/**
 * YouTube Ad Blocker - Cosmetic Filtering + Auto-Skip
 * Handles YouTube-specific ad blocking that DNR rules can't catch
 */

(function () {
    'use strict';

    // Skip if not on YouTube
    if (!window.location.hostname.includes('youtube.com')) return;

    console.log('[YouTube AdBlock] Initializing...');

    // ========================================
    // PHASE 2: Cosmetic Filters (CSS Injection)
    // ========================================

    const adStyles = document.createElement('style');
    adStyles.id = 'zas-youtube-adblock';
    adStyles.textContent = `
        /* Video player ad elements - element selectors (safer) */
        .ytp-ad-module,
        .ytp-ad-image-overlay,
        .ytp-ad-text-overlay,
        .ytp-ad-overlay-container,
        .ytp-ad-overlay-slot,
        .video-ads,
        #player-ads,
        .ytp-ad-progress,
        .ytp-ad-progress-list,
        .ytp-ad-player-overlay,
        .ytp-ad-player-overlay-instream-info,
        .ytp-ad-player-overlay-skip-or-preview,
        .ytp-ad-skip-button-container,
        .ytp-ad-preview-container,
        .ytp-ad-message-container,
        .ad-showing .ytp-chrome-top {
            display: none !important;
        }

        /* Ad slot renderers - use element tags for safety */
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
        ytd-player-legacy-desktop-watch-ads-renderer {
            display: none !important;
        }

        /* Hide promoted videos in lists */
        ytd-rich-item-renderer:has(> ytd-ad-slot-renderer),
        ytd-video-renderer:has(> .ytd-promoted-sparkles-text-search-renderer) {
            display: none !important;
        }

        /* Hide "Ad" badges on home/search */
        .ytd-badge-supported-renderer[aria-label="Ad"],
        .badge-style-type-ad,
        span.ytd-badge-supported-renderer:has-text("Ad") {
            display: none !important;
        }

        /* Hide masthead ads */
        #masthead-ad,
        ytd-primetime-promo-renderer {
            display: none !important;
        }

        /* Speed up ads that slip through - make container tiny */
        .ad-showing video {
            /* Don't hide video, just let it play fast */
        }

        /* FORCE SEARCH BAR VISIBLE - Anti-detection */
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
            width: auto !important;
            height: auto !important;
            overflow: visible !important;
            position: relative !important;
            transform: none !important;
        }

        /* Hide any ad-blocker detection overlays */
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

    // Inject styles as early as possible
    if (document.head) {
        document.head.appendChild(adStyles);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.head.appendChild(adStyles);
        });
    }

    // ========================================
    // Search Bar Protection (Active JS Fix)
    // ========================================

    function protectSearchBar() {
        const searchBox = document.querySelector('ytd-searchbox, #search, #search-form');
        if (searchBox) {
            searchBox.style.cssText = 'display: flex !important; visibility: visible !important; opacity: 1 !important;';

            // Also check parent containers
            let parent = searchBox.parentElement;
            for (let i = 0; i < 3 && parent; i++) {
                if (parent.style.display === 'none' || parent.style.visibility === 'hidden') {
                    parent.style.cssText = 'display: flex !important; visibility: visible !important;';
                }
                parent = parent.parentElement;
            }
        }
    }

    // Run protection on interval
    setInterval(protectSearchBar, 500);

    // Also observe for changes
    const searchObserver = new MutationObserver(protectSearchBar);
    const observeSearch = () => {
        const masthead = document.querySelector('ytd-masthead, #masthead');
        if (masthead) {
            searchObserver.observe(masthead, {
                attributes: true,
                subtree: true,
                attributeFilter: ['style', 'class', 'hidden']
            });
        } else {
            setTimeout(observeSearch, 500);
        }
    };
    observeSearch();

    // ========================================
    // Floating Search Button (Backup Search)
    // ========================================

    let floatingSearchBtn = null;
    let floatingSearchBox = null;

    function createFloatingSearch() {
        if (floatingSearchBtn) return; // Already exists

        // Create floating button container with Home + Search
        floatingSearchBtn = document.createElement('div');
        floatingSearchBtn.id = 'zas-floating-search';
        floatingSearchBtn.innerHTML = `
            <div id="zas-home-btn" title="YouTube Home" style="display:flex;align-items:center;justify-content:center;padding:8px;cursor:pointer;border-radius:50%;margin-right:4px;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
                    <path d="M12 3L4 9v12h5v-7h6v7h5V9l-8-6z"/>
                </svg>
            </div>
            <div style="width:1px;height:20px;background:rgba(255,255,255,0.3);margin-right:8px;"></div>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <span>Search</span>
        `;
        floatingSearchBtn.style.cssText = `
            position: fixed;
            top: 50%;
            right: -200px;
            transform: translateY(-50%);
            background: linear-gradient(135deg, #ff0000, #cc0000);
            color: white;
            padding: 10px 16px;
            border-radius: 24px 0 0 24px;
            cursor: pointer;
            z-index: 9999999;
            display: none;
            align-items: center;
            gap: 8px;
            font-family: 'Roboto', Arial, sans-serif;
            font-size: 14px;
            font-weight: 500;
            box-shadow: -4px 4px 12px rgba(0,0,0,0.3);
            user-select: none;
            transition: right 0.3s ease;
        `;

        // Create collapsed tab (the visible part on the side)
        const collapsedTab = document.createElement('div');
        collapsedTab.id = 'zas-collapsed-tab';
        collapsedTab.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
        `;
        collapsedTab.style.cssText = `
            position: fixed;
            top: 50%;
            right: 0;
            transform: translateY(-50%);
            background: linear-gradient(135deg, #ff0000, #cc0000);
            color: white;
            padding: 12px 8px;
            border-radius: 8px 0 0 8px;
            cursor: pointer;
            z-index: 9999998;
            display: none;
            align-items: center;
            justify-content: center;
            box-shadow: -2px 2px 8px rgba(0,0,0,0.3);
            transition: padding 0.2s;
        `;

        let isExpanded = false;

        collapsedTab.addEventListener('click', () => {
            isExpanded = !isExpanded;
            if (isExpanded) {
                floatingSearchBtn.style.right = '0px';
                collapsedTab.style.display = 'none';
            }
        });

        collapsedTab.addEventListener('mouseenter', () => {
            collapsedTab.style.paddingRight = '12px';
        });
        collapsedTab.addEventListener('mouseleave', () => {
            collapsedTab.style.paddingRight = '8px';
        });

        const closePanel = () => {
            isExpanded = false;
            floatingSearchBtn.style.right = '-200px';
            setTimeout(() => {
                collapsedTab.style.display = 'flex';
            }, 300);
        };

        // Close when clicking outside the panel
        document.addEventListener('click', (e) => {
            if (isExpanded &&
                !floatingSearchBtn.contains(e.target) &&
                !floatingSearchBox.contains(e.target) &&
                !collapsedTab.contains(e.target)) {
                closePanel();
            }
        });

        document.body.appendChild(collapsedTab);
        window._zasCollapsedTab = collapsedTab;

        // Create search input box (hidden by default)
        floatingSearchBox = document.createElement('div');
        floatingSearchBox.id = 'zas-floating-search-box';
        floatingSearchBox.innerHTML = `
            <input type="text" placeholder="Search YouTube..." id="zas-search-input" />
            <button id="zas-search-submit">Search</button>
        `;
        floatingSearchBox.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            background: white;
            padding: 12px;
            border-radius: 12px;
            z-index: 9999999;
            display: none;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        // Style the input
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            #zas-floating-search:hover {
                transform: scale(1.05);
                box-shadow: 0 6px 16px rgba(0,0,0,0.4);
            }
            #zas-search-input {
                width: 280px;
                padding: 10px 16px;
                border: 2px solid #ddd;
                border-radius: 24px;
                font-size: 14px;
                outline: none;
            }
            #zas-search-input:focus {
                border-color: #ff0000;
            }
            #zas-search-submit {
                background: #ff0000;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 24px;
                cursor: pointer;
                font-weight: 500;
            }
            #zas-search-submit:hover {
                background: #cc0000;
            }
        `;
        document.head.appendChild(styleEl);

        // Add click handler (only for the search part, not Home)
        floatingSearchBtn.addEventListener('click', (e) => {
            // Don't trigger search if clicking home button
            const clickedHomeBtn = e.target.id === 'zas-home-btn' || e.target.closest('#zas-home-btn');

            if (clickedHomeBtn) {
                return;
            }
            floatingSearchBtn.style.display = 'none';
            floatingSearchBox.style.display = 'flex';
            document.getElementById('zas-search-input').focus();
        });

        // Submit handler
        const doSearch = () => {
            const query = document.getElementById('zas-search-input').value.trim();
            if (query) {
                window.location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
            }
        };

        floatingSearchBox.querySelector('#zas-search-submit').addEventListener('click', doSearch);
        floatingSearchBox.querySelector('#zas-search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch();
            if (e.key === 'Escape') {
                floatingSearchBox.style.display = 'none';
                checkSearchBarVisibility();
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (floatingSearchBox.style.display === 'flex' &&
                !floatingSearchBox.contains(e.target) &&
                !floatingSearchBtn.contains(e.target)) {
                floatingSearchBox.style.display = 'none';
                checkSearchBarVisibility();
            }
        });

        // Home button click handler
        const homeBtn = floatingSearchBtn.querySelector('#zas-home-btn');
        if (homeBtn) {
            homeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = 'https://www.youtube.com/';
            });
            homeBtn.addEventListener('mouseenter', () => {
                homeBtn.style.background = 'rgba(255,255,255,0.2)';
            });
            homeBtn.addEventListener('mouseleave', () => {
                homeBtn.style.background = 'transparent';
            });
        }

        // ========================================
        // Drag Functionality
        // ========================================
        let isDragging = false;
        let dragStartX, dragStartY;
        let elementStartX, elementStartY;

        floatingSearchBtn.addEventListener('mousedown', (e) => {
            isDragging = true;
            floatingSearchBtn.style.cursor = 'grabbing';
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const rect = floatingSearchBtn.getBoundingClientRect();
            elementStartX = rect.left;
            elementStartY = rect.top;

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;

            floatingSearchBtn.style.left = (elementStartX + deltaX) + 'px';
            floatingSearchBtn.style.top = (elementStartY + deltaY) + 'px';
            floatingSearchBtn.style.right = 'auto';

            // Also move the search box to same position
            floatingSearchBox.style.left = (elementStartX + deltaX) + 'px';
            floatingSearchBox.style.top = (elementStartY + deltaY) + 'px';
            floatingSearchBox.style.right = 'auto';
        });

        document.addEventListener('mouseup', (e) => {
            if (isDragging) {
                isDragging = false;
                floatingSearchBtn.style.cursor = 'grab';

                // If barely moved, treat as click
                const deltaX = Math.abs(e.clientX - dragStartX);
                const deltaY = Math.abs(e.clientY - dragStartY);
                if (deltaX < 5 && deltaY < 5) {
                    // It was a click, not a drag
                    floatingSearchBtn.style.display = 'none';
                    floatingSearchBox.style.display = 'flex';
                    document.getElementById('zas-search-input').focus();
                }
            }
        });

        document.body.appendChild(floatingSearchBtn);
        document.body.appendChild(floatingSearchBox);
    }

    function checkSearchBarVisibility() {
        const searchBox = document.querySelector('ytd-searchbox#search');
        const ytLogo = document.querySelector('ytd-topbar-logo-renderer, #logo');

        // Check if search bar OR logo is hidden
        const isSearchHidden = !searchBox ||
            searchBox.offsetParent === null ||
            window.getComputedStyle(searchBox).display === 'none' ||
            window.getComputedStyle(searchBox).visibility === 'hidden' ||
            searchBox.offsetWidth === 0;

        const isLogoHidden = !ytLogo ||
            ytLogo.offsetParent === null ||
            window.getComputedStyle(ytLogo).display === 'none';

        const shouldShow = isSearchHidden || isLogoHidden;

        if (shouldShow && window._zasCollapsedTab) {
            // Only show collapsed tab - main button stays hidden until clicked
            window._zasCollapsedTab.style.display = 'flex';
            // Keep button ready but hidden off-screen
            floatingSearchBtn.style.display = 'flex';
            // Don't change right position - keep it at -100px until tab is clicked
        } else if (floatingSearchBtn && window._zasCollapsedTab) {
            window._zasCollapsedTab.style.display = 'none';
            floatingSearchBtn.style.display = 'none';
            floatingSearchBtn.style.right = '-200px';
            floatingSearchBox.style.display = 'none';
        }
    }

    // Initialize floating search when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            createFloatingSearch();
            setInterval(checkSearchBarVisibility, 1000);
        });
    } else {
        createFloatingSearch();
        setInterval(checkSearchBarVisibility, 1000);
    }

    // ========================================
    // PHASE 3: Auto-Skip Script
    // ========================================

    let skipAttempts = 0;
    const MAX_SKIP_ATTEMPTS = 50;

    // Check for ads and auto-skip
    function checkAndSkipAd() {
        const player = document.querySelector('.html5-video-player');
        const video = document.querySelector('video');

        if (!player || !video) return;

        const isAdPlaying = player.classList.contains('ad-showing');

        if (isAdPlaying) {
            skipAttempts++;
            console.log('[YouTube AdBlock] Ad detected, attempting skip...');

            // Try to click skip button
            const skipButtons = [
                '.ytp-ad-skip-button',
                '.ytp-skip-ad-button',
                '.ytp-ad-skip-button-modern',
                'button.ytp-ad-skip-button',
                '.ytp-ad-skip-button-slot button',
                '[class*="skip"] button',
                '.videoAdUiSkipButton'
            ];

            for (const selector of skipButtons) {
                const btn = document.querySelector(selector);
                if (btn && btn.offsetParent !== null) {
                    console.log('[YouTube AdBlock] Clicking skip button:', selector);
                    btn.click();
                    skipAttempts = 0;
                    return;
                }
            }

            // If no skip button, try these techniques:

            // 1. Speed up the ad (if we can control it)
            if (video.playbackRate < 16) {
                video.playbackRate = 16;
                console.log('[YouTube AdBlock] Speeding up ad 16x');
            }

            // 2. Mute during ad
            if (!video.muted) {
                video.muted = true;
                video.dataset.zasMuted = 'true';
            }

            // 3. Try to skip to end of ad
            if (video.duration && video.duration < 120 && skipAttempts > 10) {
                // Only try this for short ads
                video.currentTime = video.duration - 0.1;
                console.log('[YouTube AdBlock] Skipping to end of ad');
            }

        } else {
            // Ad finished - restore settings
            skipAttempts = 0;

            if (video.playbackRate > 2) {
                video.playbackRate = 1;
            }

            if (video.dataset.zasMuted === 'true') {
                video.muted = false;
                delete video.dataset.zasMuted;
            }
        }
    }

    // Run checker on interval
    const adCheckInterval = setInterval(checkAndSkipAd, 500);

    // Also run on player state changes
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' &&
                mutation.attributeName === 'class' &&
                mutation.target.classList.contains('html5-video-player')) {
                checkAndSkipAd();
            }
        }
    });

    // Start observing when player is available
    function startObserver() {
        const player = document.querySelector('.html5-video-player');
        if (player) {
            observer.observe(player, { attributes: true });
            console.log('[YouTube AdBlock] Observer started');
        } else {
            setTimeout(startObserver, 1000);
        }
    }

    // Wait for page to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        clearInterval(adCheckInterval);
        observer.disconnect();
    });

    console.log('[YouTube AdBlock] Initialized successfully');
})();
