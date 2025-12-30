/**
 * Extension Communication Hook - Enhanced Version
 * Handles communication between the web dashboard and the ZAS Safeguard browser extension
 */

import { useState, useEffect, useCallback } from 'react';

// Cache for extension ID
let cachedExtensionId = null;

// Listen for extension ID announcements from content script
if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
        if (event.data?.source === 'zas-extension' && event.data?.type === 'EXTENSION_ID_ANNOUNCEMENT') {
            const id = event.data.extensionId;
            console.log('[Extension Hook] Received extension ID announcement:', id);
            cachedExtensionId = id;
            localStorage.setItem('zasExtensionId', id);
        }
    });
}

/**
 * Get stored extension ID or detect it
 */
const getStoredExtensionId = () => {
    // Check URL params first (from extension install redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const urlExtId = urlParams.get('ext');
    if (urlExtId) {
        localStorage.setItem('zasExtensionId', urlExtId);
        cachedExtensionId = urlExtId;
        return urlExtId;
    }

    // Check localStorage
    const storedId = localStorage.getItem('zasExtensionId');
    if (storedId) {
        cachedExtensionId = storedId;
        return storedId;
    }

    // Known extension IDs - try these if nothing stored
    const KNOWN_IDS = [
        'anclbiffkkdjjfgpnmmndjoefejdekkf', // User's unpacked extension
    ];

    // Return first known ID to try (will be validated on use)
    if (KNOWN_IDS.length > 0) {
        cachedExtensionId = KNOWN_IDS[0];
        localStorage.setItem('zasExtensionId', KNOWN_IDS[0]);
        return KNOWN_IDS[0];
    }

    return null;
};

/**
 * Send a message to the extension
 */
export const sendMessageToExtension = async (message) => {
    const extensionId = getStoredExtensionId();

    if (!extensionId) {
        console.log('[Extension] No extension ID found');
        return null;
    }

    if (!window.chrome?.runtime?.sendMessage) {
        console.log('[Extension] Chrome runtime not available');
        return null;
    }

    return new Promise((resolve) => {
        try {
            window.chrome.runtime.sendMessage(extensionId, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.log('[Extension] Communication error:', chrome.runtime.lastError.message);
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        } catch (error) {
            console.log('[Extension] Send error:', error);
            resolve(null);
        }
    });
};

/**
 * Hook to check if extension is installed and connected
 */
export const useExtensionStatus = () => {
    const [isInstalled, setIsInstalled] = useState(false);
    const [extensionId, setExtensionId] = useState(null);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const checkExtension = async () => {
            const id = getStoredExtensionId();

            if (id) {
                // Try to ping the extension
                const response = await sendMessageToExtension({ type: 'PING' });
                if (response?.status === 'alive') {
                    setExtensionId(id);
                    setIsInstalled(true);
                    console.log('[Extension] Connected, version:', response.version);
                } else {
                    // Extension ID stored but not responding
                    setIsInstalled(false);
                }
            }

            setChecking(false);
        };

        checkExtension();
    }, []);

    return { isInstalled, extensionId, checking };
};

/**
 * Hook to control Focus Mode via extension + localStorage persistence
 */
export const useFocusMode = () => {
    const [isActive, setIsActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [endTime, setEndTime] = useState(null);

    // Load initial state from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('focusModeActive');
        const savedEndTime = localStorage.getItem('focusModeEndTime');

        if (saved === 'true' && savedEndTime) {
            const end = new Date(savedEndTime);
            if (end > new Date()) {
                setIsActive(true);
                setEndTime(savedEndTime);
            } else {
                // Session expired, clear it
                localStorage.removeItem('focusModeActive');
                localStorage.removeItem('focusModeEndTime');
            }
        }
    }, []);

    // Start focus mode with a specific duration in minutes
    const startFocusWithDuration = useCallback(async (durationMinutes) => {
        setLoading(true);

        const startTime = new Date();
        const endTimeDate = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

        // Update local state
        setIsActive(true);
        setEndTime(endTimeDate.toISOString());
        localStorage.setItem('focusModeActive', 'true');
        localStorage.setItem('focusModeEndTime', endTimeDate.toISOString());

        // Send to extension
        const response = await sendMessageToExtension({
            type: 'STUDY_MODE_START',
            session: {
                blockCategories: ['social_media', 'gaming', 'youtube', 'reddit'],
                startTime: startTime.toISOString(),
                endTime: endTimeDate.toISOString(),
                duration: durationMinutes
            }
        });

        if (response?.success) {
            console.log('[FocusMode] Started for', durationMinutes, 'minutes');
        } else {
            console.log('[FocusMode] Extension not responding, local state only');
        }

        setLoading(false);
        return true;
    }, []);

    // Toggle (for stopping)
    const toggleFocusMode = useCallback(async () => {
        setLoading(true);

        if (isActive) {
            // Stop focus mode
            setIsActive(false);
            setEndTime(null);
            localStorage.removeItem('focusModeActive');
            localStorage.removeItem('focusModeEndTime');

            const response = await sendMessageToExtension({
                type: 'STUDY_MODE_STOP'
            });

            if (response?.success) {
                console.log('[FocusMode] Stopped');
            }
        }

        setLoading(false);
        return !isActive;
    }, [isActive]);

    // Sync on mount if active
    useEffect(() => {
        if (isActive && endTime) {
            sendMessageToExtension({
                type: 'STUDY_MODE_START',
                session: {
                    blockCategories: ['social_media', 'gaming', 'youtube', 'reddit'],
                    startTime: new Date().toISOString(),
                    endTime: endTime,
                    duration: Math.floor((new Date(endTime) - new Date()) / (1000 * 60))
                }
            });
        }
    }, []);

    // Check for expiry
    useEffect(() => {
        if (!isActive || !endTime) return;

        const checkExpiry = () => {
            const end = new Date(endTime);
            if (new Date() >= end) {
                // Auto-stop when time is up
                setIsActive(false);
                setEndTime(null);
                localStorage.removeItem('focusModeActive');
                localStorage.removeItem('focusModeEndTime');
                sendMessageToExtension({ type: 'STUDY_MODE_STOP' });
                console.log('[FocusMode] Session expired, auto-stopped');
            }
        };

        const interval = setInterval(checkExpiry, 30000); // Check every 30 seconds
        return () => clearInterval(interval);
    }, [isActive, endTime]);

    return { isActive, toggleFocusMode, loading, endTime, startFocusWithDuration };
};

/**
 * Hook to control Internet Lock via extension + localStorage persistence
 */
export const useInternetLock = () => {
    const [isLocked, setIsLocked] = useState(false);
    const [loading, setLoading] = useState(false);

    // Load initial state from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('internetLockActive');
        if (saved === 'true') {
            setIsLocked(true);
        }
    }, []);

    const toggleInternetLock = useCallback(async () => {
        setLoading(true);
        const newState = !isLocked;

        // Update local state
        setIsLocked(newState);
        localStorage.setItem('internetLockActive', newState.toString());

        // Send to extension
        const response = await sendMessageToExtension({
            type: 'CHILD_LOCK',
            locked: newState
        });

        if (response?.success) {
            console.log('[InternetLock] Extension updated');
        } else {
            console.log('[InternetLock] Extension not responding');
        }

        setLoading(false);
        return newState;
    }, [isLocked]);

    // Sync on mount
    useEffect(() => {
        if (isLocked) {
            sendMessageToExtension({ type: 'CHILD_LOCK', locked: true });
        }
    }, []);

    return { isLocked, toggleInternetLock, loading };
};

/**
 * Hook to get ad blocker stats from extension
 */
export const useAdBlockStats = () => {
    const [stats, setStats] = useState({
        adsBlocked: 0,
        trackersBlocked: 0,
        weeklyBlocked: 0,
        loading: true
    });

    useEffect(() => {
        const fetchStats = async () => {
            const response = await sendMessageToExtension({ type: 'ADBLOCK_GET_STATS' });

            if (response?.stats) {
                setStats({
                    ...response.stats,
                    loading: false
                });
            } else {
                setStats(prev => ({ ...prev, loading: false }));
            }
        };

        fetchStats();

        // Refresh every 30 seconds
        const interval = setInterval(fetchStats, 30000);
        return () => clearInterval(interval);
    }, []);

    return stats;
};

/**
 * Prompt user to enter extension ID manually
 */
export const promptForExtensionId = () => {
    const id = prompt(
        'Enter your ZAS Safeguard Extension ID.\n\n' +
        'To find it:\n' +
        '1. Go to chrome://extensions\n' +
        '2. Find "ZAS Safeguard"\n' +
        '3. Copy the ID (looks like: abcdefghij...)'
    );

    if (id && id.length > 10) {
        localStorage.setItem('zasExtensionId', id);
        cachedExtensionId = id;
        window.location.reload();
        return true;
    }
    return false;
};

/**
 * Clear stored extension ID
 */
export const clearExtensionId = () => {
    localStorage.removeItem('zasExtensionId');
    cachedExtensionId = null;
};
