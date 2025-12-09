/**
 * ZAS Safeguard - Cloud Functions Main Entry Point
 * 
 * Exports all Cloud Functions for the ZAS Safeguard platform.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp();

// Import function modules
const auth = require('./auth');
const subscription = require('./subscription');
const blocking = require('./blocking');
const override = require('./override');
const fraud = require('./fraud');
const ai = require('./ai');

// ============================================
// AUTH FUNCTIONS
// ============================================
exports.onUserCreate = auth.onUserCreate;
exports.verifyPhone = auth.verifyPhone;
exports.initializeDevice = auth.initializeDevice;

// ============================================
// SUBSCRIPTION FUNCTIONS
// ============================================
exports.createCheckoutSession = subscription.createCheckoutSession;
exports.stripeWebhook = subscription.stripeWebhook;
exports.checkTrialEligibility = subscription.checkTrialEligibility;
exports.getRegionalPrice = subscription.getRegionalPrice;
exports.handleTrialEnd = subscription.handleTrialEnd;

// ============================================
// BLOCKING FUNCTIONS
// ============================================
exports.getBlockPolicy = blocking.getBlockPolicy;
exports.syncBlocklist = blocking.syncBlocklist;
exports.logBlockEvent = blocking.logBlockEvent;
exports.updateCustomBlocklist = blocking.updateCustomBlocklist;

// ============================================
// OVERRIDE FUNCTIONS (Owner Mode Unlock)
// ============================================
exports.requestUnlock = override.requestUnlock;
exports.verifyUnlock = override.verifyUnlock;
exports.syncUnlockStatus = override.syncUnlockStatus;
exports.getUnlockStatus = override.getUnlockStatus;

// ============================================
// FRAUD DETECTION FUNCTIONS
// ============================================
exports.calculateFraudScore = fraud.calculateFraudScore;
exports.checkDeviceFingerprint = fraud.checkDeviceFingerprint;

// ============================================
// AI FUNCTIONS
// ============================================
exports.classifyContent = ai.classifyContent;
exports.generateRiskScore = ai.generateRiskScore;
exports.generateWeeklyReport = ai.generateWeeklyReport;

// ============================================
// SCHEDULED FUNCTIONS
// ============================================

// Check for expiring trials daily
exports.checkExpiringTrials = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
        const db = admin.firestore();
        const now = admin.firestore.Timestamp.now();
        const oneDayFromNow = new Date(now.toDate().getTime() + 24 * 60 * 60 * 1000);

        // Find trials ending in the next 24 hours
        const expiringTrials = await db.collection('users')
            .where('subscription.trial_active', '==', true)
            .where('subscription.trial_end', '<=', admin.firestore.Timestamp.fromDate(oneDayFromNow))
            .get();

        const notifications = expiringTrials.docs.map(async (doc) => {
            const user = doc.data();
            // Send notification (implement FCM or email here)
            console.log(`Trial expiring for user: ${doc.id}`);

            // Log the notification
            await db.collection('logs').add({
                userId: doc.id,
                type: 'notification',
                message: 'Trial expiring in 24 hours',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        });

        await Promise.all(notifications);
        return null;
    });

// Clean up old logs monthly
exports.cleanupOldLogs = functions.pubsub
    .schedule('every 30 days')
    .onRun(async (context) => {
        const db = admin.firestore();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const oldLogs = await db.collection('logs')
            .where('timestamp', '<', admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
            .limit(500)
            .get();

        const batch = db.batch();
        oldLogs.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        console.log(`Cleaned up ${oldLogs.size} old log entries`);
        return null;
    });
