/**
 * ZAS Safeguard - Parent PIN Functions
 * Server-side PIN verification to prevent client-side bypass
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

// Runtime config for crypto-heavy functions
const runtimeOpts = {
    timeoutSeconds: 30,
    memory: '512MB'
};

/**
 * Hash PIN with salt for secure storage
 */
function hashPin(pin, salt) {
    return crypto.pbkdf2Sync(pin, salt, 10000, 64, 'sha512').toString('hex');
}

/**
 * Set Parent PIN - Called from dashboard when parent sets up PIN
 */
exports.setParentPin = functions.runWith(runtimeOpts).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { pin } = data;
    const uid = context.auth.uid;

    // Validate PIN format (4-6 digits)
    if (!pin || !/^\d{4,6}$/.test(pin)) {
        throw new functions.https.HttpsError('invalid-argument', 'PIN must be 4-6 digits');
    }

    try {
        // Generate salt and hash PIN
        const salt = crypto.randomBytes(16).toString('hex');
        const hashedPin = hashPin(pin, salt);

        // Store in user document (NOT in extension storage - can't be read client-side)
        await db.doc(`users/${uid}`).update({
            'security.parentPinHash': hashedPin,
            'security.parentPinSalt': salt,
            'security.parentPinSet': true,
            'security.parentPinUpdatedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[ParentPIN] PIN set for user ${uid}`);

        return { success: true, message: 'Parent PIN has been set' };
    } catch (error) {
        console.error('[ParentPIN] Error setting PIN:', error);
        throw new functions.https.HttpsError('internal', 'Failed to set PIN');
    }
});

/**
 * Verify Parent PIN - Called when locking/unlocking device
 * Returns a time-limited token if PIN is correct
 */
exports.verifyParentPin = functions.runWith(runtimeOpts).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { pin, action } = data; // action: 'lock' or 'unlock'
    const uid = context.auth.uid;

    if (!pin) {
        throw new functions.https.HttpsError('invalid-argument', 'PIN is required');
    }

    try {
        // Get stored PIN hash
        const userDoc = await db.doc(`users/${uid}`).get();
        const userData = userDoc.data();

        if (!userData?.security?.parentPinSet) {
            throw new functions.https.HttpsError('failed-precondition', 'Parent PIN not set');
        }

        // Verify PIN
        const hashedInput = hashPin(pin, userData.security.parentPinSalt);

        if (hashedInput !== userData.security.parentPinHash) {
            // Log failed attempt
            await db.collection('security_events').add({
                userId: uid,
                eventType: 'PIN_FAILED',
                details: { action, message: 'Incorrect Parent PIN entered' },
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            throw new functions.https.HttpsError('permission-denied', 'Incorrect PIN');
        }

        // PIN correct - generate time-limited verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes

        // Store verification token
        await db.doc(`users/${uid}`).update({
            'security.pinVerificationToken': verificationToken,
            'security.pinVerificationExpires': expiresAt,
            'security.pinVerificationAction': action
        });

        console.log(`[ParentPIN] PIN verified for user ${uid}, action: ${action}`);

        return {
            success: true,
            verificationToken,
            expiresAt,
            action
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error('[ParentPIN] Error verifying PIN:', error);
        throw new functions.https.HttpsError('internal', 'Failed to verify PIN');
    }
});

/**
 * Execute Lock/Unlock with verification token
 * This is the actual lock/unlock - requires valid token from verifyParentPin
 */
exports.executeLockAction = functions.runWith(runtimeOpts).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { verificationToken, action, deviceId } = data;
    const uid = context.auth.uid;

    if (!verificationToken) {
        throw new functions.https.HttpsError('invalid-argument', 'Verification token required');
    }

    try {
        // Verify token
        const userDoc = await db.doc(`users/${uid}`).get();
        const userData = userDoc.data();

        const storedToken = userData?.security?.pinVerificationToken;
        const expiresAt = userData?.security?.pinVerificationExpires;
        const storedAction = userData?.security?.pinVerificationAction;

        if (!storedToken || storedToken !== verificationToken) {
            throw new functions.https.HttpsError('permission-denied', 'Invalid verification token');
        }

        if (Date.now() > expiresAt) {
            throw new functions.https.HttpsError('permission-denied', 'Verification token expired');
        }

        if (storedAction !== action) {
            throw new functions.https.HttpsError('permission-denied', 'Token action mismatch');
        }

        // Clear verification token (one-time use)
        await db.doc(`users/${uid}`).update({
            'security.pinVerificationToken': admin.firestore.FieldValue.delete(),
            'security.pinVerificationExpires': admin.firestore.FieldValue.delete(),
            'security.pinVerificationAction': admin.firestore.FieldValue.delete()
        });

        // Execute the lock/unlock action
        const isLocking = action === 'lock';

        await db.doc(`users/${uid}`).update({
            childLocked: isLocking,
            childLockTime: isLocking ? admin.firestore.FieldValue.serverTimestamp() : null,
            lastLockAction: action,
            lastLockActionAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Log security event
        await db.collection('security_events').add({
            userId: uid,
            deviceId: deviceId || 'dashboard',
            eventType: isLocking ? 'DEVICE_LOCKED' : 'DEVICE_UNLOCKED',
            details: {
                action,
                method: 'parent_pin',
                message: isLocking ? 'Device locked by parent' : 'Device unlocked by parent'
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[ParentPIN] Device ${action}ed for user ${uid}`);

        return {
            success: true,
            locked: isLocking,
            message: isLocking ? 'Device locked!' : 'Device unlocked!'
        };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error('[ParentPIN] Error executing lock action:', error);
        throw new functions.https.HttpsError('internal', 'Failed to execute action');
    }
});

/**
 * Check if Parent PIN is set (for UI to know whether to show setup vs verify)
 */
exports.checkParentPinStatus = functions.runWith(runtimeOpts).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = context.auth.uid;

    try {
        const userDoc = await db.doc(`users/${uid}`).get();
        const userData = userDoc.data();

        return {
            pinSet: userData?.security?.parentPinSet || false,
            locked: userData?.childLocked || false
        };
    } catch (error) {
        console.error('[ParentPIN] Error checking status:', error);
        throw new functions.https.HttpsError('internal', 'Failed to check status');
    }
});
