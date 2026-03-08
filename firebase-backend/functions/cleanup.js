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

// ============================================
// BACKGROUND DELETION QUEUE PROCESSOR
// ============================================

/**
 * Process deletion queue — background worker for account data cleanup
 * Runs every 2 minutes, processes up to 5 deletions per run
 */
exports.processDeletionQueue = onSchedule({
    schedule: 'every 2 minutes',
    timeoutSeconds: 540,
    memory: '1GiB'
}, async () => {
    const pending = await db.collection('deletion_queue')
        .where('status', '==', 'pending')
        .limit(5)
        .get();

    if (pending.empty) return;

    for (const doc of pending.docs) {
        const { userId, collections, mainDocs } = doc.data();

        try {
            await doc.ref.update({
                status: 'processing',
                startedAt: FieldValue.serverTimestamp()
            });

            // Delete main documents
            if (mainDocs && mainDocs.length > 0) {
                const batch = db.batch();
                for (const docPath of mainDocs) {
                    batch.delete(db.doc(`${docPath}/${userId}`));
                }
                await batch.commit();
            }

            // Delete subcollections with pagination
            if (collections && collections.length > 0) {
                for (const collection of collections) {
                    await deleteCollectionByUser(collection, userId);
                }
            }

            await doc.ref.update({
                status: 'completed',
                completedAt: FieldValue.serverTimestamp()
            });

            console.log(`✅ Background deletion completed for user: ${userId}`);

        } catch (error) {
            console.error(`Background deletion failed for user ${userId}:`, error);
            await doc.ref.update({
                status: 'failed',
                error: error.message,
                failedAt: FieldValue.serverTimestamp()
            });
        }
    }
});

// ============================================
// STRIPE MANUAL CLEANUP RETRY
// ============================================

/**
 * Process manual Stripe cleanup queue
 * Runs every 30 minutes, retries failed Stripe deletions up to 5 times
 */
exports.processManualCleanupQueue = onSchedule({
    schedule: 'every 30 minutes',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY']
}, async () => {
    const pending = await db.collection('manual_cleanup_queue')
        .where('status', '==', 'pending')
        .where('attempts', '<', 5)
        .limit(10)
        .get();

    if (pending.empty) return;

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    for (const doc of pending.docs) {
        const { customerId, type, attempts } = doc.data();

        try {
            if (type === 'stripe_customer_deletion') {
                // Cancel all subs
                const subs = await stripe.subscriptions.list({
                    customer: customerId, status: 'all', limit: 100
                });
                for (const sub of subs.data) {
                    if (['active', 'trialing', 'past_due'].includes(sub.status)) {
                        await stripe.subscriptions.cancel(sub.id);
                    }
                }

                // Detach payment methods
                const pms = await stripe.paymentMethods.list({
                    customer: customerId, limit: 100
                });
                for (const pm of pms.data) {
                    await stripe.paymentMethods.detach(pm.id);
                }

                // Delete customer
                await stripe.customers.del(customerId);
            }

            await doc.ref.update({
                status: 'completed',
                completedAt: FieldValue.serverTimestamp()
            });

            console.log(`✅ Manual cleanup completed: ${customerId}`);

        } catch (error) {
            const newAttempts = (attempts || 0) + 1;
            await doc.ref.update({
                attempts: newAttempts,
                lastError: error.message,
                lastAttemptAt: FieldValue.serverTimestamp()
            });

            if (newAttempts >= 5) {
                await doc.ref.update({ status: 'failed' });
                console.error(`Manual cleanup FAILED after 5 attempts: ${customerId}`);
            }
        }
    }
});

// ============================================
// ORPHANED DOCUMENT CLEANUP
// ============================================

/**
 * Cleanup orphaned user docs (webhook-created stubs for deleted users)
 * Runs every 6 hours
 */
exports.cleanupOrphanedDocs = onSchedule('every 6 hours', async () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const admin = require('firebase-admin');

    const snapshot = await db.collection('users')
        .where('subscription.plan_status', 'in', ['cancelled', 'past_due'])
        .where('updatedAt', '<', oneDayAgo)
        .limit(100)
        .get();

    let cleaned = 0;

    for (const userDoc of snapshot.docs) {
        try {
            await admin.auth().getUser(userDoc.id);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                console.log('Cleaning up orphaned doc:', userDoc.id);
                await userDoc.ref.delete();
                cleaned++;
            }
        }
    }

    if (cleaned > 0) {
        console.log(`✅ Cleaned up ${cleaned} orphaned user documents`);
    }
});

// ============================================
// TTL CLEANUP — CRITICAL ERRORS
// ============================================

/**
 * Cleanup old critical errors (30 days resolved, 90 days unresolved → archive)
 * Runs daily at 4 AM UTC
 */
exports.cleanupOldCriticalErrors = onSchedule('0 4 * * *', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Delete resolved errors older than 30 days
    const resolvedSnap = await db.collection('critical_errors')
        .where('resolved', '==', true)
        .where('timestamp', '<', thirtyDaysAgo)
        .limit(500)
        .get();

    if (!resolvedSnap.empty) {
        const batch = db.batch();
        resolvedSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Deleted ${resolvedSnap.size} resolved critical errors`);
    }

    // Archive unresolved errors older than 90 days
    const unresolvedSnap = await db.collection('critical_errors')
        .where('resolved', '==', false)
        .where('timestamp', '<', ninetyDaysAgo)
        .limit(100)
        .get();

    if (!unresolvedSnap.empty) {
        const archiveBatch = db.batch();
        unresolvedSnap.docs.forEach(doc => {
            archiveBatch.set(
                db.collection('critical_errors_archive').doc(doc.id),
                { ...doc.data(), archivedAt: FieldValue.serverTimestamp() }
            );
            archiveBatch.delete(doc.ref);
        });
        await archiveBatch.commit();
        console.log(`Archived ${unresolvedSnap.size} old unresolved errors`);
    }
});

// ============================================
// TTL CLEANUP — SECURITY EVENTS
// ============================================

/**
 * Cleanup old security events (90 day TTL)
 * Runs daily at 4:30 AM UTC
 */
exports.cleanupSecurityEvents = onSchedule('30 4 * * *', async () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const snapshot = await db.collection('security_events')
        .where('timestamp', '<', ninetyDaysAgo)
        .limit(500)
        .get();

    if (!snapshot.empty) {
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Deleted ${snapshot.size} old security events`);
    }
});

// ============================================
// TTL CLEANUP — QUEUES & METRICS
// ============================================

/**
 * Cleanup old deletion jobs, manual cleanup jobs, and metrics
 * Runs daily at 5 AM UTC
 */
exports.cleanupQueuesAndMetrics = onSchedule('0 5 * * *', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Completed deletion jobs older than 7 days
    const delSnap = await db.collection('deletion_queue')
        .where('status', '==', 'completed')
        .where('completedAt', '<', sevenDaysAgo)
        .limit(500)
        .get();

    if (!delSnap.empty) {
        const b1 = db.batch();
        delSnap.docs.forEach(doc => b1.delete(doc.ref));
        await b1.commit();
        console.log(`Cleaned up ${delSnap.size} old deletion jobs`);
    }

    // Completed manual cleanup jobs older than 7 days
    const manSnap = await db.collection('manual_cleanup_queue')
        .where('status', '==', 'completed')
        .where('completedAt', '<', sevenDaysAgo)
        .limit(500)
        .get();

    if (!manSnap.empty) {
        const b2 = db.batch();
        manSnap.docs.forEach(doc => b2.delete(doc.ref));
        await b2.commit();
        console.log(`Cleaned up ${manSnap.size} old manual cleanup jobs`);
    }

    // Metrics older than 30 days
    const metSnap = await db.collection('metrics')
        .where('timestamp', '<', thirtyDaysAgo)
        .limit(500)
        .get();

    if (!metSnap.empty) {
        const b3 = db.batch();
        metSnap.docs.forEach(doc => b3.delete(doc.ref));
        await b3.commit();
        console.log(`Cleaned up ${metSnap.size} old metrics`);
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Delete all documents in a collection where userId matches (with pagination)
 */
async function deleteCollectionByUser(collectionName, userId, batchSize = 500) {
    let totalDeleted = 0;

    let hasMore = true;

    while (hasMore) {
        const snapshot = await db.collection(collectionName)
            .where('userId', '==', userId)
            .limit(batchSize)
            .get();

        if (snapshot.empty) break;

        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        totalDeleted += snapshot.size;

        hasMore = snapshot.size >= batchSize;
    }

    if (totalDeleted > 0) {
        console.log(`Deleted ${totalDeleted} from ${collectionName} for user ${userId}`);
    }
}

