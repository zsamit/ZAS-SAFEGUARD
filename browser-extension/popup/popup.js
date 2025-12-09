/**
 * ZAS Safeguard - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize popup
    await initPopup();

    // Set up event listeners
    setupEventListeners();
});

async function initPopup() {
    try {
        // Get status from background
        const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });

        // Update UI based on status
        updateStatusUI(status);
        updateDeviceId(status.deviceId);
        updateSyncInfo(status.lastSync);

        if (status.isAuthenticated) {
            showUserSection();
            updateModeUI(status.policy);

            // Check for owner mode unlock status
            if (status.policy?.ultra_strict) {
                showOwnerModeUI();
                await checkUnlockStatus();
            }
        } else {
            showLoginSection();
        }

        // Load stats
        await loadStats();
    } catch (error) {
        console.error('Failed to initialize popup:', error);
    }
}

function setupEventListeners() {
    // Login button
    document.getElementById('loginBtn').addEventListener('click', handleLogin);

    // Sync button
    document.getElementById('syncBtn').addEventListener('click', handleSync);

    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', handleSettings);

    // Unlock button
    document.getElementById('unlockBtn')?.addEventListener('click', handleUnlockRequest);
}

function updateStatusUI(status) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = indicator.querySelector('.status-text');

    if (status.isBlocking) {
        indicator.classList.add('active');
        indicator.classList.remove('inactive');
        statusText.textContent = 'Protection Active';
    } else {
        indicator.classList.add('inactive');
        indicator.classList.remove('active');
        statusText.textContent = 'Protection Disabled';
    }
}

function updateDeviceId(deviceId) {
    const deviceIdEl = document.getElementById('deviceId');
    if (deviceId) {
        deviceIdEl.textContent = deviceId.substring(0, 8) + '...';
        deviceIdEl.title = deviceId;
    }
}

function updateSyncInfo(lastSync) {
    const syncEl = document.getElementById('lastSync');
    if (lastSync) {
        const date = new Date(lastSync);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) {
            syncEl.textContent = 'Just now';
        } else if (diffMins < 60) {
            syncEl.textContent = `${diffMins}m ago`;
        } else {
            syncEl.textContent = date.toLocaleTimeString();
        }
    }
}

function showLoginSection() {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('userSection').style.display = 'none';
}

function showUserSection() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('userSection').style.display = 'block';
}

function updateModeUI(policy) {
    const modeBadge = document.getElementById('modeBadge');
    const modeIcon = modeBadge.querySelector('.mode-icon');
    const modeName = modeBadge.querySelector('.mode-name');

    if (policy?.ultra_strict) {
        modeBadge.classList.add('owner');
        modeIcon.textContent = '🔒';
        modeName.textContent = 'Owner Mode (Ultra-Strict)';
    } else if (policy?.mode === 'family') {
        modeIcon.textContent = '👨‍👩‍👧';
        modeName.textContent = 'Family Mode';
    } else {
        modeIcon.textContent = '🛡️';
        modeName.textContent = 'Basic Protection';
    }
}

function showOwnerModeUI() {
    document.getElementById('unlockSection').style.display = 'block';
}

async function checkUnlockStatus() {
    try {
        const status = await chrome.runtime.sendMessage({ type: 'GET_UNLOCK_STATUS' });

        if (status?.hasActiveRequest) {
            const cooldownTimer = document.getElementById('cooldownTimer');
            const timerValue = document.getElementById('timerValue');
            const antiTemptation = document.getElementById('antiTemptation');
            const temptationMessage = document.getElementById('temptationMessage');
            const unlockBtn = document.getElementById('unlockBtn');

            if (status.status === 'cooling') {
                cooldownTimer.style.display = 'block';
                antiTemptation.style.display = 'block';
                unlockBtn.textContent = 'Cooldown Active...';
                unlockBtn.disabled = true;

                temptationMessage.textContent = status.antiTemptationMessage;

                // Start countdown
                startCountdown(status.remainingSeconds, timerValue);
            } else if (status.status === 'ready') {
                cooldownTimer.style.display = 'none';
                antiTemptation.style.display = 'none';
                unlockBtn.textContent = 'Enter Master Key';
                unlockBtn.disabled = false;
                unlockBtn.onclick = showMasterKeyInput;
            }
        }
    } catch (error) {
        console.error('Failed to check unlock status:', error);
    }
}

function startCountdown(seconds, element) {
    let remaining = seconds;

    const update = () => {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        element.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        if (remaining > 0) {
            remaining--;
            setTimeout(update, 1000);
        } else {
            // Cooldown complete
            checkUnlockStatus();
        }
    };

    update();
}

function showMasterKeyInput() {
    const unlockSection = document.getElementById('unlockSection');
    unlockSection.innerHTML = `
    <div style="margin-bottom: 12px;">
      <label style="display: block; margin-bottom: 8px; font-size: 12px; color: var(--gray);">
        Enter your 60+ character master key:
      </label>
      <textarea 
        id="masterKeyInput" 
        rows="3" 
        style="
          width: 100%;
          padding: 10px;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: white;
          font-size: 12px;
          resize: none;
        "
        placeholder="Enter your master key..."
      ></textarea>
      <div style="font-size: 11px; color: var(--gray); margin-top: 4px;">
        Characters: <span id="charCount">0</span>/60
      </div>
    </div>
    <button class="btn btn-danger" id="submitKeyBtn">Verify & Unlock</button>
    <button class="btn btn-secondary" id="cancelUnlockBtn" style="margin-top: 8px;">Cancel</button>
  `;

    // Set up listeners
    document.getElementById('masterKeyInput').addEventListener('input', (e) => {
        document.getElementById('charCount').textContent = e.target.value.length;
    });

    document.getElementById('submitKeyBtn').addEventListener('click', handleMasterKeySubmit);
    document.getElementById('cancelUnlockBtn').addEventListener('click', () => location.reload());
}

async function handleMasterKeySubmit() {
    const masterKey = document.getElementById('masterKeyInput').value;

    if (masterKey.length < 60) {
        alert('Master key must be at least 60 characters');
        return;
    }

    const btn = document.getElementById('submitKeyBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const result = await chrome.runtime.sendMessage({
            type: 'VERIFY_UNLOCK',
            masterKey
        });

        if (result.success) {
            alert('Unlock successful! Protection temporarily disabled.');
            location.reload();
        } else {
            alert(result.message || 'Invalid master key');
            btn.disabled = false;
            btn.textContent = 'Verify & Unlock';
        }
    } catch (error) {
        alert('Verification failed. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Verify & Unlock';
    }
}

async function loadStats() {
    // Load stats from storage
    const result = await chrome.storage.local.get(['stats']);
    const stats = result.stats || { blockedToday: 0, blockedTotal: 0 };

    document.getElementById('blockedToday').textContent = stats.blockedToday;
    document.getElementById('blockedTotal').textContent = stats.blockedTotal;
}

async function handleLogin() {
    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
        // Open auth page in new tab
        chrome.tabs.create({
            url: 'https://zas-safeguard.web.app/auth?extension=true'
        });
    } catch (error) {
        console.error('Login error:', error);
        btn.disabled = false;
        btn.textContent = 'Sign In with Google';
    }
}

async function handleSync() {
    const btn = document.getElementById('syncBtn');
    btn.disabled = true;
    btn.innerHTML = '🔄 Syncing...';

    try {
        await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
        btn.innerHTML = '✅ Synced!';

        // Refresh last sync time
        const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
        updateSyncInfo(status.lastSync);

        setTimeout(() => {
            btn.innerHTML = '🔄 Sync Now';
            btn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Sync error:', error);
        btn.innerHTML = '❌ Failed';
        setTimeout(() => {
            btn.innerHTML = '🔄 Sync Now';
            btn.disabled = false;
        }, 2000);
    }
}

function handleSettings() {
    chrome.tabs.create({
        url: 'https://zas-safeguard.web.app/dashboard'
    });
}

async function handleUnlockRequest() {
    const btn = document.getElementById('unlockBtn');

    if (!confirm('⚠️ Requesting unlock will:\n\n1. Start a 30-minute cooldown\n2. Block ALL content during cooldown\n3. Log this attempt\n\nAre you sure?')) {
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Requesting...';

    try {
        const result = await chrome.runtime.sendMessage({ type: 'REQUEST_UNLOCK' });

        if (result.success) {
            // Refresh to show cooldown
            location.reload();
        } else if (result.existingRequest) {
            alert('An unlock request is already in progress.');
            location.reload();
        } else {
            alert(result.error || 'Failed to request unlock');
            btn.disabled = false;
            btn.textContent = 'Request Temporary Unlock';
        }
    } catch (error) {
        console.error('Unlock request error:', error);
        btn.disabled = false;
        btn.textContent = 'Request Temporary Unlock';
    }
}
