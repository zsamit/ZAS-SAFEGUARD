// ============================================
// BLOCKED PAGE SCRIPT - MUST BE EXTERNAL FOR CSP
// ============================================

// ============================================
// QUOTES SYSTEM - AUTO IP-BASED DETECTION
// ============================================

// Countries that should show Islamic quotes
const MUSLIM_MAJORITY_COUNTRIES = [
    'SA', 'PK', 'BD', 'EG', 'TR', 'IR', 'IQ', 'AF', 'MA', 'DZ',
    'TN', 'JO', 'AE', 'KW', 'QA', 'BH', 'OM', 'YE', 'SY', 'LB',
    'PS', 'LY', 'SD', 'ID', 'MY', 'SN', 'ML', 'NE', 'NG', 'SO',
    'DJ', 'MR', 'GM', 'GN', 'SL', 'BF', 'KG', 'TJ', 'TM', 'UZ',
    'AZ', 'MV', 'BN', 'KZ'
];

// Auto-detect country from IP
async function detectCountry() {
    try {
        const response = await fetch('https://ipapi.co/country/');
        if (response.ok) {
            return (await response.text()).trim().toUpperCase();
        }
    } catch (e) {
        console.log('Could not detect country, using default');
    }
    return 'US';
}

// Load quote settings and display quote
async function loadAndDisplayQuote() {
    // Check if quotes are enabled
    let quotesEnabled = true;
    try {
        const result = await chrome.storage.local.get(['quoteSettings']);
        if (result.quoteSettings && result.quoteSettings.quotesEnabled === false) {
            quotesEnabled = false;
        }
    } catch (e) {
        // Not running as extension
    }

    if (!quotesEnabled) {
        document.getElementById('motivationText').textContent =
            'Stay focused on your goals. You\'ve got this!';
        return;
    }

    // Auto-detect country and get appropriate quote
    const countryCode = await detectCountry();
    const isMuslimCountry = MUSLIM_MAJORITY_COUNTRIES.includes(countryCode);
    const quoteType = isMuslimCountry ? 'islamic' : 'motivational';

    // Get quote using the quotes system
    try {
        if (typeof window.QuotesSystem !== 'undefined') {
            const quote = window.QuotesSystem.getRandomQuote({
                quoteType: quoteType,
                countryCode: countryCode
            });

            if (quote) {
                // Update icon based on quote type
                document.querySelector('.motivation-icon').textContent = isMuslimCountry ? '🕌' : '💪';

                // Update quote text
                let quoteHtml = `"${quote.text}"`;
                if (quote.source && quote.source !== 'Unknown') {
                    quoteHtml += `<br><small style="color: #6b7280; font-size: 14px; font-weight: normal;">— ${quote.source}</small>`;
                }
                document.getElementById('motivationText').innerHTML = quoteHtml;
            } else {
                displayFallbackQuote(isMuslimCountry);
            }
        } else {
            // Fallback if quotes system not loaded
            displayFallbackQuote(isMuslimCountry);
        }
    } catch (e) {
        console.error('Quote load error:', e);
        displayFallbackQuote(isMuslimCountry);
    }
}

// Fallback quotes (built-in)
function displayFallbackQuote(isMuslimCountry = false) {
    const motivationalQuotes = [
        "Every time you resist temptation, you become stronger. You're doing great!",
        "Your future self will thank you for this moment of strength.",
        "Small victories lead to big transformations. Keep going!",
        "You have the power to choose what influences your mind.",
        "This moment of resistance is building a better you.",
        "Stay focused on your goals. You've got this!",
        "True strength is saying no when it matters most.",
        "You're building habits that will change your life.",
    ];

    const islamicQuotes = [
        "Verily, with hardship comes ease. — Quran 94:6",
        "Lower your gaze, purify your heart. — Hadith",
        "Whoever fears Allah, He will make for him a way out. — Quran 65:2",
        "The strongest among you is the one who controls his anger. — Hadith",
        "Remember Allah, and He will remember you. — Quran 2:152",
    ];

    const quotes = isMuslimCountry ? islamicQuotes : motivationalQuotes;
    const randomMessage = quotes[Math.floor(Math.random() * quotes.length)];

    document.querySelector('.motivation-icon').textContent = isMuslimCountry ? '🕌' : '💪';
    document.getElementById('motivationText').textContent = randomMessage;
}

// Initialize quote display
loadAndDisplayQuote();

// Try to get blocked reason and URL from query params
const params = new URLSearchParams(window.location.search);
const reason = params.get('reason');
const blockedUrl = params.get('url');

// Check if this is a Study Mode block
if (reason && reason.includes('Study')) {
    // Study Mode - show focus message
    document.getElementById('reason').textContent = '📚 ' + decodeURIComponent(reason);
    document.querySelector('h1').textContent = 'Focus Time!';
    document.querySelector('.message').innerHTML =
        'This site is blocked during your Study Mode session.<br>' +
        'Stay focused on your goals - you can do this!';
    document.querySelector('.motivation-icon').textContent = '🎯';
    document.getElementById('motivationText').textContent =
        'Every minute of focus brings you closer to your goals. Keep going!';
}
// Check if this is a Child Lock block (parent locked device)
else if (reason && reason.includes('locked')) {
    // Parent lock - show friendly message
    document.getElementById('reason').textContent = '🔒 ' + decodeURIComponent(reason);
    document.querySelector('h1').textContent = 'Device Locked';
    document.querySelector('.message').innerHTML =
        'This device has been locked by your parent/guardian.<br>' +
        'Only educational websites are allowed during this time.';
    document.querySelector('.motivation-icon').textContent = '📚';
    document.getElementById('motivationText').textContent =
        'Focus on learning! Educational sites like Google, Wikipedia, and Khan Academy are still available.';
} else if (blockedUrl) {
    try {
        document.getElementById('reason').textContent = `Blocked: ${new URL(blockedUrl).hostname}`;
    } catch (e) {
        document.getElementById('reason').textContent = 'Adult/Harmful Content';
    }
}

// Load stats from storage
async function loadStats() {
    try {
        const result = await chrome.storage.local.get(['stats', 'streak']);
        const today = new Date().toDateString();

        if (result.stats) {
            // Check if it's a new day - reset if needed
            if (result.stats.date !== today) {
                // New day, reset blockedToday
                document.getElementById('blocksToday').textContent = '1';
            } else {
                document.getElementById('blocksToday').textContent = result.stats.blockedToday || 0;
            }
        } else {
            document.getElementById('blocksToday').textContent = '0';
        }

        if (result.streak) {
            document.getElementById('daysStreak').textContent = result.streak || 0;
        }
    } catch (e) {
        // Not running as extension - show 0
        document.getElementById('blocksToday').textContent = '0';
        document.getElementById('daysStreak').textContent = '0';
    }
}
loadStats();

// Increment block counter with daily reset
async function incrementBlockCounter() {
    try {
        const today = new Date().toDateString();
        const result = await chrome.storage.local.get(['stats']);
        let stats = result.stats || { blockedToday: 0, blockedTotal: 0, date: today };

        // Reset if it's a new day
        if (stats.date !== today) {
            stats.blockedToday = 0;
            stats.date = today;
        }

        stats.blockedToday++;
        stats.blockedTotal++;
        await chrome.storage.local.set({ stats });

        // Update display
        document.getElementById('blocksToday').textContent = stats.blockedToday;
    } catch (e) {
        // Not running as extension
    }
}
incrementBlockCounter();

// Log security event for parent alerts
async function logSecurityEventToBackground() {
    try {
        // Get the blocked URL from query params
        const urlParams = new URLSearchParams(window.location.search);
        const blockedUrl = urlParams.get('url') || urlParams.get('reason') || 'Unknown';

        console.log('[Blocked] Sending LOG_BLOCKED_SITE message for:', blockedUrl);

        // Send message to background script
        chrome.runtime.sendMessage({
            type: 'LOG_BLOCKED_SITE',
            url: blockedUrl,
            reason: urlParams.get('reason') || 'Blocked content',
            timestamp: Date.now()
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[Blocked] Could not log security event:', chrome.runtime.lastError.message);
            } else {
                console.log('[Blocked] Security event logged:', response);
            }
        });
    } catch (e) {
        console.log('[Blocked] Error logging security event:', e);
    }
}
logSecurityEventToBackground();

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.close();
    }
}

// Attach event listener (CSP-compliant - no inline handlers)
document.addEventListener('DOMContentLoaded', () => {
    const goBackBtn = document.getElementById('goBackBtn');
    if (goBackBtn) {
        goBackBtn.addEventListener('click', goBack);
    }
});
