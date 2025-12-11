/**
 * ZAS Safeguard - URL Reputation Cloud Functions
 * Handles URL scanning, logging, and alert triggering
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');

// Optional: Google Safe Browsing API key
const SAFE_BROWSING_KEY = defineSecret('SAFE_BROWSING_KEY');

const db = admin.firestore();

// ============================================
// CHECK URL REPUTATION (Layer C)
// ============================================

exports.checkUrlReputation = onCall({
    secrets: [SAFE_BROWSING_KEY],
    cors: true
}, async (request) => {
    const { url } = request.data;
    const uid = request.auth?.uid;

    if (!uid) {
        throw new HttpsError('unauthenticated', 'Login required');
    }

    if (!url) {
        throw new HttpsError('invalid-argument', 'URL required');
    }

    const result = {
        url,
        safe: true,
        category: 'clean',
        confidence: 100,
        checkedAt: new Date().toISOString()
    };

    try {
        // Check Google Safe Browsing API if key is configured
        const apiKey = SAFE_BROWSING_KEY.value();
        if (apiKey && apiKey !== 'not-configured') {
            const safeBrowsingResult = await checkGoogleSafeBrowsing(url, apiKey);
            if (safeBrowsingResult && !safeBrowsingResult.safe) {
                return {
                    ...result,
                    safe: false,
                    category: safeBrowsingResult.category,
                    confidence: 95,
                    source: 'google_safe_browsing',
                    reason: safeBrowsingResult.reason
                };
            }
        }

        // Additional checks can be added here (VirusTotal, etc.)

        return result;

    } catch (error) {
        console.error('URL reputation check error:', error);
        // Return safe on error to avoid blocking legitimate sites
        return result;
    }
});

/**
 * Check URL against Google Safe Browsing API
 */
async function checkGoogleSafeBrowsing(url, apiKey) {
    try {
        const response = await fetch(
            `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client: {
                        clientId: 'zas-safeguard',
                        clientVersion: '1.0.0'
                    },
                    threatInfo: {
                        threatTypes: [
                            'MALWARE',
                            'SOCIAL_ENGINEERING',
                            'UNWANTED_SOFTWARE',
                            'POTENTIALLY_HARMFUL_APPLICATION'
                        ],
                        platformTypes: ['ANY_PLATFORM'],
                        threatEntryTypes: ['URL'],
                        threatEntries: [{ url }]
                    }
                })
            }
        );

        const data = await response.json();

        if (data.matches && data.matches.length > 0) {
            const match = data.matches[0];
            return {
                safe: false,
                category: mapThreatType(match.threatType),
                reason: match.threatType
            };
        }

        return { safe: true };
    } catch (error) {
        console.error('Safe Browsing API error:', error);
        return null;
    }
}

/**
 * Map Google threat type to our categories
 */
function mapThreatType(threatType) {
    const mapping = {
        'MALWARE': 'malware',
        'SOCIAL_ENGINEERING': 'phishing',
        'UNWANTED_SOFTWARE': 'malware',
        'POTENTIALLY_HARMFUL_APPLICATION': 'malware'
    };
    return mapping[threatType] || 'suspicious';
}

// ============================================
// LOG URL SCAN
// ============================================

exports.logUrlScan = onCall({ cors: true }, async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
        throw new HttpsError('unauthenticated', 'Login required');
    }

    const {
        url,
        blocked,
        category,
        source,
        reason,
        deviceId,
        timestamp
    } = request.data;

    try {
        // Log to url_scans collection
        const scanRef = await db.collection('url_scans').add({
            userId: uid,
            url,
            result: blocked ? 'blocked' : 'safe',
            risk_level: blocked ? 'high' : 'low',
            category: category || 'unknown',
            detected_by: source || 'unknown',
            reason: reason || null,
            deviceId: deviceId || null,
            timestamp: timestamp || new Date().toISOString(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Check for alert threshold
        if (blocked) {
            await checkMaliciousAttemptThreshold(uid, deviceId);
        }

        return { success: true, scanId: scanRef.id };

    } catch (error) {
        console.error('Log URL scan error:', error);
        throw new HttpsError('internal', 'Failed to log scan');
    }
});

/**
 * Check if user has exceeded malicious attempt thresholds
 * 1 attempt = log only
 * 2 attempts in 1 min = email parent
 * 3 attempts in 5 min = high-severity alert
 */
async function checkMaliciousAttemptThreshold(userId, deviceId) {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

        // Get recent blocked attempts
        const recentScans = await db.collection('url_scans')
            .where('userId', '==', userId)
            .where('result', '==', 'blocked')
            .where('createdAt', '>=', fiveMinutesAgo)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();

        const attempts = recentScans.docs.map(doc => doc.data());
        const attemptsInLastMinute = attempts.filter(a =>
            new Date(a.timestamp) >= oneMinuteAgo
        ).length;
        const attemptsInFiveMinutes = attempts.length;

        // Get user profile for parent info
        const userDoc = await db.doc(`users/${userId}`).get();
        const userProfile = userDoc.data();

        if (attemptsInFiveMinutes >= 3) {
            // HIGH SEVERITY - 3+ attempts in 5 minutes
            await createAlert(userId, {
                type: 'malicious_attempts',
                severity: 'high',
                title: 'Multiple Malicious Link Attempts',
                message: `${attemptsInFiveMinutes} attempts to access dangerous websites in the last 5 minutes`,
                deviceId,
                count: attemptsInFiveMinutes
            });

            // Trigger parent email if family mode
            if (userProfile?.mode === 'family' && userProfile?.email) {
                await sendAlertEmail(userProfile.email, {
                    type: 'high_severity',
                    subject: '🚨 High Security Alert - ZAS Safeguard',
                    message: `Your child made ${attemptsInFiveMinutes} attempts to access dangerous websites.`
                });
            }

        } else if (attemptsInLastMinute >= 2) {
            // MEDIUM SEVERITY - 2 attempts in 1 minute
            await createAlert(userId, {
                type: 'malicious_attempts',
                severity: 'medium',
                title: 'Repeated Malicious Link Attempts',
                message: `${attemptsInLastMinute} attempts to access dangerous websites in the last minute`,
                deviceId,
                count: attemptsInLastMinute
            });

            // Send email for family accounts
            if (userProfile?.mode === 'family' && userProfile?.email) {
                await sendAlertEmail(userProfile.email, {
                    type: 'medium_severity',
                    subject: '⚠️ Security Alert - ZAS Safeguard',
                    message: `Your child made ${attemptsInLastMinute} attempts to access dangerous websites.`
                });
            }
        }

    } catch (error) {
        console.error('Alert threshold check error:', error);
    }
}

/**
 * Create alert in Firestore
 */
async function createAlert(userId, alertData) {
    await db.collection('alerts').add({
        userId,
        ...alertData,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

/**
 * Send alert email via Firebase Email Extension
 */
async function sendAlertEmail(to, emailData) {
    await db.collection('mail').add({
        to,
        message: {
            subject: emailData.subject,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #0f172a; color: white; padding: 20px; text-align: center;">
                        <h1 style="margin: 0;">🛡️ ZAS Safeguard</h1>
                    </div>
                    <div style="padding: 30px; background: #f8fafc;">
                        <h2 style="color: #ef4444;">${emailData.subject}</h2>
                        <p style="font-size: 16px; color: #334155;">${emailData.message}</p>
                        <p style="font-size: 14px; color: #64748b;">
                            Please check your ZAS Safeguard dashboard for more details.
                        </p>
                        <a href="https://zas-safeguard.web.app/app/" 
                           style="display: inline-block; background: #3b82f6; color: white; 
                                  padding: 12px 24px; border-radius: 8px; text-decoration: none;">
                            View Dashboard
                        </a>
                    </div>
                </div>
            `
        }
    });
}

// ============================================
// CLEANUP OLD SCANS (runs daily)
// ============================================

exports.cleanupOldUrlScans = onSchedule('every 24 hours', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const oldScans = await db.collection('url_scans')
        .where('createdAt', '<', thirtyDaysAgo)
        .limit(500)
        .get();

    const batch = db.batch();
    oldScans.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    console.log(`Cleaned up ${oldScans.size} old URL scans`);
});
