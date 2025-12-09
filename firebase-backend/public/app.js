/**
 * ZAS Safeguard - Web Dashboard Application
 */

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
    const mode = document.getElementById('registerMode').value;

    if (password.length < 8) {
        alert('Password must be at least 8 characters');
        return;
    }

    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);

        // Update display name
        await userCredential.user.updateProfile({ displayName: name });

        // Create user profile in Firestore
        await createUserProfile(userCredential.user, { name, mode });

    } catch (error) {
        alert('Registration failed: ' + error.message);
    }
}

async function handleGoogleSignIn() {
    const provider = new firebase.auth.GoogleAuthProvider();

    try {
        const result = await auth.signInWithPopup(provider);

        // Check if new user
        if (result.additionalUserInfo?.isNewUser) {
            await createUserProfile(result.user, {
                name: result.user.displayName,
                mode: 'owner'
            });
        }
    } catch (error) {
        alert('Google sign in failed: ' + error.message);
    }
}

async function handleLogout() {
    try {
        await auth.signOut();
    } catch (error) {
        alert('Logout failed: ' + error.message);
    }
}

// User Profile
async function createUserProfile(user, data) {
    const profile = {
        email: user.email,
        displayName: data.name || user.displayName || 'User',
        mode: data.mode || 'owner',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        subscription: {
            status: 'trial',
            trialStarted: firebase.firestore.FieldValue.serverTimestamp(),
            plan: 'free'
        },
        settings: {
            categories: {
                porn: { enabled: true, locked: true },
                gambling: { enabled: true, locked: false },
                social_media: { enabled: false, locked: false },
                gaming: { enabled: false, locked: false }
            },
            customBlocklist: [],
            customAllowlist: []
        }
    };

    await db.collection('users').doc(user.uid).set(profile);

    // Create owner or family profile
    if (data.mode === 'owner') {
        await db.collection('owner_profiles').doc(user.uid).set({
            uid: user.uid,
            ultraStrict: true,
            masterKeyHash: null,
            unlockCount: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } else {
        await db.collection('family_profiles').doc(user.uid).set({
            uid: user.uid,
            children: [],
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
        case 'activity':
            loadActivityLog();
            break;
        case 'children':
            loadChildren();
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

    // Show/hide children nav based on mode
    if (userProfile?.mode === 'family') {
        document.getElementById('childrenNav').style.display = 'block';
        document.getElementById('modeBanner').classList.add('family');
        document.getElementById('modeTitle').textContent = 'Family Mode';
        document.getElementById('modeDescription').textContent =
            'Parental controls active. Manage your children\'s online safety.';
        document.querySelector('.mode-icon').textContent = '👨‍👩‍👧';
    }

    // Load initial data
    loadOverviewData();
}

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
                    <button class="btn btn-secondary" onclick="editChild('${doc.id}')">Edit</button>
                </div>
            `;
        });

        childrenList.innerHTML = html;

    } catch (error) {
        console.error('Error loading children:', error);
    }
}

function loadSettings() {
    if (!currentUser || !userProfile) return;

    document.getElementById('settingsEmail').value = currentUser.email || '';
    document.getElementById('settingsName').value = currentUser.displayName || '';
    document.getElementById('currentPlan').textContent =
        (userProfile.subscription?.plan || 'Free').charAt(0).toUpperCase() +
        (userProfile.subscription?.plan || 'free').slice(1);

    // Show owner settings only for owner mode
    const ownerSettings = document.getElementById('ownerSettings');
    if (userProfile.mode === 'owner') {
        ownerSettings.style.display = 'block';
    } else {
        ownerSettings.style.display = 'none';
    }
}

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
