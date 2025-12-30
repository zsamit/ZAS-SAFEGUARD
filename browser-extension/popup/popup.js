// ZAS Safeguard Popup - Screenshot Design

// Theme
function initTheme() {
    const saved = localStorage.getItem('zasTheme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
        updateThemeIcon(saved);
    } else {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        updateThemeIcon(dark ? 'dark' : 'light');
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('zasTheme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
}

// Stats
async function loadStats() {
    try {
        const result = await chrome.storage.local.get(['stats']);
        const stats = result.stats || { blockedToday: 0, blockedTotal: 0 };
        document.getElementById('blockedToday').textContent = stats.blockedToday || 0;
        document.getElementById('blockedTotal').textContent = stats.blockedTotal || 0;
    } catch (e) {
        console.log('Stats error:', e);
    }
}

// Sync time
async function loadLastSync() {
    try {
        const result = await chrome.storage.local.get(['lastSync']);
        if (result.lastSync) {
            const diff = Math.floor((Date.now() - result.lastSync) / 60000);
            let text = diff < 1 ? 'Just now' : diff < 60 ? `${diff}m ago` : `${Math.floor(diff / 60)}h ago`;
            document.getElementById('lastSync').textContent = text;
        }
    } catch (e) { }
}

// Study mode
async function loadStudyMode() {
    try {
        const result = await chrome.storage.local.get(['activeStudySession', 'studyMode']);
        // Check for active session (used by dashboard) or legacy studyMode flag
        const isActive = result.activeStudySession || result.studyMode || false;
        document.getElementById('studyModeToggle').checked = isActive;
    } catch (e) { }
}

async function toggleStudyMode() {
    const enabled = document.getElementById('studyModeToggle').checked;

    if (enabled) {
        // Start study mode with default categories (social media + gaming + youtube + reddit)
        const session = {
            startTime: new Date().toISOString(),
            endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour default
            blockCategories: ['social_media', 'gaming', 'youtube', 'reddit'],
            source: 'popup'
        };

        await chrome.storage.local.set({
            studyMode: true,
            activeStudySession: session
        });

        chrome.runtime.sendMessage({
            type: 'STUDY_MODE_START',
            session: session
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Study mode start error:', chrome.runtime.lastError.message);
            } else {
                console.log('Study mode started:', response);
            }
        });
    } else {
        // Stop study mode
        await chrome.storage.local.set({ studyMode: false });
        await chrome.storage.local.remove(['activeStudySession', 'studyBlockCategories']);

        chrome.runtime.sendMessage({
            type: 'STUDY_MODE_STOP'
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Study mode stop error:', chrome.runtime.lastError.message);
            } else {
                console.log('Study mode stopped:', response);
            }
        });
    }
}

// User
async function loadUser() {
    try {
        const result = await chrome.storage.local.get(['userInfo', 'subscription']);
        if (result.userInfo?.email) {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('userSection').style.display = 'flex';
            document.getElementById('userName').textContent = result.userInfo.displayName || result.userInfo.email.split('@')[0];
            if (result.userInfo.photoURL) {
                document.getElementById('userAvatar').src = result.userInfo.photoURL;
            }
            const plan = result.subscription?.plan || 'Essential';
            document.getElementById('userPlan').textContent = plan + ' Plan';
        } else {
            document.getElementById('loginSection').style.display = 'block';
            document.getElementById('userSection').style.display = 'none';
        }
    } catch (e) { }
}

// Actions
function openDashboard() {
    chrome.tabs.create({ url: 'https://zassafeguard.com/app/' });
}

async function syncNow() {
    const btn = document.getElementById('syncBtn');
    const actionIcon = btn.querySelector('.action-icon');
    const origIcon = actionIcon.innerHTML;
    actionIcon.innerHTML = '⏳';

    try {
        // Send sync message to background script
        chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Sync error:', chrome.runtime.lastError.message);
            }
        });

        await chrome.storage.local.set({ lastSync: Date.now() });

        // Wait a bit for sync to complete, then update UI
        setTimeout(() => {
            actionIcon.innerHTML = '✅';
            loadLastSync();
            loadStats();
            setTimeout(() => {
                actionIcon.innerHTML = origIcon;
            }, 1500);
        }, 1500);
    } catch (e) {
        actionIcon.innerHTML = '❌';
        setTimeout(() => {
            actionIcon.innerHTML = origIcon;
        }, 2000);
    }
}

function signIn() {
    chrome.tabs.create({ url: 'https://zassafeguard.com/app/' });
}

// Quick URL Scan
async function quickScan() {
    const urlInput = document.getElementById('quickScanUrl');
    const scanBtn = document.getElementById('quickScanBtn');
    const resultDiv = document.getElementById('quickScanResult');
    const resultIcon = document.getElementById('scanResultIcon');
    const resultText = document.getElementById('scanResultText');

    let url = urlInput.value.trim();
    if (!url) {
        resultDiv.style.display = 'flex';
        resultIcon.textContent = '⚠️';
        resultText.textContent = 'Please enter a URL';
        resultDiv.className = 'quick-scan-result warning';
        return;
    }

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    // Validate URL
    try {
        new URL(url);
    } catch (e) {
        resultDiv.style.display = 'flex';
        resultIcon.textContent = '❌';
        resultText.textContent = 'Invalid URL';
        resultDiv.className = 'quick-scan-result danger';
        return;
    }

    // Show scanning state
    scanBtn.disabled = true;
    document.getElementById('scanBtnText').textContent = '...';
    resultDiv.style.display = 'none';

    try {
        // Call background script to scan URL
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'SCAN_URL',
                url: url
            }, (resp) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(resp);
                }
            });
        });

        resultDiv.style.display = 'flex';

        if (response && response.safe === false) {
            // Dangerous
            resultIcon.textContent = '🚨';
            resultText.textContent = response.category || 'Dangerous';
            resultDiv.className = 'quick-scan-result danger';
        } else if (response && response.suspicious) {
            // Suspicious
            resultIcon.textContent = '⚠️';
            resultText.textContent = 'Suspicious';
            resultDiv.className = 'quick-scan-result warning';
        } else {
            // Safe
            resultIcon.textContent = '✓';
            resultText.textContent = 'Safe';
            resultDiv.className = 'quick-scan-result safe';
        }
    } catch (e) {
        // Fallback: do basic local check
        const suspiciousPatterns = [
            /porn/i, /xxx/i, /adult/i, /sex/i,
            /phishing/i, /malware/i, /virus/i,
            /\.(tk|ml|ga|cf|gq)$/i
        ];

        let isSuspicious = false;
        for (const pattern of suspiciousPatterns) {
            if (pattern.test(url)) {
                isSuspicious = true;
                break;
            }
        }

        resultDiv.style.display = 'flex';
        if (isSuspicious) {
            resultIcon.textContent = '⚠️';
            resultText.textContent = 'Suspicious';
            resultDiv.className = 'quick-scan-result warning';
        } else {
            resultIcon.textContent = '✓';
            resultText.textContent = 'Appears Safe';
            resultDiv.className = 'quick-scan-result safe';
        }
    }

    scanBtn.disabled = false;
    document.getElementById('scanBtnText').textContent = 'Scan';
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadStats();
    loadLastSync();
    loadStudyMode();
    loadUser();

    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('studyModeToggle').addEventListener('change', toggleStudyMode);
    document.getElementById('dashboardBtn').addEventListener('click', openDashboard);
    document.getElementById('syncBtn').addEventListener('click', syncNow);
    document.getElementById('loginBtn').addEventListener('click', signIn);

    // Quick URL scan handlers
    document.getElementById('quickScanBtn').addEventListener('click', quickScan);
    document.getElementById('quickScanUrl').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') quickScan();
    });

    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});
