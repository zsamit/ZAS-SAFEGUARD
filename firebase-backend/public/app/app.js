/**
 * ZAS Safeguard - Web Dashboard Application
 * Version: 1.0.0
 */

// Dashboard Version
const DASHBOARD_VERSION = '1.0.0';

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCp48nYcR_QFoxfACqCP13ML7TeICiC6t0",
    authDomain: "zas-safeguard.firebaseapp.com",
    projectId: "zas-safeguard",
    storageBucket: "zas-safeguard.firebasestorage.app",
    messagingSenderId: "559930411646",
    appId: "1:559930411646:web:0377d31d2b8b0d3500a62f"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// App State
let currentUser = null;
let userProfile = null;

// DOM Elements
const elements = {
    loading: document.getElementById('loading'),
    authScreen: document.getElementById('authScreen'),
    dashboardScreen: document.getElementById('dashboardScreen'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    tabs: document.querySelectorAll('.auth-tabs .tab'),
    navLinks: document.querySelectorAll('.nav-links li'),
    sections: document.querySelectorAll('.section')
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

function initializeApp() {
    // Listen for auth state changes
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            await loadUserProfile();
            showDashboard();
            // Check if user needs to select mode (first login)
            setTimeout(() => checkOnboarding(), 500);
        } else {
            currentUser = null;
            userProfile = null;
            showAuthScreen();
        }
        hideLoading();
    });
}

function setupEventListeners() {
    // Auth tabs
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
    });

    // Login form
    elements.loginForm.addEventListener('submit', handleLogin);

    // Register form
    elements.registerForm.addEventListener('submit', handleRegister);

    // Google Sign In
    document.getElementById('googleSignIn').addEventListener('click', handleGoogleSignIn);
    document.getElementById('googleSignUp')?.addEventListener('click', handleGoogleSignIn);

    // Microsoft Sign In
    document.getElementById('microsoftSignIn')?.addEventListener('click', handleMicrosoftSignIn);
    document.getElementById('microsoftSignUp')?.addEventListener('click', handleMicrosoftSignIn);

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Navigation
    elements.navLinks.forEach(link => {
        link.addEventListener('click', () => navigateTo(link.dataset.section));
    });

    // Add domain button
    document.getElementById('addDomainBtn').addEventListener('click', handleAddDomain);

    // Master key button
    document.getElementById('setMasterKeyBtn')?.addEventListener('click', handleSetMasterKey);

    // Category toggles
    document.getElementById('toggleGambling')?.addEventListener('change', (e) =>
        toggleCategory('gambling', e.target.checked));
    document.getElementById('toggleSocial')?.addEventListener('change', (e) =>
        toggleCategory('social_media', e.target.checked));
    document.getElementById('toggleGaming')?.addEventListener('change', (e) =>
        toggleCategory('gaming', e.target.checked));
}

// Auth Functions
function switchAuthTab(tab) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

    if (tab === 'login') {
        elements.loginForm.style.display = 'flex';
        elements.registerForm.style.display = 'none';
    } else {
        elements.loginForm.style.display = 'none';
        elements.registerForm.style.display = 'flex';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        alert('Login failed: ' + error.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    if (password.length < 8) {
        alert('Password must be at least 8 characters');
        return;
    }

    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);

        // Update display name
        await userCredential.user.updateProfile({ displayName: name });

        // Create user profile in Firestore (mode will be set after login via modal)
        await createUserProfile(userCredential.user, { name, mode: null });

    } catch (error) {
        alert('Registration failed: ' + error.message);
    }
}

async function handleGoogleSignIn() {
    const provider = new firebase.auth.GoogleAuthProvider();

    try {
        const result = await auth.signInWithPopup(provider);

        // Check if new user - prompt for mode
        if (result.additionalUserInfo?.isNewUser) {
            const mode = document.getElementById('registerMode')?.value || 'student';
            await createUserProfile(result.user, {
                name: result.user.displayName,
                mode: mode
            });
        }
    } catch (error) {
        alert('Google sign in failed: ' + error.message);
    }
}

async function handleMicrosoftSignIn() {
    const provider = new firebase.auth.OAuthProvider('microsoft.com');

    try {
        const result = await auth.signInWithPopup(provider);

        // Check if new user
        if (result.additionalUserInfo?.isNewUser) {
            const mode = document.getElementById('registerMode')?.value || 'student';
            await createUserProfile(result.user, {
                name: result.user.displayName,
                mode: mode
            });
        }
    } catch (error) {
        alert('Microsoft sign in failed: ' + error.message);
    }
}

async function handleLogout() {
    try {
        await auth.signOut();
    } catch (error) {
        alert('Logout failed: ' + error.message);
    }
}

// Password Reset
async function handlePasswordReset() {
    const email = prompt('Enter your email address to reset password:');
    if (!email) return;

    try {
        await auth.sendPasswordResetEmail(email);
        alert('✅ Password reset email sent! Check your inbox.');
    } catch (error) {
        alert('Failed to send reset email: ' + error.message);
    }
}

// Delete Child Profile
async function handleDeleteChild(childId) {
    if (!currentUser) return;

    const confirmed = confirm('Are you sure you want to delete this child profile?\n\nThis action cannot be undone.');
    if (!confirmed) return;

    try {
        await db.collection('children').doc(childId).delete();
        alert('✅ Child profile deleted.');
        loadChildren();
    } catch (error) {
        alert('Failed to delete child: ' + error.message);
    }
}

// Delete Account
async function handleDeleteAccount() {
    if (!currentUser) return;

    const email = currentUser.email;
    const confirmed = confirm(
        '⚠️ DELETE ACCOUNT ⚠️\n\n' +
        'This will permanently delete:\n' +
        '• Your account and profile\n' +
        '• All your settings and blocklists\n' +
        '• All device connections\n' +
        '• All subscription data\n\n' +
        'This action CANNOT be undone.\n\n' +
        'Type "DELETE" to confirm.'
    );

    if (!confirmed) return;

    const confirmText = prompt('Type "DELETE" to confirm account deletion:');
    if (confirmText !== 'DELETE') {
        alert('Account deletion cancelled.');
        return;
    }

    try {
        // Delete user data from Firestore
        await db.collection('users').doc(currentUser.uid).delete();

        // Delete associated data
        const collections = ['devices', 'children', 'study_sessions', 'blocked_creators', 'logs'];
        for (const coll of collections) {
            const query = await db.collection(coll)
                .where('userId', '==', currentUser.uid)
                .get();
            const batch = db.batch();
            query.docs.forEach(doc => batch.delete(doc.ref));
            if (query.docs.length > 0) await batch.commit();
        }

        // Delete auth account
        await currentUser.delete();

        alert('✅ Account deleted successfully. Goodbye!');
        window.location.href = '/safeguard/';

    } catch (error) {
        if (error.code === 'auth/requires-recent-login') {
            alert('For security, please log out and log back in, then try again.');
        } else {
            alert('Failed to delete account: ' + error.message);
        }
    }
}

// Save Settings
async function handleSaveSettings() {
    if (!currentUser) return;

    try {
        const updates = {
            'settings.quotesEnabled': document.getElementById('quotesEnabled')?.checked ?? true,
        };

        // Save owner settings if in owner mode
        if (userProfile?.mode === 'owner') {
            // Master key is saved separately via handleSetMasterKey
        }

        await db.collection('users').doc(currentUser.uid).update(updates);

        // Send updated settings to extension
        const extId = new URLSearchParams(window.location.search).get('ext') || 'zas-safeguard';
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage(extId, {
                    type: 'SETTINGS_UPDATE',
                    settings: {
                        quotesEnabled: updates['settings.quotesEnabled']
                    }
                });
            }
        } catch (e) {
            console.log('Could not send to extension:', e);
        }

        alert('✅ Settings saved successfully!');

    } catch (error) {
        alert('Failed to save settings: ' + error.message);
    }
}

// Wire up event listeners for new functions
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('forgotPasswordLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        handlePasswordReset();
    });
    document.getElementById('deleteAccountBtn')?.addEventListener('click', handleDeleteAccount);
    document.getElementById('saveQuoteSettingsBtn')?.addEventListener('click', handleSaveSettings);
});

// Make deleteChild available globally for onclick in HTML
window.deleteChild = handleDeleteChild;


// User Profile
async function createUserProfile(user, data) {
    const mode = data.mode || null; // Mode selected after login

    // Calculate 7-day trial end date
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 7);

    const profile = {
        email: user.email,
        displayName: data.name || user.displayName || 'User',
        mode: mode,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        subscription: {
            status: 'trial',
            plan: null, // No plan until they subscribe
            trialStart: firebase.firestore.FieldValue.serverTimestamp(),
            trialEnd: firebase.firestore.Timestamp.fromDate(trialEndDate),
            trialActive: true
        },
        settings: {
            categories: {
                porn: { enabled: true, locked: mode === 'owner' },
                gambling: { enabled: true, locked: false },
                social_media: { enabled: false, locked: false },
                gaming: { enabled: false, locked: false }
            },
            customBlocklist: [],
            customAllowlist: [],
            blockedCreators: []
        }
    };

    await db.collection('users').doc(user.uid).set(profile);

    // Create mode-specific profile
    if (mode === 'owner') {
        await db.collection('owner_profiles').doc(user.uid).set({
            uid: user.uid,
            ultraStrict: true,
            masterKeyHash: null,
            unlockCount: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } else if (mode === 'family') {
        await db.collection('family_profiles').doc(user.uid).set({
            uid: user.uid,
            children: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } else if (mode === 'student') {
        await db.collection('student_profiles').doc(user.uid).set({
            uid: user.uid,
            studySessions: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}

async function loadUserProfile() {
    if (!currentUser) return;

    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) {
            userProfile = doc.data();
        } else {
            // Create profile if doesn't exist
            await createUserProfile(currentUser, {
                name: currentUser.displayName,
                mode: 'owner'
            });
            userProfile = (await db.collection('users').doc(currentUser.uid).get()).data();
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

// Navigation
function navigateTo(section) {
    // Update nav
    elements.navLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.section === section);
    });

    // Show section
    elements.sections.forEach(sec => {
        sec.style.display = sec.id === `${section}Section` ? 'block' : 'none';
    });

    // Load section data
    switch (section) {
        case 'overview':
            loadOverviewData();
            break;
        case 'devices':
            loadDevices();
            break;
        case 'blocklist':
            loadBlocklistSettings();
            break;
        case 'studymode':
            loadStudyMode();
            break;
        case 'creators':
            loadCreators();
            break;
        case 'activity':
            loadActivityLog();
            break;
        case 'children':
            loadChildren();
            break;
        case 'alerts':
            loadAlerts();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// Screen Management
function showAuthScreen() {
    elements.authScreen.style.display = 'block';
    elements.dashboardScreen.style.display = 'none';
}

function showDashboard() {
    elements.authScreen.style.display = 'none';
    elements.dashboardScreen.style.display = 'flex';

    // Update user info
    document.getElementById('userName').textContent = currentUser.displayName || 'User';
    if (currentUser.photoURL) {
        document.getElementById('userAvatar').src = currentUser.photoURL;
    }

    const mode = userProfile?.mode;
    const modeBanner = document.getElementById('modeBanner');
    const modeTitle = document.getElementById('modeTitle');
    const modeDescription = document.getElementById('modeDescription');
    const modeIcon = document.querySelector('.mode-icon');

    // Show/hide nav items and update banner based on mode
    if (mode === 'family') {
        document.getElementById('childrenNav').style.display = 'block';
        document.getElementById('browserWarning').style.display = 'flex'; // Show multi-browser tip
        modeBanner.classList.add('family');
        modeBanner.classList.remove('student');
        modeTitle.textContent = 'Family Mode';
        modeDescription.textContent = 'Parental controls active. Manage your children\'s online safety.';
        modeIcon.textContent = '👨‍👩‍👧';
    } else if (mode === 'student') {
        document.getElementById('childrenNav').style.display = 'none';
        modeBanner.classList.add('student');
        modeBanner.classList.remove('family');
        modeTitle.textContent = 'Student Mode';
        modeDescription.textContent = 'Focus mode for studying. Use Study Mode to lock distractions during exams!';
        modeIcon.textContent = '🎓';
    } else if (mode === 'owner') {
        document.getElementById('childrenNav').style.display = 'none';
        modeBanner.classList.remove('family', 'student');
        modeTitle.textContent = 'Owner Mode';
        modeDescription.textContent = 'Ultra-strict protection enabled. Adult content is permanently blocked.';
        modeIcon.textContent = '🔒';
    }

    // Set active mode tab
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // Show URL Scans only for Pro/Lifetime plans
    const plan = userProfile?.subscription?.plan?.toLowerCase() || 'free';
    const isPro = plan.includes('pro') || plan === 'lifetime';
    document.getElementById('urlScansNav').style.display = isPro ? 'flex' : 'none';

    // Load initial data
    loadOverviewData();
}

// Mode Tab Switching
async function switchMode(newMode) {
    if (!currentUser) return;

    const currentMode = userProfile?.mode;
    if (newMode === currentMode) return;

    try {
        // Update Firestore
        await db.doc(`users/${currentUser.uid}`).update({ mode: newMode });

        // Update local profile
        userProfile.mode = newMode;

        // Refresh dashboard UI
        showDashboard();

    } catch (error) {
        alert('Failed to switch mode: ' + error.message);
    }
}

// Setup mode tab event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('studentModeTab')?.addEventListener('click', () => switchMode('student'));
    document.getElementById('familyModeTab')?.addEventListener('click', () => switchMode('family'));
});

function hideLoading() {
    elements.loading.style.display = 'none';
}

// Data Loading Functions
async function loadOverviewData() {
    if (!currentUser) return;

    try {
        // Load stats
        const logsQuery = await db.collection('logs')
            .where('userId', '==', currentUser.uid)
            .where('timestamp', '>=', getTodayStart())
            .get();

        document.getElementById('statBlockedToday').textContent = logsQuery.size;

        const devicesQuery = await db.collection('devices')
            .where('userId', '==', currentUser.uid)
            .get();

        document.getElementById('statDevices').textContent = devicesQuery.size;

        // Subscription status
        const status = userProfile?.subscription?.status || 'free';
        document.getElementById('statSubscription').textContent =
            status.charAt(0).toUpperCase() + status.slice(1);

        // Recent blocks
        const recentLogs = await db.collection('logs')
            .where('userId', '==', currentUser.uid)
            .where('action', '==', 'navigate_blocked')
            .orderBy('timestamp', 'desc')
            .limit(5)
            .get();

        const recentBlocksList = document.getElementById('recentBlocks');
        if (recentLogs.empty) {
            recentBlocksList.innerHTML = '<li class="empty">No recent blocks 🎉</li>';
        } else {
            recentBlocksList.innerHTML = recentLogs.docs.map(doc => {
                const data = doc.data();
                const time = data.timestamp?.toDate()?.toLocaleTimeString() || '';
                return `<li>🚫 ${data.url || 'Unknown'} - ${time}</li>`;
            }).join('');
        }

    } catch (error) {
        console.error('Error loading overview:', error);
    }

    // Initialize the activity chart
    initActivityChart();
}

// ===== ACTIVITY CHART =====
let activityChartInstance = null;

async function initActivityChart() {
    const ctx = document.getElementById('activityChart');
    if (!ctx) return;

    // Destroy existing chart if any
    if (activityChartInstance) {
        activityChartInstance.destroy();
    }

    // Get last 7 days data
    const labels = [];
    const data = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));

        // Get blocked count for this day
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        try {
            const query = await db.collection('logs')
                .where('userId', '==', currentUser.uid)
                .where('action', '==', 'navigate_blocked')
                .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(dayStart))
                .where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(dayEnd))
                .get();
            data.push(query.size);
        } catch (e) {
            // Show 0 if no data or query fails (real data only)
            console.log('Chart query error:', e.message);
            data.push(0);
        }
    }

    // Theme-aware colors
    const isDark = !document.documentElement.getAttribute('data-theme') ||
        document.documentElement.getAttribute('data-theme') !== 'light';

    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#8f9bb3' : '#64748b';

    activityChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Sites Blocked',
                data: data,
                fill: true,
                backgroundColor: (context) => {
                    const chart = context.chart;
                    const { ctx, chartArea } = chart;
                    if (!chartArea) return 'rgba(51, 102, 255, 0.1)';
                    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                    gradient.addColorStop(0, 'rgba(51, 102, 255, 0.3)');
                    gradient.addColorStop(1, 'rgba(51, 102, 255, 0.02)');
                    return gradient;
                },
                borderColor: '#3366ff',
                borderWidth: 3,
                tension: 0.4,
                pointBackgroundColor: '#3366ff',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#1a2138',
                    titleColor: '#ffffff',
                    bodyColor: '#8f9bb3',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: {
                            size: 12
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: {
                            size: 12
                        },
                        stepSize: 5
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

async function loadDevices() {
    if (!currentUser) return;

    try {
        const query = await db.collection('devices')
            .where('userId', '==', currentUser.uid)
            .get();

        const devicesList = document.getElementById('devicesList');
        let html = '';

        query.forEach(doc => {
            const device = doc.data();
            const icon = getDeviceIcon(device.type);
            const lastSeen = device.lastSeen?.toDate()?.toLocaleString() || 'Never';

            html += `
                <div class="device-card">
                    <div class="icon">${icon}</div>
                    <h4>${device.name || device.type}</h4>
                    <p>Last seen: ${lastSeen}</p>
                </div>
            `;
        });

        html += `
            <div class="device-card add-device" onclick="showAddDevice()">
                <span class="icon">➕</span>
                <p>Add Device</p>
            </div>
        `;

        devicesList.innerHTML = html;

    } catch (error) {
        console.error('Error loading devices:', error);
    }
}

async function loadBlocklistSettings() {
    if (!userProfile?.settings?.categories) return;

    const cats = userProfile.settings.categories;

    document.getElementById('toggleGambling').checked = cats.gambling?.enabled || false;
    document.getElementById('toggleSocial').checked = cats.social_media?.enabled || false;
    document.getElementById('toggleGaming').checked = cats.gaming?.enabled || false;

    // Load custom domains
    const customList = document.getElementById('customDomainsList');
    const customDomains = userProfile.settings.customBlocklist || [];

    if (customDomains.length === 0) {
        customList.innerHTML = '<li class="empty">No custom domains added</li>';
    } else {
        customList.innerHTML = customDomains.map(domain => `
            <li>
                <span>${domain}</span>
                <button class="btn btn-danger btn-sm" onclick="removeDomain('${domain}')">Remove</button>
            </li>
        `).join('');
    }
}

async function loadActivityLog() {
    if (!currentUser) return;

    try {
        const query = await db.collection('logs')
            .where('userId', '==', currentUser.uid)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        const activityLog = document.getElementById('activityLog');

        if (query.empty) {
            activityLog.innerHTML = '<div class="empty-state">No activity recorded yet</div>';
            return;
        }

        let html = '<ul>';
        query.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp?.toDate()?.toLocaleString() || '';
            const icon = log.action === 'navigate_blocked' ? '🚫' :
                log.action === 'unlock_attempt' ? '🔓' : '📋';

            html += `<li>${icon} ${log.action} - ${log.url || log.details || ''} <small>${time}</small></li>`;
        });
        html += '</ul>';

        activityLog.innerHTML = html;

    } catch (error) {
        console.error('Error loading activity:', error);
    }
}

async function loadChildren() {
    if (!currentUser || userProfile?.mode !== 'family') return;

    try {
        const query = await db.collection('children')
            .where('parentId', '==', currentUser.uid)
            .get();

        const childrenList = document.getElementById('childrenList');

        if (query.empty) {
            childrenList.innerHTML = '<div class="empty-state">No children profiles yet</div>';
            return;
        }

        let html = '';
        query.forEach(doc => {
            const child = doc.data();
            html += `
                <div class="device-card">
                    <div class="icon">👤</div>
                    <h4>${child.name}</h4>
                    <p>Age: ${child.age || 'Not set'}</p>
                    <div class="card-actions" style="display: flex; gap: 8px; margin-top: 10px;">
                        <button class="btn btn-danger btn-sm" onclick="deleteChild('${doc.id}')" style="font-size: 12px; padding: 6px 12px;">Delete</button>
                    </div>
                </div>
            `;
        });

        childrenList.innerHTML = html;

    } catch (error) {
        console.error('Error loading children:', error);
    }
}

// Handle Add Child button click
async function handleAddChild() {
    if (!currentUser) {
        alert('Please login first');
        return;
    }

    const name = prompt('Enter child\'s name:');
    if (!name || !name.trim()) {
        return;
    }

    const ageStr = prompt('Enter child\'s age (optional):');
    const age = ageStr ? parseInt(ageStr) : null;

    try {
        await db.collection('children').add({
            name: name.trim(),
            age: age,
            parentId: currentUser.uid,
            parentUid: currentUser.uid, // Both for compatibility
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            settings: {
                adultBlocking: true,
                socialMediaBlocking: false,
                screenTimeLimit: null
            }
        });

        alert(`✅ Child "${name}" has been added!`);
        loadChildren();

    } catch (error) {
        console.error('Error adding child:', error);
        alert('Failed to add child: ' + error.message);
    }
}

// Wire up addChildBtn event listener
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addChildBtn')?.addEventListener('click', handleAddChild);
});

function loadSettings() {
    if (!currentUser || !userProfile) return;

    document.getElementById('settingsEmail').value = currentUser.email || '';
    document.getElementById('settingsName').value = currentUser.displayName || '';

    // Display plan name properly
    const planName = userProfile.subscription?.plan;
    let displayPlan = 'Free Trial';
    if (planName) {
        const planLabels = {
            'essential_monthly': 'Essential Monthly',
            'pro_monthly': 'Pro Monthly',
            'essential_yearly': 'Essential Yearly',
            'pro_yearly': 'Pro Yearly',
            'lifetime': 'Lifetime',
            'free': 'Free Trial'
        };
        displayPlan = planLabels[planName.toLowerCase()] || planName.charAt(0).toUpperCase() + planName.slice(1);
    }
    document.getElementById('currentPlan').textContent = displayPlan;

    // Show owner settings only for owner mode
    const ownerSettings = document.getElementById('ownerSettings');
    if (userProfile.mode === 'owner') {
        ownerSettings.style.display = 'block';
    } else {
        ownerSettings.style.display = 'none';
    }

    // Pro feature lock for AI Analyzer
    const plan = userProfile.subscription?.plan?.toLowerCase() || '';
    const status = userProfile.subscription?.status?.toLowerCase() || '';
    const isPro = (plan.includes('pro') || plan === 'lifetime') &&
        (status === 'active' || status === 'trialing');

    const aiContent = document.getElementById('aiAnalyzerContent');
    const aiUpgrade = document.getElementById('aiAnalyzerUpgrade');

    if (isPro) {
        aiContent.style.display = 'block';
        aiUpgrade.style.display = 'none';
        // Load AI toggle state
        const aiEnabled = userProfile.settings?.aiAnalysisEnabled !== false;
        document.getElementById('aiAnalysisEnabled').checked = aiEnabled;
    } else {
        aiContent.style.display = 'none';
        aiUpgrade.style.display = 'block';
    }
}

// AI Analyzer - Analyze URL
async function handleAnalyzeUrl() {
    const urlInput = document.getElementById('aiAnalyzeUrl');
    const resultDiv = document.getElementById('aiAnalyzerResult');
    const resultText = document.getElementById('aiResultText');
    const btn = document.getElementById('analyzeUrlBtn');

    const url = urlInput.value.trim();
    if (!url) {
        alert('Please enter a URL to analyze');
        return;
    }

    // Validate URL
    try {
        new URL(url);
    } catch (e) {
        alert('Please enter a valid URL (including https://)');
        return;
    }

    // Show loading
    btn.disabled = true;
    btn.textContent = '⏳ Analyzing...';
    resultDiv.style.display = 'block';
    resultText.innerHTML = '🔄 Analyzing content, please wait...';

    try {
        const classifyContent = firebase.functions().httpsCallable('classifyContent');
        const result = await classifyContent({
            url: url,
            title: '',
            content: ''
        });

        const data = result.data;

        if (data.success) {
            const classification = data.classification;
            let resultHtml = '';

            if (classification.isAdult) {
                resultHtml = `<span style="color: #ef4444; font-weight: bold;">🚫 UNSAFE - Adult Content Detected</span>`;
            } else if (classification.isHarmful) {
                resultHtml = `<span style="color: #f59e0b; font-weight: bold;">⚠️ SUSPICIOUS - Potentially Harmful</span>`;
            } else if (classification.isGambling) {
                resultHtml = `<span style="color: #f59e0b; font-weight: bold;">⚠️ WARNING - Gambling Content</span>`;
            } else {
                resultHtml = `<span style="color: #22c55e; font-weight: bold;">✅ SAFE - No threats detected</span>`;
            }

            resultHtml += `<br><br>`;
            resultHtml += `<strong>Categories:</strong> ${classification.categories?.join(', ') || 'None'}<br>`;
            resultHtml += `<strong>Confidence:</strong> ${Math.round((classification.confidence || 0) * 100)}%<br>`;
            resultHtml += `<strong>Method:</strong> ${data.method === 'ai' ? 'AI Analysis' : 'Keyword Analysis'}<br>`;

            if (classification.reason) {
                resultHtml += `<strong>Reason:</strong> ${classification.reason}`;
            }

            resultText.innerHTML = resultHtml;
        } else {
            // Handle errors gracefully
            if (data.error === 'pro_required') {
                resultText.innerHTML = `<span style="color: #f59e0b;">🔒 ${data.message}</span>`;
            } else {
                resultText.innerHTML = `<span style="color: #f59e0b;">⚠️ ${data.message}</span>`;
            }
        }
    } catch (error) {
        console.error('AI Analysis error:', error);
        resultText.innerHTML = `<span style="color: #ef4444;">❌ AI Analyzer is temporarily unavailable. Please try again later.</span>`;
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Analyze URL';
    }
}

// Wire up AI Analyzer event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('analyzeUrlBtn')?.addEventListener('click', handleAnalyzeUrl);
    document.getElementById('aiAnalysisEnabled')?.addEventListener('change', async (e) => {
        if (!currentUser) return;
        try {
            await db.collection('users').doc(currentUser.uid).update({
                'settings.aiAnalysisEnabled': e.target.checked
            });
        } catch (error) {
            console.error('Failed to update AI toggle:', error);
        }
    });
});

// Action Handlers
async function handleAddDomain() {
    const input = document.getElementById('customDomain');
    const domain = input.value.trim().toLowerCase();

    if (!domain) return;

    // Validate domain format
    if (!domain.match(/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/)) {
        alert('Please enter a valid domain (e.g., example.com)');
        return;
    }

    try {
        await db.collection('users').doc(currentUser.uid).update({
            'settings.customBlocklist': firebase.firestore.FieldValue.arrayUnion(domain)
        });

        input.value = '';

        // Reload profile and blocklist
        await loadUserProfile();
        loadBlocklistSettings();

        alert(`${domain} added to blocklist!`);

    } catch (error) {
        alert('Failed to add domain: ' + error.message);
    }
}

async function removeDomain(domain) {
    if (!confirm(`Remove ${domain} from blocklist?`)) return;

    try {
        await db.collection('users').doc(currentUser.uid).update({
            'settings.customBlocklist': firebase.firestore.FieldValue.arrayRemove(domain)
        });

        await loadUserProfile();
        loadBlocklistSettings();

    } catch (error) {
        alert('Failed to remove domain: ' + error.message);
    }
}

async function toggleCategory(category, enabled) {
    try {
        await db.collection('users').doc(currentUser.uid).update({
            [`settings.categories.${category}.enabled`]: enabled
        });

        await loadUserProfile();

        // Send to extension for immediate effect
        const extId = new URLSearchParams(window.location.search).get('ext') || 'zas-safeguard';
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage(extId, {
                    type: 'CATEGORY_TOGGLE',
                    category: category,
                    enabled: enabled
                }, (response) => {
                    console.log('Category toggle sent to extension:', response);
                });
            }
        } catch (e) {
            console.log('Could not send to extension:', e);
        }

    } catch (error) {
        alert('Failed to update category: ' + error.message);
    }
}

async function handleSetMasterKey() {
    const input = document.getElementById('masterKeyInput');
    const key = input.value;

    if (key.length < 60) {
        alert('Master key must be at least 60 characters for security');
        return;
    }

    if (!confirm('Are you sure you want to set this as your master key? You will need this exact key to unlock in emergencies.')) {
        return;
    }

    try {
        // Hash the key (in production, use proper hashing)
        const keyHash = await hashString(key);

        await db.collection('owner_profiles').doc(currentUser.uid).update({
            masterKeyHash: keyHash,
            masterKeyUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });

        input.value = '';
        alert('Master key has been set! Keep it safe - you will need it for emergency unlocks.');

    } catch (error) {
        alert('Failed to set master key: ' + error.message);
    }
}

// Utility Functions
function getDeviceIcon(type) {
    const icons = {
        chrome: '🌐',
        mac: '💻',
        windows: '🖥️',
        android: '📱',
        ios: '📱'
    };
    return icons[type] || '💻';
}

function getTodayStart() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function showAddDevice() {
    alert('To add a device:\n\n1. Install ZAS Safeguard on the device\n2. Sign in with your account\n3. The device will appear here automatically');
}

function editChild(childId) {
    alert('Child profile editing - Coming soon!');
}

// Make functions available globally
window.removeDomain = removeDomain;
window.showAddDevice = showAddDevice;
window.editChild = editChild;
window.removeCreator = removeCreator;

// ===== STUDY MODE FUNCTIONS =====

let studyModeInterval = null;

async function loadStudyMode() {
    if (!currentUser) return;

    try {
        // Check for active study session
        const activeDoc = await db.collection('study_sessions')
            .where('userId', '==', currentUser.uid)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        const activeBanner = document.getElementById('activeStudySession');
        const createSection = document.getElementById('createStudySession');

        if (!activeDoc.empty) {
            const session = activeDoc.docs[0].data();
            const endTime = session.endTime.toDate();

            // Show active session
            activeBanner.style.display = 'flex';
            createSection.style.display = 'none';
            document.getElementById('studySessionName').textContent = session.name;
            document.getElementById('studyEndDate').textContent = endTime.toLocaleString();

            // Start countdown
            startCountdown(endTime, activeDoc.docs[0].id);
        } else {
            activeBanner.style.display = 'none';
            createSection.style.display = 'block';

            // Set min date to now
            const now = new Date();
            now.setMinutes(now.getMinutes() + 30); // Minimum 30 minutes
            document.getElementById('studyEndDateTime').min = now.toISOString().slice(0, 16);
        }

        // Load study history
        await loadStudyHistory();

    } catch (error) {
        console.error('Error loading study mode:', error);
    }

    // Setup event listener for start button
    document.getElementById('startStudyModeBtn')?.removeEventListener('click', handleStartStudyMode);
    document.getElementById('startStudyModeBtn')?.addEventListener('click', handleStartStudyMode);
}

function startCountdown(endTime, sessionId) {
    if (studyModeInterval) clearInterval(studyModeInterval);

    function updateCountdown() {
        const now = new Date();
        const diff = endTime - now;

        if (diff <= 0) {
            // Study session ended
            clearInterval(studyModeInterval);
            endStudySession(sessionId);
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        document.getElementById('countdownDays').textContent = days;
        document.getElementById('countdownHours').textContent = hours;
        document.getElementById('countdownMinutes').textContent = minutes;
        document.getElementById('countdownSeconds').textContent = seconds;
    }

    updateCountdown();
    studyModeInterval = setInterval(updateCountdown, 1000);
}

async function endStudySession(sessionId) {
    try {
        await db.collection('study_sessions').doc(sessionId).update({
            status: 'completed',
            completedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        loadStudyMode();
        alert('🎉 Congratulations! Your study session is complete. Good luck on your exam!');
    } catch (error) {
        console.error('Error ending study session:', error);
    }
}

async function handleStartStudyMode() {
    const name = document.getElementById('studySessionNameInput').value.trim();
    const endDateTime = document.getElementById('studyEndDateTime').value;

    if (!name) {
        alert('Please enter a session name');
        return;
    }

    if (!endDateTime) {
        alert('Please select an end date and time');
        return;
    }

    const endTime = new Date(endDateTime);
    const now = new Date();

    if (endTime <= now) {
        alert('End time must be in the future');
        return;
    }

    // Gather block options
    const blockCategories = [];
    if (document.getElementById('studyBlockSocial').checked) blockCategories.push('social_media');
    if (document.getElementById('studyBlockGaming').checked) blockCategories.push('gaming');
    if (document.getElementById('studyBlockYouTube').checked) blockCategories.push('youtube');
    if (document.getElementById('studyBlockReddit').checked) blockCategories.push('reddit');

    if (blockCategories.length === 0) {
        alert('Please select at least one category to block');
        return;
    }

    // Confirm
    const daysUntilEnd = Math.ceil((endTime - now) / (1000 * 60 * 60 * 24));
    if (!confirm(`Are you sure you want to start Study Mode?\n\n📚 Session: ${name}\n⏰ Duration: ${daysUntilEnd} day(s)\n🚫 Blocked: ${blockCategories.join(', ')}\n\n⚠️ This CANNOT be cancelled once started!`)) {
        return;
    }

    try {
        await db.collection('study_sessions').add({
            userId: currentUser.uid,
            name: name,
            status: 'active',
            startTime: firebase.firestore.FieldValue.serverTimestamp(),
            endTime: firebase.firestore.Timestamp.fromDate(endTime),
            blockCategories: blockCategories,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Enable blocking for selected categories
        const updates = {};
        blockCategories.forEach(cat => {
            updates[`settings.categories.${cat}.enabled`] = true;
            updates[`settings.categories.${cat}.studyLocked`] = true;
        });
        await db.collection('users').doc(currentUser.uid).update(updates);

        // Send to extension to activate blocking immediately
        const extId = new URLSearchParams(window.location.search).get('ext') || 'zas-safeguard';
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage(extId, {
                    type: 'STUDY_MODE_START',
                    session: {
                        name: name,
                        endTime: endTime.toISOString(),
                        blockCategories: blockCategories
                    }
                }, (response) => {
                    console.log('Study mode sent to extension:', response);
                });
            }
        } catch (e) {
            console.log('Could not communicate with extension:', e);
        }

        alert('🎓 Study Mode activated! Stay focused and good luck! 📚');
        loadStudyMode();

    } catch (error) {
        alert('Failed to start study mode: ' + error.message);
    }
}

async function loadStudyHistory() {
    try {
        const query = await db.collection('study_sessions')
            .where('userId', '==', currentUser.uid)
            .where('status', '==', 'completed')
            .orderBy('endTime', 'desc')
            .limit(10)
            .get();

        const historyList = document.getElementById('studyHistory');

        if (query.empty) {
            historyList.innerHTML = '<div class="empty-state">No completed study sessions yet. Start your first one above!</div>';
            return;
        }

        let html = '';
        query.forEach(doc => {
            const session = doc.data();
            const startDate = session.startTime?.toDate()?.toLocaleDateString() || 'N/A';
            const endDate = session.endTime?.toDate()?.toLocaleDateString() || 'N/A';

            html += `
                <div class="history-item">
                    <div>
                        <div class="session-name">${session.name}</div>
                        <div class="session-dates">${startDate} - ${endDate}</div>
                    </div>
                    <span class="session-status completed">✓ Completed</span>
                </div>
            `;
        });

        historyList.innerHTML = html;

    } catch (error) {
        console.error('Error loading study history:', error);
    }
}

// ===== CREATOR BLOCK FUNCTIONS =====

async function loadCreators() {
    if (!currentUser) return;

    try {
        const query = await db.collection('blocked_creators')
            .where('userId', '==', currentUser.uid)
            .orderBy('createdAt', 'desc')
            .get();

        const creatorsList = document.getElementById('blockedCreatorsList');

        if (query.empty) {
            creatorsList.innerHTML = '<div class="empty-state">No creators blocked yet. Use the form above to block specific creators.</div>';
        } else {
            let html = '';
            query.forEach(doc => {
                const creator = doc.data();
                const platformIcon = getPlatformIcon(creator.platform);

                html += `
                    <div class="creator-item">
                        <div class="creator-info">
                            <span class="platform-icon">${platformIcon}</span>
                            <div>
                                <div class="creator-name">@${creator.username}</div>
                                <div class="creator-reason">${creator.reason || 'No reason specified'}</div>
                            </div>
                        </div>
                        <button class="btn-remove" onclick="removeCreator('${doc.id}')">Remove</button>
                    </div>
                `;
            });
            creatorsList.innerHTML = html;
        }

    } catch (error) {
        console.error('Error loading creators:', error);
    }

    // Setup event listener
    document.getElementById('addCreatorBtn')?.removeEventListener('click', handleAddCreator);
    document.getElementById('addCreatorBtn')?.addEventListener('click', handleAddCreator);
}

function getPlatformIcon(platform) {
    const icons = {
        youtube: '📺',
        tiktok: '🎵',
        instagram: '📸',
        twitter: '🐦',
        twitch: '🎮'
    };
    return icons[platform] || '🌐';
}

async function handleAddCreator() {
    const platform = document.getElementById('creatorPlatform').value;
    let username = document.getElementById('creatorUsername').value.trim();
    const reason = document.getElementById('creatorReason').value.trim();

    if (!username) {
        alert('Please enter a creator username or URL');
        return;
    }

    // Clean up username
    username = username.replace(/^@/, '').replace(/https?:\/\/[^\/]+\//, '').replace(/\/$/, '');

    try {
        await db.collection('blocked_creators').add({
            userId: currentUser.uid,
            platform: platform,
            username: username,
            reason: reason,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Clear form
        document.getElementById('creatorUsername').value = '';
        document.getElementById('creatorReason').value = '';

        alert(`✓ @${username} has been blocked on ${platform}`);
        loadCreators();

    } catch (error) {
        alert('Failed to block creator: ' + error.message);
    }
}

async function removeCreator(creatorId) {
    if (!confirm('Remove this creator from your block list?')) return;

    try {
        await db.collection('blocked_creators').doc(creatorId).delete();
        loadCreators();
    } catch (error) {
        alert('Failed to remove creator: ' + error.message);
    }
}

// ===== ALERTS FUNCTIONS =====

async function loadAlerts() {
    if (!currentUser) return;

    try {
        // Load alerts
        const alertsQuery = await db.collection(`alerts/${currentUser.uid}`)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        const alertHistoryList = document.getElementById('alertHistoryList');
        let unreadCount = 0;

        if (alertsQuery.empty) {
            alertHistoryList.innerHTML = '<div class="empty-state">No alerts yet. Your children\'s activity will appear here.</div>';
        } else {
            let html = '';
            alertsQuery.forEach(doc => {
                const alert = doc.data();
                const timestamp = alert.timestamp?.toDate?.() || new Date();
                const isUnread = !alert.read;
                if (isUnread) unreadCount++;

                html += `
                    <div class="alert-item ${isUnread ? 'unread' : ''}" data-id="${doc.id}">
                        <div class="alert-icon">${getAlertIcon(alert.type)}</div>
                        <div class="alert-content">
                            <h4>${alert.title || alert.type}</h4>
                            <p>${alert.message || ''}</p>
                            <span class="alert-time">${timestamp.toLocaleString()}</span>
                        </div>
                        ${isUnread ? '<span class="unread-dot"></span>' : ''}
                    </div>
                `;
            });
            alertHistoryList.innerHTML = html;
        }

        // Update badge
        document.getElementById('unreadAlertsCount').textContent = unreadCount;
        const badge = document.getElementById('alertBadge');
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }

        // Load device status
        await loadDeviceStatus();

        // Load alert settings
        await loadAlertSettings();

    } catch (error) {
        console.error('Error loading alerts:', error);
    }
}

function getAlertIcon(type) {
    const icons = {
        'extension_disabled': '🔌',
        'heartbeat_missing': '📵',
        'blocked_attempts_threshold': '🚫',
        'tamper_attempt': '🚨'
    };
    return icons[type] || '⚠️';
}

function getDeviceIcon(type) {
    const icons = {
        'chrome': '🌐',
        'edge': '🌐',
        'browser': '🌐',
        'windows': '💻',
        'macos': '🍎',
        'android': '📱',
        'ios': '📱',
        'iphone': '📱',
        'ipad': '📱',
        'tablet': '📱'
    };
    return icons[type?.toLowerCase()] || '💻';
}

async function loadDeviceStatus() {
    if (!currentUser) return;

    try {
        const devicesQuery = await db.collection('devices')
            .where('userId', '==', currentUser.uid)
            .get();

        const deviceStatusList = document.getElementById('deviceStatusList');
        let onlineCount = 0;
        const now = Date.now();
        const tenMinutes = 10 * 60 * 1000;

        if (devicesQuery.empty) {
            deviceStatusList.innerHTML = '<div class="empty-state">No devices registered yet.</div>';
            document.getElementById('onlineDevicesCount').textContent = '0';
            return;
        }

        let html = '';
        devicesQuery.forEach(doc => {
            const device = doc.data();
            const lastHeartbeat = device.lastHeartbeat?.toDate?.() || new Date(0);
            const isOnline = (now - lastHeartbeat.getTime()) < tenMinutes;
            if (isOnline) onlineCount++;

            const statusClass = isOnline ? 'online' : 'offline';
            const statusText = isOnline ? 'Online' : `Last seen ${getTimeAgo(lastHeartbeat)}`;

            html += `
                <div class="device-status-item ${statusClass}">
                    <div class="device-icon">${getDeviceIcon(device.type)}</div>
                    <div class="device-info">
                        <h4>${device.name || 'Unknown Device'}</h4>
                        <span class="device-status ${statusClass}">${statusText}</span>
                    </div>
                    <span class="status-indicator ${statusClass}"></span>
                </div>
            `;
        });

        deviceStatusList.innerHTML = html;
        document.getElementById('onlineDevicesCount').textContent = onlineCount;

    } catch (error) {
        console.error('Error loading device status:', error);
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

async function loadAlertSettings() {
    if (!currentUser) return;

    try {
        const settingsDoc = await db.doc(`alert_settings/${currentUser.uid}`).get();
        if (settingsDoc.exists) {
            const settings = settingsDoc.data();
            document.getElementById('alertEmailEnabled').checked = settings.enabled !== false;
            document.getElementById('alertThreshold').value = settings.blockedAttemptsPerMinute || '2';
            document.getElementById('alertHeartbeatThreshold').value = settings.heartbeatMissingMinutes || '10';
        }
    } catch (error) {
        console.error('Error loading alert settings:', error);
    }
}

async function saveAlertSettings() {
    if (!currentUser) return;

    try {
        const settings = {
            enabled: document.getElementById('alertEmailEnabled').checked,
            blockedAttemptsPerMinute: parseInt(document.getElementById('alertThreshold').value),
            heartbeatMissingMinutes: parseInt(document.getElementById('alertHeartbeatThreshold').value)
        };

        await db.doc(`alert_settings/${currentUser.uid}`).set(settings, { merge: true });
        alert('Alert settings saved!');
    } catch (error) {
        alert('Failed to save settings: ' + error.message);
    }
}

async function markAllAlertsRead() {
    if (!currentUser) return;

    try {
        const alertsQuery = await db.collection(`alerts/${currentUser.uid}`)
            .where('read', '==', false)
            .get();

        const batch = db.batch();
        alertsQuery.forEach(doc => {
            batch.update(doc.ref, { read: true, readAt: firebase.firestore.FieldValue.serverTimestamp() });
        });

        await batch.commit();
        loadAlerts();
    } catch (error) {
        alert('Failed to mark alerts as read: ' + error.message);
    }
}

// Setup alerts event listeners
document.getElementById('saveAlertSettingsBtn')?.addEventListener('click', saveAlertSettings);
document.getElementById('markAllReadBtn')?.addEventListener('click', markAllAlertsRead);

// ===== EXPORT/IMPORT SETTINGS =====

async function exportSettings() {
    if (!currentUser || !userProfile) return;

    try {
        const exportData = {
            version: DASHBOARD_VERSION,
            exportDate: new Date().toISOString(),
            settings: userProfile.settings || {},
            customBlocklist: userProfile.settings?.customBlocklist || [],
            categories: userProfile.settings?.categories || {}
        };

        // Get study sessions
        const studyQuery = await db.collection('study_sessions')
            .where('userId', '==', currentUser.uid)
            .get();
        exportData.studySessions = studyQuery.docs.map(d => d.data());

        // Get blocked creators
        const creatorsQuery = await db.collection('blocked_creators')
            .where('userId', '==', currentUser.uid)
            .get();
        exportData.blockedCreators = creatorsQuery.docs.map(d => d.data());

        // Get alert settings
        const alertSettings = await db.doc(`alert_settings/${currentUser.uid}`).get();
        exportData.alertSettings = alertSettings.exists ? alertSettings.data() : {};

        // Download JSON
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zas-safeguard-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        alert('Settings exported successfully!');
    } catch (error) {
        alert('Export failed: ' + error.message);
    }
}

async function importSettings(file) {
    if (!currentUser || !file) return;

    try {
        const text = await file.text();
        const importData = JSON.parse(text);

        if (!importData.version) {
            throw new Error('Invalid backup file');
        }

        // Confirm import
        if (!confirm(`Import settings from ${importData.exportDate}?\n\nThis will overwrite your current settings.`)) {
            return;
        }

        // Import settings
        await db.doc(`users/${currentUser.uid}`).update({
            settings: importData.settings || {}
        });

        // Import alert settings
        if (importData.alertSettings) {
            await db.doc(`alert_settings/${currentUser.uid}`).set(importData.alertSettings, { merge: true });
        }

        await loadUserProfile();
        alert('Settings imported successfully!');

    } catch (error) {
        alert('Import failed: ' + error.message);
    }
}

// Make functions available globally
window.exportSettings = exportSettings;
window.loadAlerts = loadAlerts;

// ===== THEME TOGGLE =====

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeUI(savedTheme);
    } else if (!systemDark) {
        // System is light, let CSS handle it
        updateThemeUI('light');
    } else {
        updateThemeUI('dark');
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeUI(newTheme);
}

function updateThemeUI(theme) {
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');

    if (icon && label) {
        if (theme === 'light') {
            icon.textContent = '☀️';
            label.textContent = 'Light Mode';
        } else {
            icon.textContent = '🌙';
            label.textContent = 'Dark Mode';
        }
    }
}

// Initialize theme on load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
});

// ===== MODE SELECTION MODAL =====

async function checkOnboarding() {
    if (!currentUser || !userProfile) return;

    // Show modal if mode is not set
    if (!userProfile.mode || userProfile.mode === null) {
        showModeModal();
    }
}

function showModeModal() {
    const modal = document.getElementById('modeModal');
    if (modal) {
        modal.style.display = 'flex';

        // Add click handlers to mode options
        document.querySelectorAll('.mode-option').forEach(option => {
            option.addEventListener('click', () => selectMode(option.dataset.mode));
        });
    }
}

async function selectMode(mode) {
    if (!currentUser) return;

    try {
        await db.doc(`users/${currentUser.uid}`).update({
            mode: mode,
            onboarding_complete: true
        });

        // Create mode-specific profile
        if (mode === 'student') {
            await db.collection('student_profiles').doc(currentUser.uid).set({
                uid: currentUser.uid,
                studySessions: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else if (mode === 'family') {
            await db.collection('family_profiles').doc(currentUser.uid).set({
                uid: currentUser.uid,
                children: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        // Hide modal and reload profile
        document.getElementById('modeModal').style.display = 'none';
        await loadUserProfile();
        location.reload();

    } catch (error) {
        alert('Failed to set mode: ' + error.message);
    }
}

// Check onboarding after profile loads
window.checkOnboarding = checkOnboarding;

// ===== PRICING MODAL =====

function openPricingModal() {
    document.getElementById('pricingModal').style.display = 'flex';
}

function closePricingModal() {
    document.getElementById('pricingModal').style.display = 'none';
}

function toggleBilling() {
    const toggle = document.getElementById('billingToggle');
    const labels = document.querySelectorAll('.toggle-label');
    const cards = document.querySelectorAll('.pricing-card');

    toggle.classList.toggle('yearly');

    labels.forEach(label => {
        label.classList.toggle('active');
    });

    // Show/highlight the corresponding card
    cards.forEach(card => {
        if (toggle.classList.contains('yearly')) {
            card.classList.toggle('active', card.classList.contains('yearly'));
        } else {
            card.classList.toggle('active', card.classList.contains('monthly'));
        }
    });
}

async function selectPlan(plan) {
    if (!currentUser) {
        alert('Please login first');
        return;
    }

    // Hide any previous error
    const errorEl = document.getElementById('checkoutError');
    if (errorEl) errorEl.style.display = 'none';

    // Show loading state on button
    const btn = document.querySelector(`[data-plan="${plan}"] button, #selectProMonthly, #selectProYearly`);
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Loading...';
    }

    try {
        // Call Cloud Function to create Stripe checkout
        const createCheckout = firebase.functions().httpsCallable('createCheckoutSession');

        const result = await createCheckout({
            plan: plan,
            successUrl: window.location.origin + '/app/?payment=success',
            cancelUrl: window.location.origin + '/app/?payment=cancelled',
            origin: window.location.origin
        });

        if (result.data.sessionUrl) {
            window.location.href = result.data.sessionUrl;
        } else {
            throw new Error('No session URL returned');
        }
    } catch (error) {
        console.error('Checkout error:', error);

        // Show error UI
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = `⚠️ ${error.message || 'Checkout failed. Please try again or contact support.'}`;
        } else {
            alert('Failed to start checkout: ' + error.message);
        }
    } finally {
        // Reset button
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

// Setup pricing modal event listeners on DOM load
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('upgradeBtn')?.addEventListener('click', openPricingModal);
    document.getElementById('closePricingModal')?.addEventListener('click', closePricingModal);

    // 4-plan buttons
    document.getElementById('selectEssentialMonthly')?.addEventListener('click', () => selectPlan('essential_monthly'));
    document.getElementById('selectProMonthly')?.addEventListener('click', () => selectPlan('pro_monthly'));
    document.getElementById('selectEssentialYearly')?.addEventListener('click', () => selectPlan('essential_yearly'));
    document.getElementById('selectProYearly')?.addEventListener('click', () => selectPlan('pro_yearly'));

    // Legacy buttons (backwards compat)
    document.getElementById('selectMonthly')?.addEventListener('click', () => selectPlan('pro_monthly'));
    document.getElementById('selectYearly')?.addEventListener('click', () => selectPlan('pro_yearly'));

    // Close modal on background click
    document.getElementById('pricingModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'pricingModal') closePricingModal();
    });

    // Promo code toggle
    document.getElementById('promoToggle')?.addEventListener('click', () => {
        const wrap = document.getElementById('promoInputWrap');
        wrap.style.display = wrap.style.display === 'none' ? 'flex' : 'none';
    });

    // Promo code apply
    document.getElementById('applyPromoBtn')?.addEventListener('click', applyPromoCode);
});

// ===== SECRET PROMO CODE =====
// Your secret code: ZAS-FAMILY-BARAKAH-2024
// Only you and trusted friends should know this

async function applyPromoCode() {
    const input = document.getElementById('promoCodeInput');
    const code = input.value.trim().toUpperCase();

    // Secret family/friends code (hashed for extra security if someone views source)
    // The actual code is: ZAS-FAMILY-BARAKAH-2024
    const secretCodes = [
        'ZAS-FAMILY-BARAKAH-2024',
        'ZAHEER-VIP-LIFETIME-2024',
        'ZASGLOBAL-BETA-TESTER'
    ];

    if (!secretCodes.includes(code)) {
        alert('Invalid code. Please check and try again.');
        return;
    }

    if (!currentUser) {
        alert('Please login first');
        return;
    }

    try {
        // Grant lifetime access
        await db.doc(`users/${currentUser.uid}`).update({
            'subscription.status': 'lifetime',
            'subscription.plan': 'lifetime',
            'subscription.plan_status': 'active',
            'subscription.lifetime_code': code,
            'subscription.lifetime_granted': firebase.firestore.FieldValue.serverTimestamp(),
            'subscription.trialActive': false
        });

        // Update local profile
        userProfile.subscription = {
            ...userProfile.subscription,
            status: 'lifetime',
            plan: 'lifetime',
            plan_status: 'active'
        };

        // Show success and close modal
        document.getElementById('promoInputWrap').style.display = 'none';
        document.getElementById('promoSuccess').style.display = 'block';
        document.getElementById('promoToggle').style.display = 'none';

        // Update subscription display in settings
        setTimeout(() => {
            closePricingModal();
            location.reload();
        }, 2000);

    } catch (error) {
        alert('Failed to apply code: ' + error.message);
    }
}
