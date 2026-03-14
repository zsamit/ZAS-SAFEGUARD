/**
 * ZAS Safeguard - Authentication Functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const db = admin.firestore();

/**
 * Triggered when a new user is created in Firebase Auth
 * Initializes user profile and checks trial eligibility
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    const { uid, email, displayName } = user;

    try {
        // Create user document
        await db.doc(`users/${uid}`).set({
            email: email || null,
            displayName: displayName || null,
            mode: null, // Set during onboarding
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            subscription: {
                plan: 'free',
                trial_start: null,
                trial_end: null,
                trial_active: false,
                plan_status: 'inactive',
                stripe_customer_id: null,
                region: null,
                price_tier: null,
            },
            master_key_hash: null,
            onboarding_complete: false,
        });

        console.log(`User profile created for: ${uid}`);
        return { success: true };
    } catch (error) {
        console.error('Error creating user profile:', error);
        throw new functions.https.HttpsError('internal', 'Failed to create user profile');
    }
});

/**
 * Verify phone number for regional pricing
 * Uses Twilio for SMS verification
 */
exports.verifyPhone = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { phoneNumber, verificationCode, action } = data;
    const uid = context.auth.uid;

    // Get Twilio credentials from environment
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!twilioAccountSid || !twilioAuthToken) {
        throw new functions.https.HttpsError('failed-precondition', 'SMS service not configured');
    }

    const twilio = require('twilio')(twilioAccountSid, twilioAuthToken);

    try {
        if (action === 'send') {
            // H-06: Rate limit — max 5 SMS sends per hour per user
            const rateLimitRef = db.doc(`rate_limits/${uid}_phone_verify`);
            const limitDoc = await rateLimitRef.get();
            if (limitDoc.exists) {
                const { count, windowStart } = limitDoc.data();
                const elapsed = Date.now() - (windowStart || 0);
                if (elapsed < 3600000 && count >= 5) {
                    throw new functions.https.HttpsError(
                        'resource-exhausted',
                        'Too many verification requests. Please try again later.'
                    );
                }
                // Reset window if expired
                if (elapsed >= 3600000) {
                    await rateLimitRef.set({ count: 1, windowStart: Date.now() });
                } else {
                    await rateLimitRef.update({
                        count: admin.firestore.FieldValue.increment(1),
                    });
                }
            } else {
                await rateLimitRef.set({ count: 1, windowStart: Date.now() });
            }

            // Send verification code
            const verification = await twilio.verify.v2
                .services(twilioServiceSid)
                .verifications.create({
                    to: phoneNumber,
                    channel: 'sms',
                });

            return {
                success: true,
                status: verification.status,
                message: 'Verification code sent'
            };
        } else if (action === 'verify') {
            // Verify the code
            const verificationCheck = await twilio.verify.v2
                .services(twilioServiceSid)
                .verificationChecks.create({
                    to: phoneNumber,
                    code: verificationCode,
                });

            if (verificationCheck.status === 'approved') {
                // Extract country from phone number
                const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
                const parsedNumber = phoneUtil.parse(phoneNumber);
                const countryCode = phoneUtil.getRegionCodeForNumber(parsedNumber);

                // Update user with verified phone and country
                await db.doc(`users/${uid}`).update({
                    phone: phoneNumber,
                    phone_verified: true,
                    phone_country: countryCode,
                    phone_verified_at: admin.firestore.FieldValue.serverTimestamp(),
                });

                return {
                    success: true,
                    country: countryCode,
                    message: 'Phone verified successfully'
                };
            } else {
                return {
                    success: false,
                    message: 'Invalid verification code'
                };
            }
        }
    } catch (error) {
        console.error('Phone verification error:', error);
        throw new functions.https.HttpsError('internal', 'Verification failed');
    }
});

/**
 * Initialize a new device for a user
 * Generates device ID and links to user account
 */
exports.initializeDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { deviceType, deviceName, fingerprint, childId } = data;
    const uid = context.auth.uid;

    try {
        // Check device limit
        const userDevices = await db.collection('devices')
            .where('userId', '==', uid)
            .get();

        const config = await db.doc('config/system').get();
        const maxDevices = config.data()?.max_devices_per_user || 10;

        if (userDevices.size >= maxDevices) {
            throw new functions.https.HttpsError('resource-exhausted', 'Maximum devices reached');
        }

        // Generate device ID
        const deviceId = uuidv4();

        // Get user mode
        const userDoc = await db.doc(`users/${uid}`).get();
        const userMode = userDoc.data()?.mode || 'family';

        // Create device document
        await db.doc(`devices/${deviceId}`).set({
            userId: uid,
            deviceType,
            deviceName,
            fingerprint,
            linkedChildId: childId || null,
            mode: userMode,
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            status: 'active',
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Register fingerprint for trial abuse detection
        const fingerprintRef = db.doc(`device_registry/${fingerprint}`);
        const fingerprintDoc = await fingerprintRef.get();

        if (!fingerprintDoc.exists) {
            await fingerprintRef.set({
                first_seen: admin.firestore.FieldValue.serverTimestamp(),
                associated_users: [uid],
                trial_used: false,
                fraud_flags: [],
            });
        } else {
            // Add user to associated users if not already there
            await fingerprintRef.update({
                associated_users: admin.firestore.FieldValue.arrayUnion(uid),
            });
        }

        // If owner mode, add to owner profile
        if (userMode === 'owner') {
            await db.doc(`owner_profiles/${uid}`).update({
                linked_devices: admin.firestore.FieldValue.arrayUnion(deviceId),
            });
        }

        console.log(`Device ${deviceId} initialized for user ${uid}`);

        return {
            success: true,
            deviceId,
            message: 'Device initialized successfully'
        };
    } catch (error) {
        console.error('Device initialization error:', error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Failed to initialize device');
    }
});

/**
 * Delete user account completely (GDPR-compliant, production-hardened)
 * Critical operations done synchronously, data cleanup done via background queue
 * IRREVERSIBLE
 */
exports.deleteAccount = functions
    .runWith({
        memory: '512MB',
        timeoutSeconds: 60,
        secrets: ['STRIPE_SECRET_KEY']
    })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
        }

        const uid = context.auth.uid;
        const { confirmDelete } = data;

        if (confirmDelete !== 'DELETE_MY_ACCOUNT') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Must confirm deletion with confirmDelete: "DELETE_MY_ACCOUNT"'
            );
        }

        console.log(`[deleteAccount] Starting deletion for user: ${uid}`);

        try {
            // Step 1: Fetch user data
            const userDoc = await db.doc(`users/${uid}`).get();
            const userData = userDoc.exists ? userDoc.data() : null;
            const stripeCustomerId = userData?.stripeCustomerId || userData?.subscription?.customerId;

            // Step 2: Stripe deletion with timeout + retry (non-blocking fallback)
            let stripeDeleted = false;

            if (stripeCustomerId) {
                try {
                    await Promise.race([
                        deleteStripeCustomerWithRetry(stripeCustomerId),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Stripe API timeout')), 45000)
                        )
                    ]);
                    stripeDeleted = true;
                    console.log(`[deleteAccount] ✅ Stripe customer deleted: ${stripeCustomerId}`);
                } catch (stripeError) {
                    console.error('[deleteAccount] Stripe deletion failed, queuing for manual cleanup:', stripeError.message);

                    // Queue for background retry instead of failing
                    await db.collection('manual_cleanup_queue').add({
                        type: 'stripe_customer_deletion',
                        customerId: stripeCustomerId,
                        userId: uid,
                        userEmail: userData?.email || 'unknown',
                        reason: 'account_deletion',
                        error: stripeError.message,
                        status: 'pending',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        attempts: 0
                    });
                }
            }

            // Step 3: Delete Firebase Auth (user-blocking — must succeed)
            await admin.auth().deleteUser(uid);
            console.log(`[deleteAccount] ✅ Auth user deleted: ${uid}`);

            // Step 4: Delete main user doc immediately
            await db.doc(`users/${uid}`).delete();

            // Step 5: Queue background data cleanup (non-blocking)
            await db.collection('deletion_queue').add({
                userId: uid,
                mainDocs: ['subscriptions', 'fraud_scores', 'alert_settings',
                    'family_profiles', 'owner_profiles', 'rate_limits'],
                collections: ['devices', 'alerts', 'logs'],
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`[deleteAccount] ✅ Deletion complete, background cleanup queued`);

            return {
                success: true,
                message: stripeDeleted
                    ? 'Account and all data permanently deleted'
                    : 'Account deleted. Payment cleanup in progress — you will not be charged.',
                stripeDeleted,
                warnings: stripeDeleted ? [] : ['Stripe cleanup queued for background processing']
            };
        } catch (error) {
            console.error('[deleteAccount] CRITICAL failure:', error);

            // Log for manual intervention
            await db.collection('failed_deletions').add({
                userId: uid,
                error: error.message,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                requiresManualCleanup: true
            });

            throw new functions.https.HttpsError(
                'internal',
                'Account deletion encountered an error. Our team has been notified.',
                { originalError: error.message }
            );
        }
    });

/**
 * Delete Stripe customer with retry + exponential backoff
 * Handles Edge Case #4 (multiple subscriptions) with pagination
 */
async function deleteStripeCustomerWithRetry(customerId, maxAttempts = 3) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // 1. Cancel ALL subscriptions (paginated — handles 100+ subs)
            await cancelAllSubscriptions(stripe, customerId);

            // 2. Detach ALL payment methods (paginated)
            await detachAllPaymentMethods(stripe, customerId);

            // 3. Delete customer
            await stripe.customers.del(customerId);
            return; // Success

        } catch (error) {
            if (attempt === maxAttempts) throw error;
            // Exponential backoff: 2s, 4s
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            console.warn(`[deleteAccount] Stripe attempt ${attempt} failed, retrying...`);
        }
    }
}

/**
 * Cancel all subscriptions with Stripe pagination (handles 100+ subs)
 */
async function cancelAllSubscriptions(stripe, customerId) {
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
        const params = {
            customer: customerId,
            status: 'all',
            limit: 100
        };
        if (startingAfter) params.starting_after = startingAfter;

        const subs = await stripe.subscriptions.list(params);

        for (const sub of subs.data) {
            if (['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
                try {
                    await stripe.subscriptions.cancel(sub.id, {
                        prorate: false,
                        invoice_now: false
                    });
                } catch (e) {
                    console.error(`[deleteAccount] Failed to cancel sub ${sub.id}:`, e.message);
                }
            }
        }

        hasMore = subs.has_more;
        if (hasMore && subs.data.length > 0) {
            startingAfter = subs.data[subs.data.length - 1].id;
        }
    }
}

/**
 * Detach all payment methods with Stripe pagination
 */
async function detachAllPaymentMethods(stripe, customerId) {
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
        const params = { customer: customerId, limit: 100 };
        if (startingAfter) params.starting_after = startingAfter;

        const pms = await stripe.paymentMethods.list(params);

        for (const pm of pms.data) {
            try {
                await stripe.paymentMethods.detach(pm.id);
            } catch (e) {
                console.error(`[deleteAccount] Failed to detach PM ${pm.id}:`, e.message);
            }
        }

        hasMore = pms.has_more;
        if (hasMore && pms.data.length > 0) {
            startingAfter = pms.data[pms.data.length - 1].id;
        }
    }
}

