/**
 * ZAS Safeguard - Override Functions
 * Handles Owner Mode unlock flow with 30-minute cooldown
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const CryptoJS = require('crypto-js');

const db = admin.firestore();

// Anti-temptation messages shown during cooldown
const ANTI_TEMPTATION_MESSAGES = [
    "Take a deep breath. This urge will pass.",
    "Think about why you installed this protection.",
    "You are stronger than this moment.",
    "30 minutes isn't long - use it to reflect.",
    "Every time you resist, you become stronger.",
    "Your future self will thank you for waiting.",
    "This is a test of willpower - you can pass it.",
    "Remember your goals and the person you want to be.",
    "Call a friend or go for a walk.",
    "This feeling is temporary. Your goals are permanent.",
    "You've come this far. Don't give up now.",
    "Use this time to do something productive.",
];

/**
 * Request unlock - starts 30-minute cooldown
 */
exports.requestUnlock = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { deviceId } = data;
    const uid = context.auth.uid;

    try {
        // Verify user is in owner mode
        const userDoc = await db.doc(`users/${uid}`).get();
        if (!userDoc.exists || userDoc.data().mode !== 'owner') {
            throw new functions.https.HttpsError('permission-denied', 'Owner mode required');
        }

        // Check for existing pending request
        const existingRequests = await db.collection('override_requests')
            .where('userId', '==', uid)
            .where('status', 'in', ['pending', 'cooling', 'ready'])
            .get();

        if (!existingRequests.empty) {
            const existing = existingRequests.docs[0];
            const existingData = existing.data();

            return {
                success: false,
                existingRequest: true,
                requestId: existing.id,
                status: existingData.status,
                cooldownEndsAt: existingData.cooldownEndsAt?.toDate(),
                message: 'Unlock request already in progress',
            };
        }

        // Get system config for cooldown duration
        const config = await db.doc('config/system').get();
        const cooldownMinutes = config.data()?.unlock_cooldown_minutes || 30;

        // Calculate cooldown end time
        const now = admin.firestore.Timestamp.now();
        const cooldownEndsAt = new admin.firestore.Timestamp(
            now.seconds + (cooldownMinutes * 60),
            now.nanoseconds
        );

        // Create override request
        const requestRef = await db.collection('override_requests').add({
            userId: uid,
            deviceId,
            status: 'cooling',
            requestedAt: now,
            cooldownEndsAt,
            completedAt: null,
            attempt_count: 0,
            synced_devices: [deviceId],
        });

        // Update owner profile with current request
        await db.doc(`owner_profiles/${uid}`).update({
            current_unlock_request: requestRef.id,
        });

        // Log the unlock request
        await db.collection('logs').add({
            userId: uid,
            deviceId,
            type: 'unlock_request',
            message: 'Owner mode unlock requested - 30 min cooldown started',
            timestamp: now,
        });

        // Get random anti-temptation message
        const messageIndex = Math.floor(Math.random() * ANTI_TEMPTATION_MESSAGES.length);

        return {
            success: true,
            requestId: requestRef.id,
            status: 'cooling',
            cooldownEndsAt: cooldownEndsAt.toDate(),
            cooldownMinutes,
            antiTemptationMessage: ANTI_TEMPTATION_MESSAGES[messageIndex],
            allMessages: ANTI_TEMPTATION_MESSAGES,
        };
    } catch (error) {
        console.error('Request unlock error:', error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Failed to request unlock');
    }
});

/**
 * Verify unlock with 60-character master key
 */
exports.verifyUnlock = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { requestId, masterKey } = data;
    const uid = context.auth.uid;

    try {
        // Validate master key length
        if (!masterKey || masterKey.length < 60) {
            // Log failed attempt
            await db.collection('logs').add({
                userId: uid,
                type: 'unlock_failed',
                message: 'Master key too short',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

            return {
                success: false,
                message: 'Master key must be at least 60 characters',
            };
        }

        // Get the override request
        const requestDoc = await db.doc(`override_requests/${requestId}`).get();
        if (!requestDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Request not found');
        }

        const requestData = requestDoc.data();

        // Verify ownership
        if (requestData.userId !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Not your request');
        }

        // Check if cooldown has ended
        const now = admin.firestore.Timestamp.now();
        if (requestData.cooldownEndsAt.seconds > now.seconds) {
            const remainingSeconds = requestData.cooldownEndsAt.seconds - now.seconds;
            const remainingMinutes = Math.ceil(remainingSeconds / 60);

            return {
                success: false,
                message: `Cooldown not complete. ${remainingMinutes} minutes remaining.`,
                remainingMinutes,
            };
        }

        // Get owner profile and verify master key
        const ownerProfile = await db.doc(`owner_profiles/${uid}`).get();
        if (!ownerProfile.exists) {
            throw new functions.https.HttpsError('not-found', 'Owner profile not found');
        }

        const storedHash = ownerProfile.data().master_key_hash;
        const inputHash = CryptoJS.SHA256(masterKey).toString();

        // H-01: Brute-force limit — lock after 5 wrong attempts
        const MAX_ATTEMPTS = 5;
        if (requestData.attempt_count >= MAX_ATTEMPTS) {
            await db.doc(`override_requests/${requestId}`).update({
                status: 'locked',
            });
            return {
                success: false,
                message: 'Too many attempts. Start a new unlock request.',
                locked: true,
            };
        }

        // Increment attempt count
        await db.doc(`override_requests/${requestId}`).update({
            attempt_count: admin.firestore.FieldValue.increment(1),
        });

        if (inputHash !== storedHash) {
            // Log failed attempt
            await db.collection('logs').add({
                userId: uid,
                type: 'unlock_failed',
                message: 'Invalid master key',
                attemptCount: requestData.attempt_count + 1,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

            return {
                success: false,
                message: 'Invalid master key',
                attemptsUsed: requestData.attempt_count + 1,
            };
        }

        // Success! Update request status
        await db.doc(`override_requests/${requestId}`).update({
            status: 'completed',
            completedAt: now,
        });

        // Clear current unlock request from owner profile
        await db.doc(`owner_profiles/${uid}`).update({
            current_unlock_request: null,
        });

        // Log successful unlock
        await db.collection('logs').add({
            userId: uid,
            type: 'unlock_success',
            message: 'Owner mode temporarily unlocked',
            timestamp: now,
        });

        // Sync unlock status to all owner devices
        const ownerDevices = ownerProfile.data().linked_devices || [];
        await syncUnlockToDevices(uid, ownerDevices, requestId);

        return {
            success: true,
            message: 'Unlock successful',
            unlockedAt: now.toDate(),
        };
    } catch (error) {
        console.error('Verify unlock error:', error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Failed to verify unlock');
    }
});

/**
 * Sync unlock status to all owner devices
 */
async function syncUnlockToDevices(userId, deviceIds, requestId) {
    const batch = db.batch();

    for (const deviceId of deviceIds) {
        const deviceRef = db.doc(`devices/${deviceId}`);
        batch.update(deviceRef, {
            unlock_synced: true,
            unlock_request_id: requestId,
            unlock_synced_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    await batch.commit();
    console.log(`Unlock synced to ${deviceIds.length} devices for user ${userId}`);
}

exports.syncUnlockStatus = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = context.auth.uid;

    try {
        // Get owner profile
        const ownerProfile = await db.doc(`owner_profiles/${uid}`).get();
        if (!ownerProfile.exists) {
            return { synced: false, message: 'Not in owner mode' };
        }

        const linkedDevices = ownerProfile.data().linked_devices || [];
        const currentRequest = ownerProfile.data().current_unlock_request;

        if (currentRequest) {
            await syncUnlockToDevices(uid, linkedDevices, currentRequest);
            return { synced: true, deviceCount: linkedDevices.length };
        }

        return { synced: false, message: 'No active unlock request' };
    } catch (error) {
        console.error('Sync unlock status error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to sync unlock status');
    }
});

/**
 * Get current unlock status
 */
exports.getUnlockStatus = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = context.auth.uid;

    try {
        // Check for active unlock request
        const activeRequests = await db.collection('override_requests')
            .where('userId', '==', uid)
            .where('status', 'in', ['cooling', 'ready'])
            .orderBy('requestedAt', 'desc')
            .limit(1)
            .get();

        if (activeRequests.empty) {
            return {
                hasActiveRequest: false,
                status: 'none',
            };
        }

        const request = activeRequests.docs[0];
        const requestData = request.data();
        const now = admin.firestore.Timestamp.now();

        // Check if cooldown has ended
        const cooldownEnded = requestData.cooldownEndsAt.seconds <= now.seconds;

        if (cooldownEnded && requestData.status === 'cooling') {
            // Update status to ready
            await db.doc(`override_requests/${request.id}`).update({
                status: 'ready',
            });
        }

        const remainingSeconds = Math.max(0, requestData.cooldownEndsAt.seconds - now.seconds);
        const randomMessage = ANTI_TEMPTATION_MESSAGES[
            Math.floor(Math.random() * ANTI_TEMPTATION_MESSAGES.length)
        ];

        return {
            hasActiveRequest: true,
            requestId: request.id,
            status: cooldownEnded ? 'ready' : 'cooling',
            cooldownEndsAt: requestData.cooldownEndsAt.toDate(),
            remainingSeconds,
            attemptCount: requestData.attempt_count,
            antiTemptationMessage: randomMessage,
        };
    } catch (error) {
        console.error('Get unlock status error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get unlock status');
    }
});
