/**
 * ZAS Safeguard - Heartbeat Monitoring (Production-Grade, Zero Spam)
 * 
 * RULES:
 * - Heartbeat missing ≠ extension disabled
 * - Browser closed / device asleep ≠ tamper
 * - Only real tamper events trigger instant emails
 * - Offline events NEVER spam emails
 * - Emails must be capped, deduped, timezone-aware
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const db = getFirestore();

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Cooldowns (in milliseconds)
    OFFLINE_COOLDOWN_MS: 6 * 60 * 60 * 1000,  // 6 hours per device
    TAMPER_COOLDOWN_MS: 30 * 60 * 1000,        // 30 minutes

    // Limits
    MAX_EMAILS_PER_DAY: 3,

    // Thresholds
    OFFLINE_THRESHOLD_MINUTES: 15,  // Device considered offline after 15 min no heartbeat

    // Default quiet hours (user's local time)
    DEFAULT_QUIET_START: 22, // 10 PM
    DEFAULT_QUIET_END: 7,    // 7 AM
};

// Event classifications
const TAMPER_EVENTS = [
    'EXTENSION_DISABLED',
    'DISABLE_ATTEMPT',
    'EXTENSION_UNINSTALLED',
    'DEVTOOLS_OPENED',
    'POLICY_TAMPER',
    'TOKEN_TAMPER',
    'MANIFEST_MODIFIED',
    'DNR_RULE_REMOVED'
];

const OFFLINE_EVENTS = [
    'HEARTBEAT_MISSING',
    'HEARTBEAT_MISSED',
    'DEVICE_OFFLINE',
    'BROWSER_CLOSED',
    'DEVICE_SLEEP',
    'VISIBILITY_HIDDEN'
];

// ============================================
// REGISTER DEVICE (Creates device in Firestore)
// ============================================

/**
 * Called by extension when user logs in
 * Creates or updates device document with userId for dashboard display
 * Also cleans up duplicate devices (same browser+deviceType for same user)
 */
exports.registerDevice = onRequest({ cors: true }, async (req, res) => {
    try {
        const data = req.body.data || req.body;
        const { deviceId, userId, deviceName, deviceType, browser, timezone } = data;

        if (!deviceId || !userId) {
            return res.status(400).json({ error: 'deviceId and userId required' });
        }

        console.log(`[RegisterDevice] Registering ${deviceId} for user ${userId}`);

        // Clean up duplicate devices: same user + same browser + same deviceType
        // This handles extension reinstalls which generate new deviceIds
        if (browser && deviceType) {
            const duplicatesQuery = await db.collection('devices')
                .where('userId', '==', userId)
                .where('browser', '==', browser)
                .where('type', '==', deviceType)
                .get();

            const batch = db.batch();
            let deletedCount = 0;

            duplicatesQuery.forEach(doc => {
                // Delete old devices with same browser+type (but different deviceId)
                if (doc.id !== deviceId) {
                    batch.delete(doc.ref);
                    deletedCount++;
                    console.log(`[RegisterDevice] Deleting duplicate device ${doc.id}`);
                }
            });

            if (deletedCount > 0) {
                await batch.commit();
                console.log(`[RegisterDevice] Cleaned up ${deletedCount} duplicate device(s)`);
            }
        }

        const deviceRef = db.doc(`devices/${deviceId}`);
        const deviceDoc = await deviceRef.get();

        const deviceData = {
            userId,
            deviceId,
            name: deviceName || `${browser || 'Browser'} on ${deviceType || 'Device'}`,
            type: deviceType || 'unknown',
            browser: browser || 'unknown',
            status: 'online',
            lastSeen: FieldValue.serverTimestamp(),
            timezone: timezone || 'America/Los_Angeles',
            updatedAt: FieldValue.serverTimestamp()
        };

        if (deviceDoc.exists) {
            // Update existing device
            await deviceRef.update(deviceData);
            console.log(`[RegisterDevice] Updated existing device ${deviceId}`);
        } else {
            // Create new device
            deviceData.createdAt = FieldValue.serverTimestamp();
            deviceData.protectionPaused = false;
            deviceData.internetLocked = false;
            await deviceRef.set(deviceData);
            console.log(`[RegisterDevice] Created new device ${deviceId}`);
        }

        return res.json({ success: true, deviceId });
    } catch (error) {
        console.error('[RegisterDevice] Error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================
// UPDATE DEVICE STATUS (Graceful Offline Signal)
// ============================================

/**
 * Called by extension when browser closes gracefully
 * This prevents email spam for normal offline events
 */
exports.updateDeviceStatus = onRequest({ cors: true }, async (req, res) => {
    try {
        const data = req.body.data || req.body;
        const { deviceId, status, offlineReason, hint, timestamp, timezone } = data;

        if (!deviceId) {
            return res.status(400).json({ error: 'deviceId required' });
        }

        console.log(`[DeviceStatus] ${deviceId} -> ${status} (${offlineReason}: ${hint})`);

        // Update device document
        const deviceRef = db.doc(`devices/${deviceId}`);
        const deviceDoc = await deviceRef.get();

        if (!deviceDoc.exists) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const updateData = {
            status: status || 'offline',
            lastStatusUpdate: FieldValue.serverTimestamp()
        };

        // If graceful offline, mark it to prevent email spam
        if (offlineReason === 'graceful') {
            updateData.offlineReason = 'graceful';
            updateData.offlineHint = hint;
            updateData.offlineAt = FieldValue.serverTimestamp();
            updateData.gracefulOfflineAt = FieldValue.serverTimestamp();
        }

        if (timezone) {
            updateData.timezone = timezone;
        }

        await deviceRef.update(updateData);

        return res.json({ success: true });
    } catch (error) {
        console.error('[DeviceStatus] Error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================
// HEARTBEAT CHECK (Fixed - No Email Spam)
// ============================================

/**
 * Runs every 5 minutes to check for offline devices
 * 
 * CRITICAL RULES:
 * - NEVER send "extension disabled" emails for heartbeat missing
 * - NEVER assume tamper for offline
 * - Respect graceful offline signals
 * - Respect quiet hours
 * - Enforce cooldowns and daily caps
 * 
 * Named V2 to avoid Firebase upgrade conflict with old 1st gen function
 */
exports.checkHeartbeatsV2 = onSchedule('every 5 minutes', async (event) => {
    console.log('[Heartbeat] Starting check (spam-safe V2)...');

    try {
        const now = Date.now();
        const offlineThreshold = CONFIG.OFFLINE_THRESHOLD_MINUTES * 60 * 1000;
        const staleTime = new Date(now - offlineThreshold);

        // Get all devices
        const devicesSnapshot = await db.collection('devices').get();

        if (devicesSnapshot.empty) {
            console.log('[Heartbeat] No devices found');
            return null;
        }

        let devicesChecked = 0;
        let devicesUpdated = 0;

        for (const deviceDoc of devicesSnapshot.docs) {
            const device = deviceDoc.data();
            const deviceId = deviceDoc.id;
            const userId = device.userId;

            if (!userId) continue;
            devicesChecked++;

            const lastSeen = device.lastSeen?.toMillis ? device.lastSeen.toMillis() : (device.lastSeen || 0);
            const timeSinceLastSeen = now - lastSeen;

            // Check if device is offline (no heartbeat for threshold minutes)
            if (timeSinceLastSeen > offlineThreshold) {

                // CRITICAL: Check for graceful offline signal
                const gracefulOfflineAt = device.gracefulOfflineAt?.toMillis?.() || 0;
                const isGracefulOffline = device.offlineReason === 'graceful' &&
                    (now - gracefulOfflineAt) < (24 * 60 * 60 * 1000); // Within 24h

                if (isGracefulOffline) {
                    // Graceful offline - just update status, NO EMAIL
                    if (device.status !== 'offline') {
                        await deviceDoc.ref.update({
                            status: 'offline',
                            lastStatusUpdate: FieldValue.serverTimestamp()
                        });
                        devicesUpdated++;
                    }
                    console.log(`[Heartbeat] ${deviceId} graceful offline - no email`);
                    continue;
                }

                // Not graceful - Check if we should send offline alert
                const shouldAlert = await shouldSendOfflineAlert(userId, deviceId, device);

                if (shouldAlert.send) {
                    // Queue for digest (not instant email)
                    await queueOfflineForDigest(userId, deviceId, device, timeSinceLastSeen);
                } else {
                    console.log(`[Heartbeat] ${deviceId} alert suppressed: ${shouldAlert.reason}`);
                }

                // Update device status
                if (device.status !== 'offline') {
                    await deviceDoc.ref.update({
                        status: 'offline',
                        offlineDetectedAt: FieldValue.serverTimestamp()
                    });
                    devicesUpdated++;
                }
            }
            // Device is online
            else if (device.status !== 'online') {
                await deviceDoc.ref.update({
                    status: 'online',
                    offlineReason: FieldValue.delete(),
                    offlineHint: FieldValue.delete()
                });
                devicesUpdated++;
            }
        }

        console.log(`[Heartbeat] Checked ${devicesChecked} devices, updated ${devicesUpdated}`);
        return null;

    } catch (error) {
        console.error('[Heartbeat] Error:', error);
        return null;
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if we should send an offline alert
 * Returns { send: boolean, reason: string }
 */
async function shouldSendOfflineAlert(userId, deviceId, device) {
    try {
        // Get user alert settings
        const userDoc = await db.doc(`users/${userId}`).get();
        const user = userDoc.data() || {};
        const alertSettings = user.alertSettings || {};

        // 1. Check if offline alerts are enabled
        const offlineAlertMode = alertSettings.offlineAlertMode || 'digest';
        if (offlineAlertMode === 'none') {
            return { send: false, reason: 'offline_alerts_disabled' };
        }

        // 2. Check quiet hours (using device timezone)
        const timezone = device.timezone || user.timezone || 'America/Los_Angeles';
        if (isInQuietHours(timezone, alertSettings)) {
            return { send: false, reason: 'quiet_hours' };
        }

        // 3. Check cooldown (6 hours for offline)
        const cooldownKey = `alert_cooldown/${userId}_${deviceId}_offline`;
        const cooldownDoc = await db.doc(cooldownKey).get();

        if (cooldownDoc.exists) {
            const lastAlert = cooldownDoc.data().timestamp?.toMillis?.() || 0;
            if (Date.now() - lastAlert < CONFIG.OFFLINE_COOLDOWN_MS) {
                return { send: false, reason: 'cooldown_active' };
            }
        }

        // 4. Check daily email cap
        const dailyCapReached = await checkDailyEmailCap(userId);
        if (dailyCapReached) {
            return { send: false, reason: 'daily_cap_reached' };
        }

        return { send: true, reason: 'allowed' };

    } catch (error) {
        console.error('[shouldSendOfflineAlert] Error:', error);
        return { send: false, reason: 'error' };
    }
}

/**
 * Check if current time is within user's quiet hours
 */
function isInQuietHours(timezone, alertSettings) {
    try {
        // Get quiet hours settings (defaults: 10 PM - 7 AM)
        const quietEnabled = alertSettings.quietHoursEnabled !== false; // Default ON
        if (!quietEnabled) return false;

        const quietStart = alertSettings.quietHoursStart ?? CONFIG.DEFAULT_QUIET_START;
        const quietEnd = alertSettings.quietHoursEnd ?? CONFIG.DEFAULT_QUIET_END;

        // Get current hour in user's timezone
        const now = new Date();
        const options = { timeZone: timezone, hour: 'numeric', hour12: false };
        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now));

        // Handle overnight quiet hours (e.g., 22-7)
        if (quietStart > quietEnd) {
            // Quiet hours span midnight
            return currentHour >= quietStart || currentHour < quietEnd;
        } else {
            // Normal range (e.g., 1-5)
            return currentHour >= quietStart && currentHour < quietEnd;
        }
    } catch (error) {
        console.warn('[isInQuietHours] Error:', error);
        return false;
    }
}

/**
 * Check if user has exceeded daily email cap
 */
async function checkDailyEmailCap(userId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const capDoc = await db.doc(`email_caps/${userId}_${today}`).get();

        if (!capDoc.exists) return false;

        const count = capDoc.data().count || 0;
        return count >= CONFIG.MAX_EMAILS_PER_DAY;
    } catch (error) {
        return false;
    }
}

/**
 * Increment daily email counter
 */
async function incrementDailyEmailCount(userId) {
    const today = new Date().toISOString().split('T')[0];
    const capRef = db.doc(`email_caps/${userId}_${today}`);

    await capRef.set({
        count: FieldValue.increment(1),
        lastUpdated: FieldValue.serverTimestamp()
    }, { merge: true });
}

/**
 * Set cooldown for alert type
 */
async function setAlertCooldown(userId, deviceId, eventType) {
    const cooldownRef = db.doc(`alert_cooldown/${userId}_${deviceId}_${eventType}`);
    await cooldownRef.set({
        timestamp: FieldValue.serverTimestamp()
    });
}

/**
 * Queue offline event for digest (not instant email)
 * DEDUPLICATION: Only ONE entry per device per calendar day
 */
async function queueOfflineForDigest(userId, deviceId, device, offlineDuration) {
    try {
        const today = new Date().toISOString().split('T')[0];

        // DEDUPE: Check if already queued for this device today
        const dedupeId = `${userId}_${deviceId}_${today}`;
        const existingDoc = await db.doc(`digest_queue/${dedupeId}`).get();

        if (existingDoc.exists) {
            console.log(`[Heartbeat] Digest already queued for ${deviceId} today, skipping`);
            return; // Already queued today - DO NOT ADD ANOTHER
        }

        // Use dedupeId as document ID to enforce uniqueness
        await db.doc(`digest_queue/${dedupeId}`).set({
            userId,
            deviceId,
            deviceName: device.deviceName || 'Unknown Device',
            eventType: 'DEVICE_OFFLINE',
            offlineDuration: Math.floor(offlineDuration / 60000), // minutes
            queuedAt: FieldValue.serverTimestamp(),
            digestDate: today,
            processed: false
        });

        console.log(`[Heartbeat] Queued offline digest for ${deviceId} (first today)`);

    } catch (error) {
        console.error('[queueOfflineForDigest] Error:', error);
    }
}

// ============================================
// SEND DAILY DIGEST (Scheduled - once per day)
// ============================================

exports.sendOfflineDigest = onSchedule('0 9 * * *', async (event) => {
    // Runs at 9 AM server time daily
    console.log('[Digest] Starting daily offline digest...');

    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const digestDate = yesterday.toISOString().split('T')[0];

        // Get all unprocessed digest items from yesterday
        const queueSnapshot = await db.collection('digest_queue')
            .where('digestDate', '==', digestDate)
            .where('processed', '==', false)
            .get();

        if (queueSnapshot.empty) {
            console.log('[Digest] No items to digest');
            return null;
        }

        // Group by userId
        const userDigests = {};
        queueSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!userDigests[data.userId]) {
                userDigests[data.userId] = [];
            }
            userDigests[data.userId].push({ ...data, docId: doc.id });
        });

        // Send one digest email per user
        for (const [userId, items] of Object.entries(userDigests)) {
            await sendDigestEmail(userId, items);

            // Mark as processed
            const batch = db.batch();
            items.forEach(item => {
                batch.update(db.doc(`digest_queue/${item.docId}`), { processed: true });
            });
            await batch.commit();
        }

        console.log(`[Digest] Sent digests to ${Object.keys(userDigests).length} users`);
        return null;

    } catch (error) {
        console.error('[Digest] Error:', error);
        return null;
    }
});

/**
 * Send digest email to user
 */
async function sendDigestEmail(userId, items) {
    try {
        // Check daily cap
        if (await checkDailyEmailCap(userId)) {
            console.log(`[Digest] Daily cap reached for ${userId}, skipping`);
            return;
        }

        // Get user email
        const userDoc = await db.doc(`users/${userId}`).get();
        const user = userDoc.data();

        if (!user?.email) {
            console.log(`[Digest] No email for ${userId}`);
            return;
        }

        // Build digest content
        const deviceSummary = items.map(item =>
            `• ${item.deviceName}: offline for ${item.offlineDuration} minutes`
        ).join('\n');

        // Send email
        await db.collection('mail').add({
            to: user.email,
            message: {
                subject: `ZAS Safeguard - Daily Device Summary`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #6366f1;">📊 Daily Device Summary</h2>
                        <p>Here's a summary of device activity from the past 24 hours:</p>
                        
                        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
                            <h3 style="margin-top: 0;">Devices that went offline:</h3>
                            <pre style="font-family: Arial; white-space: pre-wrap;">${deviceSummary}</pre>
                        </div>
                        
                        <p style="color: #6b7280; font-size: 12px;">
                            This is a daily digest. Offline events do not indicate tampering - 
                            devices go offline when browsers are closed or devices sleep.
                        </p>
                        
                        <p><a href="https://zassafeguard.com/app/?view=devices" 
                              style="background: #6366f1; color: white; padding: 12px 24px; 
                                     border-radius: 8px; text-decoration: none; display: inline-block;">
                            View Devices
                        </a></p>
                    </div>
                `
            }
        });

        await incrementDailyEmailCount(userId);
        console.log(`[Digest] Sent digest to ${user.email}`);

    } catch (error) {
        console.error('[sendDigestEmail] Error:', error);
    }
}
