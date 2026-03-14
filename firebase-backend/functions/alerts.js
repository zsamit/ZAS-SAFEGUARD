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
const costGuard = require('./costGuard');

const db = getFirestore();

// Alert thresholds (configurable per user via alert_settings)
const DEFAULT_THRESHOLDS = {
    blockedAttemptsPerMinute: 2,
    heartbeatMissingMinutes: 10,
    maxAlertsPerHour: 10
};

// Dashboard URL for email links
const DASHBOARD_BASE_URL = process.env.DASHBOARD_URL || 'https://zassafeguard.com/app';

// Spam prevention config
const SPAM_CONFIG = {
    MAX_EMAILS_PER_DAY: 3,
    TAMPER_COOLDOWN_MS: 30 * 60 * 1000,  // 30 minutes
    DEFAULT_QUIET_START: 22, // 10 PM
    DEFAULT_QUIET_END: 7,    // 7 AM
};

// TAMPER events get instant emails (subject to cooldown)
const TAMPER_EVENTS = [
    'EXTENSION_DISABLED', 'DISABLE_ATTEMPT', 'EXTENSION_UNINSTALLED',
    'DEVTOOLS_OPENED', 'POLICY_TAMPER', 'TOKEN_TAMPER'
];

// OFFLINE events go to digest, NOT instant email
const OFFLINE_EVENTS = [
    'HEARTBEAT_MISSING', 'HEARTBEAT_MISSED', 'DEVICE_OFFLINE', 'BROWSER_CLOSED'
];

// ============================================
// SECURITY EVENT TRIGGER
// ============================================

/**
 * Triggered when a new security event is created
 * Evaluates alert rules and sends notifications
 */
exports.onSecurityEvent = onDocumentCreated(
    {
        document: 'security_events/{userId}/{deviceId}/{eventId}',
        memory: '512MiB'
    },
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
            // Support both old names and new standardized names
            const eventType = eventData.type;

            switch (eventType) {
                case 'DISABLE_ATTEMPT':
                case 'extension_disabled':
                    // RULE: Instant alert on extension disable
                    await sendAlert(userId, deviceId, {
                        type: 'DISABLE_ATTEMPT',
                        severity: 'high',
                        title: '⚠️ Extension Disabled',
                        message: `The ZAS Safeguard extension was disabled on ${eventData.deviceName || 'a device'}.`,
                        eventRef: `security_events/${userId}/${deviceId}/${event.params.eventId}`
                    });
                    break;

                case 'BLOCKED_SITE':
                case 'blocked_attempt':
                    // RULE: Check for 2+ blocks in 1 minute
                    await checkBlockedAttemptThreshold(userId, deviceId, eventData, event.params.eventId);
                    break;

                case 'DEVTOOLS_OPENED':
                case 'tamper_attempt':
                    await sendAlert(userId, deviceId, {
                        type: 'DEVTOOLS_OPENED',
                        severity: 'medium',
                        title: '🛠️ Developer Tools Opened',
                        message: `Developer tools were opened on ${eventData.deviceName || 'a device'}. This could indicate an attempt to bypass protection.`,
                        eventRef: `security_events/${userId}/${deviceId}/${event.params.eventId}`
                    });
                    break;

                case 'HEARTBEAT_MISSED':
                case 'heartbeat_missing':
                    // CRITICAL: Do NOT send instant email for heartbeat missing
                    // These go to daily digest to prevent spam
                    console.log(`[Alert] Heartbeat missed for ${deviceId} - queuing for digest (no instant email)`);
                    await queueForDigest(userId, deviceId, {
                        eventType: 'DEVICE_OFFLINE',
                        deviceName: eventData.deviceName || 'Unknown',
                        minutesOffline: eventData.minutesMissing || 10
                    });
                    break;

                case 'MALWARE_DETECTED':
                case 'SCAN_MALICIOUS':
                    await sendAlert(userId, deviceId, {
                        type: 'MALWARE_DETECTED',
                        severity: 'high',
                        title: '🚨 Malware/Phishing Detected',
                        message: `A dangerous link was detected and blocked on ${eventData.deviceName || 'a device'}: ${eventData.url || 'Unknown URL'}`,
                        eventRef: `security_events/${userId}/${deviceId}/${event.params.eventId}`
                    });
                    break;
            }
        } catch (error) {
            console.error('Error processing security event:', error);
        }
    }
);

// ============================================
// DIGEST QUEUE (For offline events - no instant spam)
// ============================================

/**
 * Queue event for daily digest instead of instant email
 */
async function queueForDigest(userId, deviceId, eventData) {
    try {
        const today = new Date().toISOString().split('T')[0];
        await db.collection('digest_queue').add({
            userId,
            deviceId,
            deviceName: eventData.deviceName || 'Unknown Device',
            eventType: eventData.eventType,
            details: eventData,
            queuedAt: FieldValue.serverTimestamp(),
            digestDate: today,
            processed: false
        });
        console.log(`[Digest] Queued ${eventData.eventType} for ${deviceId}`);
    } catch (error) {
        console.error('[Digest] Queue error:', error);
    }
}

// NOTE: checkHeartbeats is now in heartbeat.js with proper spam prevention

// ============================================
// SPAM PREVENTION HELPERS
// ============================================

/**
 * Check if user has exceeded daily email cap
 */
async function checkDailyEmailCap(userId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const capDoc = await db.doc(`email_caps/${userId}_${today}`).get();

        if (!capDoc.exists) return false;

        const count = capDoc.data().count || 0;
        return count >= SPAM_CONFIG.MAX_EMAILS_PER_DAY;
    } catch (error) {
        return false;
    }
}

/**
 * Check if tamper cooldown is active
 */
async function checkTamperCooldown(userId, deviceId, eventType) {
    try {
        const cooldownDoc = await db.doc(`alert_cooldown/${userId}_${deviceId}_${eventType}`).get();

        if (!cooldownDoc.exists) return false;

        const lastAlert = cooldownDoc.data().timestamp?.toMillis?.() || 0;
        return Date.now() - lastAlert < SPAM_CONFIG.TAMPER_COOLDOWN_MS;
    } catch (error) {
        return false;
    }
}

/**
 * Check if current time is within user's quiet hours
 */
function isInQuietHours(timezone, alertSettings) {
    try {
        const quietEnabled = alertSettings.quietHoursEnabled !== false; // Default ON
        if (!quietEnabled) return false;

        const quietStart = alertSettings.quietHoursStart ?? SPAM_CONFIG.DEFAULT_QUIET_START;
        const quietEnd = alertSettings.quietHoursEnd ?? SPAM_CONFIG.DEFAULT_QUIET_END;

        // Get current hour in user's timezone
        const now = new Date();
        const options = { timeZone: timezone, hour: 'numeric', hour12: false };
        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now));

        // Handle overnight quiet hours (e.g., 22-7)
        if (quietStart > quietEnd) {
            return currentHour >= quietStart || currentHour < quietEnd;
        } else {
            return currentHour >= quietStart && currentHour < quietEnd;
        }
    } catch (error) {
        console.warn('[isInQuietHours] Error:', error);
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

// Helper to get hour key for dedupe
function getHourKey() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}`;
}

// Helper to get minute key for dedupe
function getMinuteKey() {
    const now = new Date();
    return `${getHourKey()}${String(now.getMinutes()).padStart(2, '0')}`;
}

// ============================================
// BLOCKED ATTEMPT THRESHOLD CHECK
// ============================================

async function checkBlockedAttemptThreshold(userId, deviceId, eventData, eventId) {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60 * 1000);

    try {
        // Get user's threshold setting
        const settingsDoc = await db.doc(`alert_settings/${userId}`).get();
        const threshold = settingsDoc.data()?.blockedAttemptsPerMinute || DEFAULT_THRESHOLDS.blockedAttemptsPerMinute;

        // Count blocked attempts in last minute
        // Query only on createdAt (auto-indexed), filter type in code to avoid composite index
        const recentEvents = await db.collection(`security_events/${userId}/${deviceId}`)
            .where('createdAt', '>', Timestamp.fromDate(oneMinuteAgo))
            .get();

        // Filter for blocked site events in code
        const recentBlocks = recentEvents.docs.filter(doc => {
            const type = doc.data().type;
            return type === 'BLOCKED_SITE' || type === 'blocked_attempt';
        });

        if (recentBlocks.length >= threshold) {
            // Dedupe check - one alert per device per minute window
            const dedupeKey = `${userId}:${deviceId}:BLOCKED_THRESHOLD:${getMinuteKey()}`;
            const recentAlerts = await db.collection('alerts')
                .where('userId', '==', userId)
                .where('dedupeKey', '==', dedupeKey)
                .limit(1)
                .get();

            if (recentAlerts.empty) {
                // Extract the blocked URLs for the alert message
                const blockedUrls = recentBlocks.map(doc => {
                    const data = doc.data();
                    return data.url || data.reason || 'Unknown site';
                }).slice(0, 5); // Show up to 5 URLs

                const urlList = blockedUrls.join(', ');
                const moreText = recentBlocks.length > 5 ? ` and ${recentBlocks.length - 5} more` : '';

                await sendAlert(userId, deviceId, {
                    type: 'BLOCKED_THRESHOLD',
                    severity: 'medium',
                    title: '🚫 Multiple Blocked Attempts',
                    message: `${recentBlocks.length} attempts to access blocked content: ${urlList}${moreText}`,
                    blockedCount: recentBlocks.length,
                    blockedUrls: blockedUrls,
                    eventRef: `security_events/${userId}/${deviceId}/${eventId}`
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
    console.log(`[sendAlert] Creating alert for user ${userId}, type: ${alertData.type}`);

    try {
        // COST GUARD: Check global kill switch
        const canSendEmail = await costGuard.shouldSendEmail(userId);
        if (!canSendEmail) {
            console.log('[sendAlert] Email blocked by cost guard');
            return;
        }

        // SPAM PREVENTION: Check if this is an offline event (should NOT instant email)
        if (OFFLINE_EVENTS.includes(alertData.type)) {
            console.log(`[sendAlert] ${alertData.type} is offline event - redirecting to digest`);
            await queueForDigest(userId, deviceId, alertData);
            return;
        }

        // SPAM PREVENTION: Check daily email cap
        const dailyCapReached = await checkDailyEmailCap(userId);
        if (dailyCapReached) {
            console.log('[sendAlert] Daily email cap reached, skipping');
            return;
        }

        // SPAM PREVENTION: Check cooldown for tamper events
        if (TAMPER_EVENTS.includes(alertData.type)) {
            const cooldownActive = await checkTamperCooldown(userId, deviceId, alertData.type);
            if (cooldownActive) {
                console.log('[sendAlert] Tamper cooldown active, skipping');
                return;
            }
        }

        // Get user data for email and mode check
        const userDoc = await db.doc(`users/${userId}`).get();
        const user = userDoc.data() || {};

        // ===========================================
        // INSTANT ALERTS CHECK (User preference)
        // ===========================================
        const instantAlertsEnabled = user.settings?.instantAlertsEnabled !== false; // Default true
        if (!instantAlertsEnabled) {
            console.log('[sendAlert] Instant alerts disabled by user, saving but not emailing');
            await db.collection('alerts').add({
                ...alertData,
                userId,
                deviceId,
                read: false,
                emailSent: false,
                skippedReason: 'instant_alerts_disabled',
                createdAt: FieldValue.serverTimestamp()
            });
            return;
        }

        // ===========================================
        // PROTECTION MODE CHECK (Parental vs Personal)
        // ===========================================
        const protectionMode = user.protectionMode || 'parental'; // Default to parental

        // Personal Mode: Only email for EXTENSION_DISABLED/DISABLE_ATTEMPT - skip DevTools/blocked sites
        if (protectionMode === 'personal') {
            const personalModeAlerts = ['DISABLE_ATTEMPT', 'EXTENSION_DISABLED', 'EXTENSION_UNINSTALLED'];
            if (!personalModeAlerts.includes(alertData.type)) {
                console.log(`[sendAlert] Personal mode - skipping ${alertData.type} (not critical)`);
                // Still save alert to Firestore for history, but don't email
                await db.collection('alerts').add({
                    ...alertData,
                    userId,
                    deviceId,
                    read: false,
                    emailSent: false,
                    skippedReason: 'personal_mode',
                    createdAt: FieldValue.serverTimestamp()
                });
                return;
            }
            // In personal mode, email goes to SELF, not parent
            console.log('[sendAlert] Personal mode - alerting self only');
        }
        // Parental Mode: Email parent for all security events (DevTools, blocked sites, etc.)

        // SPAM PREVENTION: Check quiet hours
        const timezone = user.timezone || 'America/Los_Angeles';
        const alertSettings = user.alertSettings || {};
        if (isInQuietHours(timezone, alertSettings) && !TAMPER_EVENTS.includes(alertData.type)) {
            console.log('[sendAlert] Quiet hours active, skipping non-tamper alert');
            return;
        }

        // Try family_profiles first for parent email (only in parental mode)
        let recipientEmail;
        if (protectionMode === 'personal') {
            // Personal mode: email goes to user's own email
            recipientEmail = user.email;
            console.log('[sendAlert] Personal mode - emailing self');
        } else {
            // Parental mode: email goes to parent's email
            const familyDoc = await db.doc(`family_profiles/${userId}`).get();
            recipientEmail = familyDoc.data()?.parentEmail || user.email;
            console.log('[sendAlert] Parental mode - emailing parent');
        }

        if (!recipientEmail) {
            console.log('[sendAlert] No email for user, skipping alert');
            return;
        }
        console.log(`[sendAlert] Sending to: ${recipientEmail}`);

        // Generate dedupe key
        const dedupeKey = `${userId}:${deviceId}:${alertData.type}:${getMinuteKey()}`;

        // Check if already sent (dedupe) - handle gracefully if collection doesn't exist
        try {
            const existing = await db.collection('alerts')
                .where('userId', '==', userId)
                .where('dedupeKey', '==', dedupeKey)
                .limit(1)
                .get();

            if (!existing.empty) {
                console.log('[sendAlert] Duplicate alert, skipping');
                return;
            }
        } catch (e) {
            console.log('[sendAlert] Dedupe check failed (first alert?):', e.message);
        }

        // Get device name
        const deviceDoc = await db.doc(`devices/${deviceId}`).get();
        const deviceName = deviceDoc.data()?.deviceName || 'Unknown Device';

        // Save alert to Firestore
        console.log('[sendAlert] Saving alert to Firestore...');
        const alertRef = await db.collection('alerts').add({
            ...alertData,
            userId,
            deviceId,
            deviceName,
            read: false,
            emailSent: false,
            dedupeKey,
            createdAt: FieldValue.serverTimestamp()
        });
        console.log(`[sendAlert] Alert created: ${alertRef.id}`);

        // Build email content (both HTML and plain text)
        const timestamp = new Date().toLocaleString();
        const alertsLink = `${DASHBOARD_BASE_URL}/?view=alerts`;

        const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 20px; border-radius: 12px 12px 0 0;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">ZAS Safeguard</h1>
                </div>
                <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
                    <div style="background: ${alertData.severity === 'high' ? '#fef2f2' : '#fefce8'}; border-left: 4px solid ${alertData.severity === 'high' ? '#ef4444' : '#eab308'}; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                        <h2 style="margin: 0 0 8px 0; color: ${alertData.severity === 'high' ? '#dc2626' : '#ca8a04'};">${alertData.title}</h2>
                        <p style="margin: 0; color: #374151;">${alertData.message}</p>
                    </div>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 8px 0; color: #6b7280;">Device:</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">${deviceName}</td></tr>
                        <tr><td style="padding: 8px 0; color: #6b7280;">Time:</td><td style="padding: 8px 0; color: #111827;">${timestamp}</td></tr>
                        <tr><td style="padding: 8px 0; color: #6b7280;">Severity:</td><td style="padding: 8px 0;"><span style="background: ${alertData.severity === 'high' ? '#fee2e2' : '#fef9c3'}; color: ${alertData.severity === 'high' ? '#dc2626' : '#ca8a04'}; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 500;">${alertData.severity.toUpperCase()}</span></td></tr>
                    </table>
                    <div style="margin-top: 24px; text-align: center;">
                        <a href="${alertsLink}" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600;">View All Alerts</a>
                    </div>
                </div>
                <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 12px;">
                    <p>You're receiving this because you have ZAS Safeguard alerts enabled.</p>
                    <p>© ${new Date().getFullYear()} ZAS Global LLC</p>
                </div>
            </div>
        `;

        const emailText = `
ZAS Safeguard Alert

${alertData.title}

${alertData.message}

Device: ${deviceName}
Time: ${timestamp}
Severity: ${alertData.severity.toUpperCase()}

View all alerts: ${alertsLink}

---
You're receiving this because you have ZAS Safeguard alerts enabled.
© ${new Date().getFullYear()} ZAS Global LLC
        `.trim();

        // Queue email via Firebase Email Extension (mail collection)
        await db.collection('mail').add({
            to: recipientEmail,
            message: {
                subject: `ZAS Safeguard: ${alertData.title}`,
                text: emailText,
                html: emailHtml
            }
        });

        // Mark email as sent
        await alertRef.update({ emailSent: true });

        // SPAM PREVENTION: Track email for daily cap
        await incrementDailyEmailCount(userId);

        // SPAM PREVENTION: Set cooldown for this event type
        if (TAMPER_EVENTS.includes(alertData.type)) {
            await setAlertCooldown(userId, deviceId, alertData.type);
        }

        console.log(`Alert sent to ${recipientEmail}: ${alertData.title}`);

    } catch (error) {
        console.error('Error sending alert:', error);
    }
}

// ============================================
// LOG SECURITY EVENT (Called by extension)
// ============================================

exports.logSecurityEvent = onCall({ memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;
    const { deviceId, type, url, reason, severity = 'medium', metadata = {} } = request.data;

    if (!deviceId || !type) {
        throw new Error('deviceId and type are required');
    }

    // COST GUARD: Check if security event write is allowed
    const canWrite = await costGuard.shouldWriteSecurityEvent(userId, deviceId);
    if (!canWrite) {
        console.log('[logSecurityEvent] Blocked by cost guard (cap or kill switch)');
        return { success: true, skipped: true };
    }

    try {
        // M-06: Verify device exists and belongs to user (no auto-creation)
        const deviceRef = db.doc(`devices/${deviceId}`);
        const deviceDoc = await deviceRef.get();
        let deviceName = 'Unknown Device';

        if (!deviceDoc.exists) {
            throw new Error('Device not found. Register device first.');
        }

        // Verify ownership
        if (deviceDoc.data().userId !== userId) {
            throw new Error('Unauthorized: device does not belong to user');
        }
        deviceName = deviceDoc.data().deviceName || 'Unknown Device';

        // Update lastSeen
        await deviceRef.update({
            lastSeen: FieldValue.serverTimestamp()
        });

        // Log the security event with standardized schema
        const eventRef = await db.collection(`security_events/${userId}/${deviceId}`).add({
            type,
            url: url || null,
            reason: reason || '',
            severity,
            deviceName,
            ...metadata,
            createdAt: FieldValue.serverTimestamp()
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
        let query = db.collection('alerts')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
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
        // Alerts are in flat collection alerts/{alertId}
        const alertRef = db.doc(`alerts/${alertId}`);
        const alertDoc = await alertRef.get();

        if (!alertDoc.exists) {
            throw new Error('Alert not found');
        }

        // Verify ownership
        if (alertDoc.data().userId !== userId) {
            throw new Error('Not authorized to modify this alert');
        }

        await alertRef.update({
            read: true,
            readAt: FieldValue.serverTimestamp()
        });

        return { success: true };

    } catch (error) {
        console.error('Error marking alert as read:', error);
        throw error;
    }
});

// ============================================
// TEST EMAIL (Manual trigger for debugging)
// ============================================

const { onRequest } = require('firebase-functions/v2/https');

exports.testEmail = onRequest({ cors: true, memory: '512MiB' }, async (req, res) => {
    // Require admin authentication
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const admin = require('firebase-admin');
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        // Check if user is admin
        const adminDoc = await db.doc(`admins/${decodedToken.uid}`).get();
        if (!adminDoc.exists) {
            return res.status(403).json({ error: 'Admin access required' });
        }
    } catch (authError) {
        return res.status(401).json({ error: 'Invalid authentication' });
    }

    const { email, message } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'email required' });
    }

    try {
        await db.collection('mail').add({
            to: email,
            message: {
                subject: 'ZAS Safeguard Test Email',
                text: message || 'This is a test email from ZAS Safeguard. If you received this, emails are working!',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h1 style="color: #6366f1;">📧 ZAS Safeguard Test Email</h1>
                        <p>${message || 'This is a test email. If you received this, your email alerts are working!'}</p>
                        <p style="color: gray; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
                    </div>
                `
            }
        });

        return res.json({ success: true, message: `Test email queued to ${email}` });
    } catch (error) {
        console.error('Test email error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// ============================================
// LOG SECURITY EVENT (HTTP Version for extension)
// ============================================

exports.logSecurityEventHttp = onRequest({ cors: true }, async (req, res) => {
    try {
        // Verify auth token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const admin = require('firebase-admin');
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        const { data } = req.body;
        const { deviceId, type, metadata = {} } = data || {};

        if (!deviceId || !type) {
            return res.status(400).json({ error: 'deviceId and type are required' });
        }

        console.log(`[logSecurityEventHttp] ${type} from ${userId}/${deviceId}`);

        // COST GUARD
        const canWrite = await costGuard.shouldWriteSecurityEvent(userId, deviceId);
        if (!canWrite) {
            return res.json({ success: true, skipped: true });
        }

        // M-06: Verify device exists and belongs to caller (no auto-creation)
        const deviceDoc = await db.doc(`devices/${deviceId}`).get();
        let deviceName = 'Unknown Device';

        if (!deviceDoc.exists) {
            return res.status(404).json({ error: 'Device not found. Register device first.' });
        }

        // Verify ownership
        if (deviceDoc.data().userId !== userId) {
            return res.status(403).json({ error: 'Device does not belong to user' });
        }
        deviceName = deviceDoc.data().deviceName || 'Unknown Device';

        await db.doc(`devices/${deviceId}`).update({
            lastSeen: FieldValue.serverTimestamp()
        });

        // Log the security event
        const eventRef = await db.collection(`security_events/${userId}/${deviceId}`).add({
            type,
            deviceName,
            severity: metadata.severity || 'medium',
            ...metadata,
            createdAt: FieldValue.serverTimestamp()
        });

        console.log(`[logSecurityEventHttp] Created event: ${eventRef.id}`);

        return res.json({ success: true, eventId: eventRef.id });

    } catch (error) {
        console.error('[logSecurityEventHttp] Error:', error);
        return res.status(500).json({ error: error.message });
    }
});
