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
        const result = await chrome.storage.local.get(['studyMode']);
        document.getElementById('studyModeToggle').checked = result.studyMode || false;
    } catch (e) { }
}

async function toggleStudyMode() {
    const enabled = document.getElementById('studyModeToggle').checked;
    await chrome.storage.local.set({ studyMode: enabled });
    chrome.runtime.sendMessage({ action: 'toggleStudyMode', enabled });
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
    chrome.tabs.create({ url: 'https://zas-safeguard.web.app/app/' });
}

async function syncNow() {
    const btn = document.getElementById('syncBtn');
    btn.querySelector('.action-icon').textContent = '⏳';
    try {
        chrome.runtime.sendMessage({ action: 'syncNow' });
        await chrome.storage.local.set({ lastSync: Date.now() });
        setTimeout(() => {
            btn.querySelector('.action-icon').textContent = '✅';
            loadLastSync();
            loadStats();
            setTimeout(() => btn.querySelector('.action-icon').textContent = '🔄', 1500);
        }, 1000);
    } catch (e) {
        btn.querySelector('.action-icon').textContent = '❌';
    }
}

function signIn() {
    chrome.tabs.create({ url: 'https://zas-safeguard.web.app/app/' });
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
});
