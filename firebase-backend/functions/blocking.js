/**
 * ZAS Safeguard - Blocking Functions
 * Handles block policies, blocklist sync, and event logging
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

// Runtime config for memory-intensive functions
const runtimeOpts = {
    timeoutSeconds: 60,
    memory: '512MB'
};

/**
 * Get active block policy for a device
 */
exports.getBlockPolicy = functions.runWith(runtimeOpts).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { deviceId } = data;
    const uid = context.auth.uid;

    try {
        // Get device info
        const deviceDoc = await db.doc(`devices/${deviceId}`).get();
        if (!deviceDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Device not found');
        }

        const device = deviceDoc.data();

        // Verify ownership
        if (device.userId !== uid) {
            // Check if user is parent of linked child
            if (device.linkedChildId) {
                const childDoc = await db.doc(`children/${device.linkedChildId}`).get();
                if (!childDoc.exists || childDoc.data().parentUid !== uid) {
                    throw new functions.https.HttpsError('permission-denied', 'Not authorized');
                }
            } else {
                throw new functions.https.HttpsError('permission-denied', 'Not authorized');
            }
        }

        // Get user data for mode
        const userDoc = await db.doc(`users/${uid}`).get();
        const userData = userDoc.data();
        const userMode = device.mode || userData.mode;

        // Get global blocklist
        const globalBlocklist = await db.doc('blocklists/global').get();
        const globalDomains = globalBlocklist.data();

        // Build policy based on mode
        let policy = {
            deviceId,
            mode: userMode,
            lastUpdated: admin.firestore.Timestamp.now(),
            blockedDomains: [],
            blockedKeywords: [],
            allowedDomains: [],
            categories: {},
        };

        if (userMode === 'owner') {
            // Owner mode: Ultra-strict, all categories enforced
            const ownerProfile = await db.doc(`owner_profiles/${uid}`).get();
            const ownerData = ownerProfile.exists ? ownerProfile.data() : {};

            policy.ultra_strict = true;
            policy.allow_disable = false;
            policy.allow_uninstall = false;

            // Add all blocked categories
            policy.blockedDomains = [
                ...(globalDomains.porn || []),
                ...(globalDomains.gambling || []),
                ...(globalDomains.violence || []),
            ];

            policy.categories = {
                porn: { enabled: true, locked: true },
                gambling: { enabled: true, locked: false },
                social_media: { enabled: ownerData.block_social || false, locked: false },
                gaming: { enabled: ownerData.block_gaming || false, locked: false },
            };

            // Get custom blocklist
            const customBlocklist = await db.doc(`blocklists/custom/${uid}`).get();
            if (customBlocklist.exists) {
                policy.blockedDomains.push(...(customBlocklist.data().blocked || []));
                policy.allowedDomains = customBlocklist.data().allowed || [];
            }

        } else if (device.linkedChildId) {
            // Child device: Apply child-specific rules
            const childDoc = await db.doc(`children/${device.linkedChildId}`).get();
            const childData = childDoc.data();

            // Porn is always blocked for children
            policy.blockedDomains = [...(globalDomains.porn || [])];

            // Add categories blocked for this child
            for (const category of (childData.block_categories || [])) {
                if (globalDomains[category]) {
                    policy.blockedDomains.push(...globalDomains[category]);
                }
            }

            // Add custom blocklist
            policy.blockedDomains.push(...(childData.custom_blocklist || []));
            policy.allowedDomains = childData.custom_allowlist || [];

            // Schedule
            policy.schedule = childData.schedule || null;

            policy.categories = {
                porn: { enabled: true, locked: true },
            };

        } else {
            // Standard family mode
            policy.blockedDomains = [...(globalDomains.porn || [])];
            policy.categories = {
                porn: { enabled: true, locked: true },
            };
        }

        // Update device last seen
        await db.doc(`devices/${deviceId}`).update({
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            policy,
            // Include subscription info so extension knows user's plan
            subscription: {
                plan: userData?.subscription?.plan || 'free',
                status: userData?.subscription?.status || 'trial'
            },
            // Include lock status for command execution
            commands: {
                childLocked: userData?.childLocked || false,
                lockTime: userData?.childLockTime?.toDate?.()?.toISOString() || null
            }
        };
    } catch (error) {
        console.error('Get block policy error:', error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Failed to get block policy');
    }
});

/**
 * Sync blocklist updates to devices (called when blocklist changes)
 */
exports.syncBlocklist = functions.firestore
    .document('blocklists/{type}')
    .onWrite(async (change, context) => {
        const type = context.params.type;

        console.log(`Blocklist ${type} updated, notifying devices...`);

        // For global blocklist updates, we'd typically use FCM
        // to push updates to all connected devices

        if (type === 'global') {
            // Log the sync event
            await db.collection('logs').add({
                type: 'blocklist_sync',
                message: `Global blocklist updated`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        return null;
    });

/**
 * Log a block event from a device
 */
exports.logBlockEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { deviceId, url, category, action, metadata } = data;
    const uid = context.auth.uid;

    try {
        // Validate device ownership
        const deviceDoc = await db.doc(`devices/${deviceId}`).get();
        if (!deviceDoc.exists || deviceDoc.data().userId !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Invalid device');
        }

        // Create log entry
        await db.collection('logs').add({
            userId: uid,
            deviceId,
            type: 'block',
            url,
            category,
            action,
            metadata: metadata || {},
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update device last seen
        await db.doc(`devices/${deviceId}`).update({
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { success: true };
    } catch (error) {
        console.error('Log block event error:', error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Failed to log event');
    }
});

/**
 * Update user's custom blocklist
 */
exports.updateCustomBlocklist = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { action, domain, type } = data; // type: 'blocked' or 'allowed'
    const uid = context.auth.uid;

    try {
        const blocklistRef = db.doc(`blocklists/custom/${uid}`);
        const field = type === 'allowed' ? 'allowed' : 'blocked';

        if (action === 'add') {
            await blocklistRef.set({
                [field]: admin.firestore.FieldValue.arrayUnion(domain),
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        } else if (action === 'remove') {
            await blocklistRef.update({
                [field]: admin.firestore.FieldValue.arrayRemove(domain),
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        return { success: true };
    } catch (error) {
        console.error('Update custom blocklist error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to update blocklist');
    }
});
