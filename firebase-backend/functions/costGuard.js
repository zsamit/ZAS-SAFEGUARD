/**
 * ZAS Safeguard - Cost Guardrails Utility
 * 
 * Provides centralized cost control for all Cloud Functions:
 * - Global kill switches for features
 * - Daily usage caps
 * - Write aggregation enforcement
 * - Emergency cost protection
 */

const admin = require('firebase-admin');
const db = admin.firestore();

// ============================================
// CACHE FOR SYSTEM FLAGS (avoid repeated reads)
// ============================================
let systemFlagsCache = null;
let systemFlagsCacheTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute cache

/**
 * Get system flags with caching
 */
async function getSystemFlags() {
    const now = Date.now();
    if (systemFlagsCache && (now - systemFlagsCacheTime) < CACHE_TTL) {
        return systemFlagsCache;
    }

    try {
        const doc = await db.doc('system_flags/global').get();
        if (doc.exists) {
            systemFlagsCache = doc.data();
        } else {
            // Create default flags if not exists
            systemFlagsCache = {
                emailsEnabled: true,
                alertsEnabled: true,
                statsEnabled: true,
                scannerLogsEnabled: true,
                logsEnabled: true,
                emergencyMode: false
            };
            await db.doc('system_flags/global').set(systemFlagsCache);
        }
        systemFlagsCacheTime = now;
        return systemFlagsCache;
    } catch (error) {
        console.error('[CostGuard] Error fetching flags:', error);
        // Default to enabled to not break functionality
        return {
            emailsEnabled: true,
            alertsEnabled: true,
            statsEnabled: true,
            scannerLogsEnabled: true,
            logsEnabled: true,
            emergencyMode: false
        };
    }
}

// ============================================
// DAILY CAPS
// ============================================
const DAILY_CAPS = {
    emails: 3,
    securityEvents: 100,
    scannerLogs: 20,
    statsWrites: 96 // 1 per 15 minutes = 96/day max
};

/**
 * Check if a daily cap has been exceeded
 * @param {string} userId 
 * @param {string} capType - 'emails', 'securityEvents', 'scannerLogs', 'statsWrites'
 * @returns {Promise<boolean>} true if exceeded
 */
async function isCapExceeded(userId, capType) {
    const today = new Date().toISOString().split('T')[0];
    const capDoc = `daily_caps/${userId}_${capType}_${today}`;

    try {
        const doc = await db.doc(capDoc).get();
        if (!doc.exists) return false;

        const count = doc.data().count || 0;
        return count >= DAILY_CAPS[capType];
    } catch (error) {
        console.error(`[CostGuard] Cap check error:`, error);
        return false; // Don't block on error
    }
}

/**
 * Increment a daily cap counter
 */
async function incrementCap(userId, capType) {
    const today = new Date().toISOString().split('T')[0];
    const capDoc = `daily_caps/${userId}_${capType}_${today}`;

    try {
        await db.doc(capDoc).set({
            count: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error(`[CostGuard] Cap increment error:`, error);
    }
}

// ============================================
// STATS AGGREGATION ENFORCEMENT
// ============================================
const STATS_WRITE_INTERVAL = 15 * 60 * 1000; // 15 minutes

/**
 * Check if enough time has passed for a stats write
 */
async function canWriteStats(userId, deviceId) {
    const key = `stats_throttle/${userId}_${deviceId}`;

    try {
        const doc = await db.doc(key).get();
        if (!doc.exists) return true;

        const lastWrite = doc.data().lastWrite?.toMillis() || 0;
        return (Date.now() - lastWrite) >= STATS_WRITE_INTERVAL;
    } catch (error) {
        return true; // Allow on error
    }
}

/**
 * Record a stats write timestamp
 */
async function recordStatsWrite(userId, deviceId) {
    const key = `stats_throttle/${userId}_${deviceId}`;

    try {
        await db.doc(key).set({
            lastWrite: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error(`[CostGuard] Stats throttle error:`, error);
    }
}

// ============================================
// GUARD WRAPPERS
// ============================================

/**
 * Guard for email sending - returns false if should skip
 */
async function shouldSendEmail(userId) {
    const flags = await getSystemFlags();
    if (!flags.emailsEnabled || flags.emergencyMode) {
        console.log('[CostGuard] Emails disabled by kill switch');
        return false;
    }

    if (await isCapExceeded(userId, 'emails')) {
        console.log(`[CostGuard] Email cap exceeded for ${userId}`);
        return false;
    }

    return true;
}

/**
 * Guard for alerts/logs - returns false if should skip
 */
async function shouldWriteAlert(userId) {
    const flags = await getSystemFlags();
    if (!flags.alertsEnabled || flags.emergencyMode) {
        console.log('[CostGuard] Alerts disabled by kill switch');
        return false;
    }
    return true;
}

/**
 * Guard for security events
 */
async function shouldWriteSecurityEvent(userId, deviceId) {
    const flags = await getSystemFlags();
    if (!flags.alertsEnabled || flags.emergencyMode) {
        return false;
    }

    if (await isCapExceeded(`${userId}_${deviceId}`, 'securityEvents')) {
        console.log(`[CostGuard] Security event cap exceeded`);
        return false;
    }

    return true;
}

/**
 * Guard for scanner logs
 */
async function shouldWriteScannerLog(userId) {
    const flags = await getSystemFlags();
    if (!flags.scannerLogsEnabled || flags.emergencyMode) {
        return false;
    }

    if (await isCapExceeded(userId, 'scannerLogs')) {
        console.log(`[CostGuard] Scanner log cap exceeded`);
        return false;
    }

    return true;
}

/**
 * Guard for stats writes
 */
async function shouldWriteStats(userId, deviceId) {
    const flags = await getSystemFlags();
    if (!flags.statsEnabled || flags.emergencyMode) {
        return false;
    }

    return await canWriteStats(userId, deviceId);
}

/**
 * Guard for general logs
 */
async function shouldWriteLog() {
    const flags = await getSystemFlags();
    return flags.logsEnabled && !flags.emergencyMode;
}

// ============================================
// AFTER-WRITE HOOKS
// ============================================

async function afterEmailSent(userId) {
    await incrementCap(userId, 'emails');
}

async function afterSecurityEventWritten(userId, deviceId) {
    await incrementCap(`${userId}_${deviceId}`, 'securityEvents');
}

async function afterScannerLogWritten(userId) {
    await incrementCap(userId, 'scannerLogs');
}

async function afterStatsWritten(userId, deviceId) {
    await recordStatsWrite(userId, deviceId);
    await incrementCap(userId, 'statsWrites');
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
    // Flags
    getSystemFlags,
    DAILY_CAPS,

    // Guards
    shouldSendEmail,
    shouldWriteAlert,
    shouldWriteSecurityEvent,
    shouldWriteScannerLog,
    shouldWriteStats,
    shouldWriteLog,

    // After-write hooks
    afterEmailSent,
    afterSecurityEventWritten,
    afterScannerLogWritten,
    afterStatsWritten,

    // Utilities
    isCapExceeded,
    incrementCap,
    canWriteStats
};
