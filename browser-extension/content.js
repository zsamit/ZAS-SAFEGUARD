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
        chrome.runtime.sendMessage({
            type: 'DEV_TOOLS_OPENED',
            url: window.location.href
        }).catch(() => { });

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
          background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 24px;
          font-size: 40px;
        ">🛡️</div>
        
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
        chrome.runtime.sendMessage({
            type: 'CONTENT_BLOCKED',
            url: window.location.href,
            reason
        }).catch(() => { });
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
    // EXTENSION CHECK
    // ============================================

    // Periodically verify extension is still running
    setInterval(() => {
        chrome.runtime.sendMessage({ type: 'PING' }).catch(() => {
            // Extension might be disabled - show warning
            console.warn('ZAS Safeguard: Extension communication lost');
        });
    }, 30000);

})();
