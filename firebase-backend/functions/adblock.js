/**
 * ZAS Safeguard - Ad Blocker Cloud Functions
 * 
 * Handles:
 * - getAdblockSettings: Returns user's adblock configuration
 * - updateAdblockSettings: Updates user preferences
 * - logAdblockStats: Logs daily stats (no URLs)
 * - getFilterListUpdates: Returns filter list updates
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Ensure admin is initialized (done in index.js)
const db = admin.firestore();

/**
 * Get adblock settings for a user
 */
exports.getAdblockSettings = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const uid = context.auth.uid;

    try {
        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            // Return default settings for new users
            return {
                adblockEnabled: true,
                adblockPreset: 'balanced',
                adblockCosmeticEnabled: true,
                adblockAntiBreakageEnabled: true,
                categories: {
                    ads: true,
                    trackers: true,
                    malware: true,
                    annoyances: false,
                    social: false
                }
            };
        }

        const userData = userDoc.data();

        return {
            adblockEnabled: userData.adblockEnabled ?? true,
            adblockPreset: userData.adblockPreset ?? 'balanced',
            adblockCosmeticEnabled: userData.adblockCosmeticEnabled ?? true,
            adblockAntiBreakageEnabled: userData.adblockAntiBreakageEnabled ?? true,
            categories: userData.adblockCategories ?? {
                ads: true,
                trackers: true,
                malware: true,
                annoyances: false,
                social: false
            }
        };
    } catch (error) {
        console.error('[Adblock] Get settings error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get settings');
    }
});

/**
 * Update adblock settings for a user
 */
exports.updateAdblockSettings = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const uid = context.auth.uid;
    const settings = data;

    // Validate settings
    const allowedFields = [
        'adblockEnabled',
        'adblockPreset',
        'adblockCosmeticEnabled',
        'adblockAntiBreakageEnabled',
        'adblockCategories'
    ];

    const updateData = {};
    for (const field of allowedFields) {
        if (settings[field] !== undefined) {
            updateData[field] = settings[field];
        }
    }

    updateData.adblockLastUpdated = admin.firestore.FieldValue.serverTimestamp();

    try {
        await db.collection('users').doc(uid).set(updateData, { merge: true });

        console.log('[Adblock] Settings updated for user:', uid);
        return { success: true };
    } catch (error) {
        console.error('[Adblock] Update settings error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to update settings');
    }
});

/**
 * Log adblock stats (privacy-respecting - no URLs)
 */
exports.logAdblockStats = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const uid = context.auth.uid;
    const { stats, date } = data;

    // Validate and sanitize stats
    const allowedCategories = ['ads', 'trackers', 'malware', 'annoyances', 'social'];
    const sanitizedStats = {
        total: 0
    };

    for (const category of allowedCategories) {
        const count = parseInt(stats?.[category]) || 0;
        sanitizedStats[category] = Math.min(count, 100000); // Cap at 100k per category
        sanitizedStats.total += sanitizedStats[category];
    }

    // Add metadata
    sanitizedStats.breakageEvents = parseInt(stats?.breakageEvents) || 0;
    sanitizedStats.timestamp = admin.firestore.FieldValue.serverTimestamp();

    const dateKey = date || new Date().toISOString().split('T')[0];

    try {
        await db.collection('adblock_stats')
            .doc(uid)
            .collection('daily')
            .doc(dateKey)
            .set(sanitizedStats, { merge: true });

        console.log('[Adblock] Stats logged for user:', uid, 'date:', dateKey);
        return { success: true };
    } catch (error) {
        console.error('[Adblock] Log stats error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to log stats');
    }
});

/**
 * Get site-specific modes for a user
 */
exports.getAdblockSiteModes = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const uid = context.auth.uid;

    try {
        const sitesSnapshot = await db.collection('adblock_site_modes')
            .doc(uid)
            .collection('sites')
            .get();

        const modes = {};
        sitesSnapshot.forEach(doc => {
            modes[doc.id] = doc.data().mode;
        });

        return { modes };
    } catch (error) {
        console.error('[Adblock] Get site modes error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get site modes');
    }
});

/**
 * Update site-specific mode
 */
exports.updateAdblockSiteMode = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const uid = context.auth.uid;
    const { domain, mode } = data;

    // Validate domain
    if (!domain || typeof domain !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid domain');
    }

    // Validate mode
    const validModes = ['off', 'relaxed', 'strict'];
    if (!validModes.includes(mode)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid mode');
    }

    // Sanitize domain
    const sanitizedDomain = domain.toLowerCase().replace(/[^a-z0-9.-]/g, '');

    try {
        if (mode === 'strict') {
            // Delete the override (revert to default)
            await db.collection('adblock_site_modes')
                .doc(uid)
                .collection('sites')
                .doc(sanitizedDomain)
                .delete();
        } else {
            await db.collection('adblock_site_modes')
                .doc(uid)
                .collection('sites')
                .doc(sanitizedDomain)
                .set({
                    mode: mode,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
        }

        console.log('[Adblock] Site mode updated:', sanitizedDomain, '->', mode);
        return { success: true };
    } catch (error) {
        console.error('[Adblock] Update site mode error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to update site mode');
    }
});

/**
 * Get adblock stats summary for dashboard
 */
exports.getAdblockStatsSummary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const uid = context.auth.uid;
    const { days = 7 } = data;

    try {
        // Get stats for the last N days
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffKey = cutoffDate.toISOString().split('T')[0];

        const statsSnapshot = await db.collection('adblock_stats')
            .doc(uid)
            .collection('daily')
            .where(admin.firestore.FieldPath.documentId(), '>=', cutoffKey)
            .get();

        const summary = {
            totalBlocked: 0,
            byCategory: {
                ads: 0,
                trackers: 0,
                malware: 0,
                annoyances: 0,
                social: 0
            },
            byDay: {},
            breakageEvents: 0
        };

        statsSnapshot.forEach(doc => {
            const dayStats = doc.data();
            summary.totalBlocked += dayStats.total || 0;
            summary.breakageEvents += dayStats.breakageEvents || 0;

            for (const category of Object.keys(summary.byCategory)) {
                summary.byCategory[category] += dayStats[category] || 0;
            }

            summary.byDay[doc.id] = dayStats.total || 0;
        });

        return summary;
    } catch (error) {
        console.error('[Adblock] Get stats summary error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get stats summary');
    }
});
