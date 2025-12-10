/**
 * ZAS Safeguard - Parent Alert System
 * 
 * Handles:
 * - Security event processing
 * - Parent email alerts
 * - Heartbeat monitoring
 * - Alert rules evaluation
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const db = getFirestore();

// Alert thresholds (configurable per user via alert_settings)
const DEFAULT_THRESHOLDS = {
    blockedAttemptsPerMinute: 2,
    heartbeatMissingMinutes: 10,
    maxAlertsPerHour: 10
};

// ============================================
// SECURITY EVENT TRIGGER
// ============================================

/**
 * Triggered when a new security event is created
 * Evaluates alert rules and sends notifications
 */
exports.onSecurityEvent = onDocumentCreated(
    'security_events/{userId}/{deviceId}/{eventId}',
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const eventData = snap.data();
        const { userId, deviceId } = event.params;

        console.log(`Security event: ${eventData.type} for user ${userId}, device ${deviceId}`);

        try {
            // Get user's alert settings
            const settingsDoc = await db.doc(`alert_settings/${userId}`).get();
            const settings = settingsDoc.exists ? settingsDoc.data() : { enabled: true };

            if (!settings.enabled) {
                console.log('Alerts disabled for user');
                return;
            }

            // Evaluate alert rules based on event type
            switch (eventData.type) {
                case 'extension_disabled':
                    // RULE 3: Instant alert on extension disable
                    await sendAlert(userId, deviceId, {
                        type: 'extension_disabled',
                        severity: 'high',
                        title: '⚠️ Extension Disabled',
                        message: `The ZAS Safeguard extension was disabled on ${eventData.deviceName || 'a device'}.`,
                        timestamp: eventData.timestamp
                    });
                    break;

                case 'blocked_attempt':
                    // RULE 1: Check for 2+ blocks in 1 minute
                    await checkBlockedAttemptThreshold(userId, deviceId, eventData);
                    break;

                case 'tamper_attempt':
                    await sendAlert(userId, deviceId, {
                        type: 'tamper_attempt',
                        severity: 'high',
                        title: '🚨 Tamper Attempt Detected',
                        message: `Someone tried to tamper with the extension on ${eventData.deviceName || 'a device'}.`,
                        timestamp: eventData.timestamp
                    });
                    break;

                case 'heartbeat_missing':
                    await sendAlert(userId, deviceId, {
                        type: 'heartbeat_missing',
                        severity: 'medium',
                        title: '📵 Device Offline',
                        message: `Device ${eventData.deviceName || 'Unknown'} hasn't reported in for ${eventData.minutesMissing || 10}+ minutes. The extension may be disabled or uninstalled.`,
                        timestamp: eventData.timestamp
                    });
                    break;
            }
        } catch (error) {
            console.error('Error processing security event:', error);
        }
    }
);

// ============================================
// HEARTBEAT CHECKER (Scheduled)
// ============================================

/**
 * Runs every 5 minutes to check for stale heartbeats
 * RULE 2: Alert if heartbeat missing > 10 minutes
 */
exports.checkHeartbeats = onSchedule('every 5 minutes', async (event) => {
    console.log('Running heartbeat check...');

    const now = Date.now();
    const threshold = 10 * 60 * 1000; // 10 minutes
    const staleTime = new Date(now - threshold);

    try {
        // Get all devices with stale heartbeats
        const devicesQuery = await db.collection('devices')
            .where('lastHeartbeat', '<', Timestamp.fromDate(staleTime))
            .where('isActive', '==', true)
            .get();

        console.log(`Found ${devicesQuery.size} devices with stale heartbeats`);

        for (const deviceDoc of devicesQuery.docs) {
            const device = deviceDoc.data();
            const deviceId = deviceDoc.id;
            const userId = device.userId;

            // Check if we already sent an alert recently
            const recentAlerts = await db.collection(`alerts/${userId}`)
                .where('type', '==', 'heartbeat_missing')
                .where('deviceId', '==', deviceId)
                .where('timestamp', '>', Timestamp.fromDate(new Date(now - 30 * 60 * 1000))) // Last 30 min
                .limit(1)
                .get();

            if (!recentAlerts.empty) {
                console.log(`Already alerted for device ${deviceId}, skipping`);
                continue;
            }

            // Calculate how long heartbeat has been missing
            const lastHeartbeat = device.lastHeartbeat?.toDate() || new Date(0);
            const minutesMissing = Math.floor((now - lastHeartbeat.getTime()) / 60000);

            // Create security event (which will trigger alert)
            await db.collection(`security_events/${userId}/${deviceId}`).add({
                type: 'heartbeat_missing',
                deviceName: device.name || 'Unknown Device',
                minutesMissing,
                timestamp: FieldValue.serverTimestamp()
            });

            // Mark device as inactive
            await deviceDoc.ref.update({ isActive: false });
        }

    } catch (error) {
        console.error('Heartbeat check error:', error);
    }
});

// ============================================
// BLOCKED ATTEMPT THRESHOLD CHECK
// ============================================

async function checkBlockedAttemptThreshold(userId, deviceId, eventData) {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60 * 1000);

    try {
        // Get user's threshold setting
        const settingsDoc = await db.doc(`alert_settings/${userId}`).get();
        const threshold = settingsDoc.data()?.blockedAttemptsPerMinute || DEFAULT_THRESHOLDS.blockedAttemptsPerMinute;

        // Count blocked attempts in last minute
        const recentBlocks = await db.collection(`security_events/${userId}/${deviceId}`)
            .where('type', '==', 'blocked_attempt')
            .where('timestamp', '>', Timestamp.fromDate(oneMinuteAgo))
            .get();

        if (recentBlocks.size >= threshold) {
            // Check if we already sent an alert recently (debounce)
            const recentAlerts = await db.collection(`alerts/${userId}`)
                .where('type', '==', 'blocked_attempts_threshold')
                .where('timestamp', '>', Timestamp.fromDate(new Date(now - 5 * 60 * 1000))) // Last 5 min
                .limit(1)
                .get();

            if (recentAlerts.empty) {
                await sendAlert(userId, deviceId, {
                    type: 'blocked_attempts_threshold',
                    severity: 'medium',
                    title: '🚫 Multiple Blocked Attempts',
                    message: `${recentBlocks.size} attempts to access blocked content in the last minute on ${eventData.deviceName || 'a device'}.`,
                    timestamp: eventData.timestamp,
                    blockedCount: recentBlocks.size
                });
            }
        }
    } catch (error) {
        console.error('Error checking blocked attempt threshold:', error);
    }
}

// ============================================
// SEND ALERT FUNCTION
// ============================================

async function sendAlert(userId, deviceId, alertData) {
    try {
        // Get user data for email
        const userDoc = await db.doc(`users/${userId}`).get();
        const user = userDoc.data();

        if (!user?.email) {
            console.log('No email for user, skipping alert');
            return;
        }

        // Check rate limit (max alerts per hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentAlerts = await db.collection(`alerts/${userId}`)
            .where('timestamp', '>', Timestamp.fromDate(oneHourAgo))
            .get();

        if (recentAlerts.size >= DEFAULT_THRESHOLDS.maxAlertsPerHour) {
            console.log('Alert rate limit reached, skipping');
            return;
        }

        // Save alert to Firestore
        const alertRef = await db.collection(`alerts/${userId}`).add({
            ...alertData,
            deviceId,
            read: false,
            emailSent: false,
            timestamp: FieldValue.serverTimestamp()
        });

        // Queue email via Firebase Email Extension
        // The extension watches the 'mail' collection
        await db.collection('mail').add({
            to: user.email,
            template: {
                name: 'security_alert',
                data: {
                    userName: user.displayName || 'Parent',
                    alertTitle: alertData.title,
                    alertMessage: alertData.message,
                    severity: alertData.severity,
                    deviceName: alertData.deviceName || 'Unknown Device',
                    timestamp: new Date().toLocaleString(),
                    dashboardLink: 'https://zasgloballlc.com/safeguard'
                }
            }
        });

        // Mark email as sent
        await alertRef.update({ emailSent: true });

        console.log(`Alert sent to ${user.email}: ${alertData.title}`);

    } catch (error) {
        console.error('Error sending alert:', error);
    }
}

// ============================================
// LOG SECURITY EVENT (Called by extension)
// ============================================

exports.logSecurityEvent = onCall(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;
    const { deviceId, type, metadata = {} } = request.data;

    if (!deviceId || !type) {
        throw new Error('deviceId and type are required');
    }

    try {
        // Log the security event
        const eventRef = await db.collection(`security_events/${userId}/${deviceId}`).add({
            type,
            ...metadata,
            timestamp: FieldValue.serverTimestamp()
        });

        return { success: true, eventId: eventRef.id };

    } catch (error) {
        console.error('Error logging security event:', error);
        throw error;
    }
});

// ============================================
// GET ALERTS (For dashboard)
// ============================================

exports.getAlerts = onCall(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;
    const { limit = 50, unreadOnly = false } = request.data || {};

    try {
        let query = db.collection(`alerts/${userId}`)
            .orderBy('timestamp', 'desc')
            .limit(limit);

        if (unreadOnly) {
            query = query.where('read', '==', false);
        }

        const alertsSnap = await query.get();
        const alerts = alertsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate?.() || null
        }));

        return { success: true, alerts };

    } catch (error) {
        console.error('Error getting alerts:', error);
        throw error;
    }
});

// ============================================
// UPDATE ALERT SETTINGS
// ============================================

exports.updateAlertSettings = onCall(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;
    const { settings } = request.data;

    if (!settings) {
        throw new Error('settings object required');
    }

    try {
        await db.doc(`alert_settings/${userId}`).set({
            ...settings,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return { success: true };

    } catch (error) {
        console.error('Error updating alert settings:', error);
        throw error;
    }
});

// ============================================
// MARK ALERT AS READ
// ============================================

exports.markAlertRead = onCall(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;
    const { alertId } = request.data;

    if (!alertId) {
        throw new Error('alertId required');
    }

    try {
        await db.doc(`alerts/${userId}/${alertId}`).update({
            read: true,
            readAt: FieldValue.serverTimestamp()
        });

        return { success: true };

    } catch (error) {
        console.error('Error marking alert as read:', error);
        throw error;
    }
});
