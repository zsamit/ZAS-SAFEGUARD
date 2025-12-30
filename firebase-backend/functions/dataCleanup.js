/**
 * ZAS Safeguard - Data Cleanup Functions
 * 
 * Automated cleanup of old data to minimize storage costs:
 * - logs: 14 days
 * - security_events: 30 days
 * - adblock_stats: 30 days
 * - url_scans: 7 days
 * - digest_queue: after processed
 * - alert_cooldown: 48 hours
 * - email_caps: next day
 * - daily_caps: next day
 * - stats_throttle: 24 hours
 * - error_logs: 7 days
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const db = admin.firestore();

// ============================================
// RETENTION PERIODS (in milliseconds)
// ============================================
const RETENTION = {
    logs: 14 * 24 * 60 * 60 * 1000,           // 14 days
    security_events: 30 * 24 * 60 * 60 * 1000, // 30 days
    adblock_stats: 30 * 24 * 60 * 60 * 1000,   // 30 days
    url_scans: 7 * 24 * 60 * 60 * 1000,        // 7 days
    alert_cooldown: 48 * 60 * 60 * 1000,       // 48 hours
    email_caps: 24 * 60 * 60 * 1000,           // 24 hours (old date keys)
    daily_caps: 24 * 60 * 60 * 1000,           // 24 hours (old date keys)
    stats_throttle: 24 * 60 * 60 * 1000,       // 24 hours
    error_logs: 7 * 24 * 60 * 60 * 1000        // 7 days
};

const BATCH_SIZE = 500; // Firestore batch limit

/**
 * Delete documents older than cutoff
 */
async function deleteOldDocuments(collectionPath, timestampField, cutoffMs, isSubcollection = false) {
    const cutoffDate = new Date(Date.now() - cutoffMs);
    let deleted = 0;

    try {
        if (isSubcollection) {
            // For subcollections like security_events/{userId}/{deviceId}
            // We need to use collectionGroup
            const query = db.collectionGroup(collectionPath)
                .where(timestampField, '<', cutoffDate)
                .limit(BATCH_SIZE);

            const snapshot = await query.get();

            if (snapshot.empty) {
                return 0;
            }

            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
                deleted++;
            });

            await batch.commit();
        } else {
            // For top-level collections
            const query = db.collection(collectionPath)
                .where(timestampField, '<', cutoffDate)
                .limit(BATCH_SIZE);

            const snapshot = await query.get();

            if (snapshot.empty) {
                return 0;
            }

            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
                deleted++;
            });

            await batch.commit();
        }

        console.log(`[Cleanup] Deleted ${deleted} docs from ${collectionPath}`);
        return deleted;
    } catch (error) {
        console.error(`[Cleanup] Error cleaning ${collectionPath}:`, error);
        return 0;
    }
}

/**
 * Delete processed digest queue items
 */
async function cleanupDigestQueue() {
    try {
        const query = db.collection('digest_queue')
            .where('processed', '==', true)
            .limit(BATCH_SIZE);

        const snapshot = await query.get();

        if (snapshot.empty) {
            return 0;
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`[Cleanup] Deleted ${snapshot.size} processed digest items`);
        return snapshot.size;
    } catch (error) {
        console.error('[Cleanup] Error cleaning digest_queue:', error);
        return 0;
    }
}

/**
 * Delete old date-keyed documents (daily_caps, email_caps, stats_throttle)
 */
async function cleanupDateKeyedDocs(collectionPath) {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let deleted = 0;

    try {
        // Get all documents
        const snapshot = await db.collection(collectionPath)
            .limit(BATCH_SIZE)
            .get();

        if (snapshot.empty) {
            return 0;
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            // Skip if doc ID contains today or yesterday's date
            if (!doc.id.includes(today) && !doc.id.includes(yesterday)) {
                batch.delete(doc.ref);
                deleted++;
            }
        });

        if (deleted > 0) {
            await batch.commit();
        }

        console.log(`[Cleanup] Deleted ${deleted} old docs from ${collectionPath}`);
        return deleted;
    } catch (error) {
        console.error(`[Cleanup] Error cleaning ${collectionPath}:`, error);
        return 0;
    }
}

// ============================================
// SCHEDULED CLEANUP FUNCTION
// Runs daily at 3 AM UTC
// ============================================
exports.dailyCleanup = onSchedule('0 3 * * *', async (event) => {
    console.log('[Cleanup] Starting daily cleanup...');

    const results = {
        logs: 0,
        security_events: 0,
        url_scans: 0,
        digest_queue: 0,
        alert_cooldown: 0,
        email_caps: 0,
        daily_caps: 0,
        stats_throttle: 0
    };

    // Clean logs (14 days)
    results.logs = await deleteOldDocuments('logs', 'timestamp', RETENTION.logs);

    // Clean url_scans (7 days)
    results.url_scans = await deleteOldDocuments('url_scans', 'createdAt', RETENTION.url_scans);

    // Clean alert_cooldown (48 hours)
    results.alert_cooldown = await deleteOldDocuments('alert_cooldown', 'timestamp', RETENTION.alert_cooldown);

    // Clean processed digest_queue
    results.digest_queue = await cleanupDigestQueue();

    // Clean date-keyed collections
    results.email_caps = await cleanupDateKeyedDocs('email_caps');
    results.daily_caps = await cleanupDateKeyedDocs('daily_caps');
    results.stats_throttle = await cleanupDateKeyedDocs('stats_throttle');

    console.log('[Cleanup] Daily cleanup complete:', results);
    return results;
});

// ============================================
// WEEKLY DEEP CLEANUP
// Runs every Sunday at 4 AM UTC
// ============================================
exports.weeklyDeepCleanup = onSchedule('0 4 * * 0', async (event) => {
    console.log('[Cleanup] Starting weekly deep cleanup...');

    const results = {
        security_events: 0,
        adblock_stats: 0,
        error_logs: 0
    };

    // Clean security_events subcollections (30 days) - multiple passes
    for (let i = 0; i < 5; i++) {
        const deleted = await deleteOldDocuments('events', 'createdAt', RETENTION.security_events, true);
        results.security_events += deleted;
        if (deleted < BATCH_SIZE) break; // No more to delete
    }

    // Note: adblock_stats cleanup would need user-level iteration
    // For now, we rely on the extension to not write excessive stats

    console.log('[Cleanup] Weekly deep cleanup complete:', results);
    return results;
});

// ============================================
// EXPORTS for testing
// ============================================
exports.deleteOldDocuments = deleteOldDocuments;
exports.cleanupDigestQueue = cleanupDigestQueue;
exports.cleanupDateKeyedDocs = cleanupDateKeyedDocs;
exports.RETENTION = RETENTION;
