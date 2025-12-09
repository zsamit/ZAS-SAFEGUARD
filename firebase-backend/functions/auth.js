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
