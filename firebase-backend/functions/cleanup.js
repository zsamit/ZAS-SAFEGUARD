/**
 * ZAS Safeguard - Cleanup Functions
 * 
 * Scheduled functions for:
 * - Deleting old logs (30 days)
 * - Deleting old error logs (7 days)
 * - Rate limiting enforcement
 * - Optional archive for premium users
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore();

// ============================================
// LOG CLEANUP (Runs daily at 3 AM UTC)
// ============================================

exports.cleanupOldLogs = onSchedule('0 3 * * *', async (event) => {
    console.log('Starting daily log cleanup...');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let totalDeleted = 0;

    try {
        // 1. Delete old activity logs (30 days)
        const oldLogs = await db.collection('logs')
            .where('timestamp', '<', thirtyDaysAgo)
            .limit(500)
            .get();

        if (!oldLogs.empty) {
            const batch = db.batch();
            oldLogs.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            totalDeleted += oldLogs.size;
            console.log(`Deleted ${oldLogs.size} old activity logs`);
        }

        // 2. Delete old error logs (7 days)
        const users = await db.collection('errorLogs').listDocuments();

        for (const userDoc of users) {
            const oldErrors = await userDoc.collection('entries')
                .where('timestamp', '<', sevenDaysAgo.getTime())
                .limit(100)
                .get();

            if (!oldErrors.empty) {
                const batch = db.batch();
                oldErrors.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                totalDeleted += oldErrors.size;
            }
        }

        // 3. Delete old admin logs (90 days)
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const adminUsers = await db.collection('admin_logs').listDocuments();

        for (const userDoc of adminUsers) {
            const oldEvents = await userDoc.collection('events')
                .where('timestamp', '<', ninetyDaysAgo)
                .limit(100)
                .get();

            if (!oldEvents.empty) {
                const batch = db.batch();
                oldEvents.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                totalDeleted += oldEvents.size;
            }
        }

        // 4. Delete old study sessions (1 year)
        const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        const oldSessions = await db.collection('studySessions')
            .where('startTime', '<', oneYearAgo)
            .limit(200)
            .get();

        if (!oldSessions.empty) {
            const batch = db.batch();
            oldSessions.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            totalDeleted += oldSessions.size;
        }

        console.log(`Cleanup complete. Total deleted: ${totalDeleted}`);

        // Log cleanup event
        await db.collection('system_logs').add({
            type: 'cleanup',
            deletedCount: totalDeleted,
            timestamp: FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        throw error;
    }
});

// ============================================
// RATE LIMITING
// ============================================

/**
 * Check and enforce rate limits
 * Called before write operations
 */
exports.checkRateLimit = onCall(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;
    const { action = 'write' } = request.data;

    // Rate limit config
    const limits = {
        write: { max: 60, windowSeconds: 60 },      // 1 write/sec average
        log: { max: 30, windowSeconds: 60 },        // 0.5 logs/sec
        sync: { max: 10, windowSeconds: 300 },      // 2 syncs/min
        unlock: { max: 3, windowSeconds: 3600 }     // 3 unlock attempts/hour
    };

    const limit = limits[action] || limits.write;
    const now = Date.now();
    const windowStart = now - (limit.windowSeconds * 1000);

    try {
        // Get rate limit document
        const rateLimitRef = db.doc(`rate_limits/${userId}`);
        const rateLimitDoc = await rateLimitRef.get();

        let data = rateLimitDoc.exists ? rateLimitDoc.data() : {};
        let actionData = data[action] || { count: 0, timestamps: [] };

        // Filter timestamps within window
        actionData.timestamps = (actionData.timestamps || []).filter(t => t > windowStart);

        // Check if over limit
        if (actionData.timestamps.length >= limit.max) {
            const oldestInWindow = Math.min(...actionData.timestamps);
            const retryAfter = Math.ceil((oldestInWindow + (limit.windowSeconds * 1000) - now) / 1000);

            return {
                allowed: false,
                retryAfterSeconds: retryAfter,
                message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`
            };
        }

        // Add current timestamp
        actionData.timestamps.push(now);
        actionData.count = actionData.timestamps.length;

        // Update rate limit document
        await rateLimitRef.set({
            ...data,
            [action]: actionData,
            lastUpdated: FieldValue.serverTimestamp()
        }, { merge: true });

        return {
            allowed: true,
            remaining: limit.max - actionData.timestamps.length,
            resetSeconds: limit.windowSeconds
        };

    } catch (error) {
        console.error('Rate limit check error:', error);
        // On error, allow the request (fail open)
        return { allowed: true };
    }
});

/**
 * Log errors from clients
 */
exports.logErrors = onCall(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;
    const { errors } = request.data;

    if (!Array.isArray(errors) || errors.length === 0) {
        return { success: true, logged: 0 };
    }

    try {
        const batch = db.batch();
        const entriesRef = db.collection(`errorLogs/${userId}/entries`);

        errors.slice(0, 20).forEach(error => {
            const docRef = entriesRef.doc();
            batch.set(docRef, {
                ...error,
                serverTimestamp: FieldValue.serverTimestamp()
            });
        });

        await batch.commit();

        return { success: true, logged: Math.min(errors.length, 20) };
    } catch (error) {
        console.error('Error logging errors:', error);
        throw error;
    }
});

// ============================================
// ARCHIVE FOR PREMIUM (Optional)
// ============================================

exports.archiveUserData = onCall(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const userId = request.auth.uid;

    try {
        // Check if user has premium subscription
        const userDoc = await db.doc(`users/${userId}`).get();
        const userData = userDoc.data();

        if (!userData?.subscription?.plan || userData.subscription.plan === 'free') {
            throw new Error('Archive feature requires premium subscription');
        }

        // Collect all user data
        const archive = {
            user: userData,
            logs: [],
            studySessions: [],
            blocklist: null,
            exportDate: new Date().toISOString()
        };

        // Get logs
        const logs = await db.collection('logs')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc')
            .limit(1000)
            .get();
        archive.logs = logs.docs.map(d => d.data());

        // Get study sessions
        const sessions = await db.collection('studySessions')
            .where('userId', '==', userId)
            .orderBy('startTime', 'desc')
            .limit(500)
            .get();
        archive.studySessions = sessions.docs.map(d => d.data());

        // Get custom blocklist
        const blocklist = await db.doc(`blocklists/custom/${userId}`).get();
        if (blocklist.exists) {
            archive.blocklist = blocklist.data();
        }

        return {
            success: true,
            archive,
            exportDate: archive.exportDate
        };

    } catch (error) {
        console.error('Archive error:', error);
        throw error;
    }
});
