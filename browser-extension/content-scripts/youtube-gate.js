/**
 * YouTube Entitlement Gate (ISOLATED world, document_start)
 *
 * Reads _verifiedSubscription from chrome.storage.local and injects a
 * <meta name="zas-adblock-gate"> tag that the MAIN-world interceptor
 * can poll synchronously. Resolves in ~20 ms — long before YouTube's
 * /youtubei/v1/player call fires (~200–400 ms after document_start).
 *
 * Also listens for storage changes so the gate can flip mid-session
 * (e.g. subscription expires while the tab is open).
 */

(function () {
    'use strict';

    if (!window.location.hostname.includes('youtube.com')) return;

    // ── Initial gate injection ──────────────────────────────────
    chrome.storage.local.get(['_verifiedSubscription'], (stored) => {
        const sub = stored._verifiedSubscription;
        const hasPremium = sub?.capabilities?.security_intelligence === true;

        const meta = document.createElement('meta');
        meta.name = 'zas-adblock-gate';
        meta.content = hasPremium ? 'active' : 'inactive';

        // document.head may not exist yet at document_start
        const target = document.head || document.documentElement;
        target.appendChild(meta);

        console.log('[YouTube Gate] Entitlement resolved:', meta.content);
    });

    // ── Mid-session updates ─────────────────────────────────────
    // If subscription state changes while the tab is open, update the
    // meta tag AND dispatch a CustomEvent so the MAIN-world interceptor
    // (which can't access storage) can re-check.
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes._verifiedSubscription) return;

        const sub = changes._verifiedSubscription.newValue;
        const hasPremium = sub?.capabilities?.security_intelligence === true;

        const meta = document.querySelector('meta[name="zas-adblock-gate"]');
        if (meta) {
            meta.content = hasPremium ? 'active' : 'inactive';
        }

        // CustomEvent crosses into MAIN world because both share the DOM
        document.dispatchEvent(new CustomEvent('zas-gate-update'));

        console.log('[YouTube Gate] Mid-session update:', hasPremium ? 'active' : 'inactive');
    });
})();
