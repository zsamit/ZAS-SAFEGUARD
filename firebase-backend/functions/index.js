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
const version = require('./version');
const cleanup = require('./cleanup');
const alerts = require('./alerts');
const urlReputation = require('./urlReputation');
const weeklyReport = require('./weeklyReport');
const parentPin = require('./parentPin');
const heartbeat = require('./heartbeat');
const adblock = require('./adblock');
const dataCleanup = require('./dataCleanup');
const dailyDigest = require('./dailyDigest');
const verifySub = require('./verifySubscription');

// ============================================
// URL REPUTATION FUNCTIONS
// ============================================
exports.checkUrlReputation = urlReputation.checkUrlReputation;
exports.logUrlScan = urlReputation.logUrlScan;
exports.cleanupOldUrlScans = urlReputation.cleanupOldUrlScans;

// ============================================
// ALERT FUNCTIONS
// ============================================
exports.onSecurityEvent = alerts.onSecurityEvent;
// REMOVED: exports.checkHeartbeats - Legacy spammy heartbeat disabled. Use checkHeartbeatsV2 only.
exports.logSecurityEvent = alerts.logSecurityEvent;
exports.logSecurityEventHttp = alerts.logSecurityEventHttp;  // HTTP version for extension
exports.testEmail = alerts.testEmail;  // Test email endpoint
exports.getAlerts = alerts.getAlerts;
exports.updateAlertSettings = alerts.updateAlertSettings;
exports.markAlertRead = alerts.markAlertRead;

// ============================================
// VERSION FUNCTIONS
// ============================================
exports.getVersion = version.getVersion;
exports.incrementVersion = version.incrementVersion;
exports.checkVersion = version.checkVersion;
exports.versionCheck = version.versionCheck;

// ============================================
// CLEANUP & RATE LIMITING FUNCTIONS
// ============================================
exports.cleanupOldLogsV2 = cleanup.cleanupOldLogs;
exports.checkRateLimit = cleanup.checkRateLimit;
exports.logErrors = cleanup.logErrors;
exports.archiveUserData = cleanup.archiveUserData;

// Background processing & TTL cleanup
exports.processDeletionQueue = cleanup.processDeletionQueue;
exports.processManualCleanupQueue = cleanup.processManualCleanupQueue;
exports.cleanupOrphanedDocs = cleanup.cleanupOrphanedDocs;
exports.cleanupOldCriticalErrors = cleanup.cleanupOldCriticalErrors;
exports.cleanupSecurityEvents = cleanup.cleanupSecurityEvents;
exports.cleanupQueuesAndMetrics = cleanup.cleanupQueuesAndMetrics;

// ============================================
// AUTH FUNCTIONS
// ============================================
exports.onUserCreate = auth.onUserCreate;
exports.verifyPhone = auth.verifyPhone;
exports.initializeDevice = auth.initializeDevice;
exports.deleteAccount = auth.deleteAccount;
exports.verifySubscription = verifySub.verifySubscription;  // Server-side subscription verification

// ============================================
// SUBSCRIPTION FUNCTIONS
// ============================================
exports.createCheckoutSession = subscription.createCheckoutSession;
exports.createSubscriptionIntent = subscription.createSubscriptionIntent;
exports.stripeWebhook = subscription.stripeWebhook;
exports.checkTrialEligibility = subscription.checkTrialEligibility;
exports.getRegionalPrice = subscription.getRegionalPrice;
exports.handleTrialEnd = subscription.handleTrialEnd;
exports.createPortalSession = subscription.createPortalSession;  // NEW: Stripe customer portal
exports.getInvoices = subscription.getInvoices;  // NEW: Get user's invoices
exports.getSubscription = subscription.getSubscription;  // NEW: Get real plan status

// ============================================
// BLOCKING FUNCTIONS
// ============================================
exports.getBlockPolicy = blocking.getBlockPolicy;
exports.syncBlocklist = blocking.syncBlocklist;
exports.logBlockEvent = blocking.logBlockEvent;
exports.logBlockEventHttp = blocking.logBlockEventHttp;  // HTTP version for extension
exports.updateCustomBlocklist = blocking.updateCustomBlocklist;

// ============================================
// OVERRIDE FUNCTIONS (Owner Mode Unlock)
// ============================================
exports.requestUnlock = override.requestUnlock;
exports.verifyUnlock = override.verifyUnlock;
exports.syncUnlockStatus = override.syncUnlockStatus;
exports.getUnlockStatus = override.getUnlockStatus;

// ============================================
// PARENT PIN FUNCTIONS (Lock Device Security)
// ============================================
exports.setParentPin = parentPin.setParentPin;
exports.verifyParentPin = parentPin.verifyParentPin;
exports.executeLockAction = parentPin.executeLockAction;
exports.checkParentPinStatus = parentPin.checkParentPinStatus;

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
exports.analyzeContentForAdult = ai.analyzeContentForAdult;

// ============================================
// SCHEDULED FUNCTIONS
// ============================================
exports.sendWeeklySummary = weeklyReport.sendWeeklySummary;
exports.sendDailyDigest = dailyDigest.sendDailyDigest;  // Daily morning summary
exports.testDailyDigest = dailyDigest.testDailyDigest;  // Test endpoint

// ============================================
// HEARTBEAT & OFFLINE DETECTION (Zero-Spam)
// ============================================
// Note: checkHeartbeats (1st gen) is deprecated, use checkHeartbeatsV2
exports.checkHeartbeatsV2 = heartbeat.checkHeartbeatsV2;   // NEW - 2nd gen with spam prevention
exports.registerDevice = heartbeat.registerDevice;  // Register device on login
exports.updateDeviceStatus = heartbeat.updateDeviceStatus;  // Graceful offline signal
exports.sendOfflineDigest = heartbeat.sendOfflineDigest;    // Daily digest (not instant spam)

// ============================================
// AD BLOCKER FUNCTIONS
// ============================================
exports.getAdblockSettings = adblock.getAdblockSettings;
exports.updateAdblockSettings = adblock.updateAdblockSettings;
exports.logAdblockStats = adblock.logAdblockStats;
exports.getAdblockSiteModes = adblock.getAdblockSiteModes;
exports.updateAdblockSiteMode = adblock.updateAdblockSiteMode;
exports.getAdblockStatsSummary = adblock.getAdblockStatsSummary;

// ============================================
// OTHER SCHEDULED FUNCTIONS
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

// ============================================
// DATA CLEANUP (Cost Optimization)
// ============================================
exports.dailyCleanup = dataCleanup.dailyCleanup;           // 3 AM UTC - cleans logs, caps, digest_queue
exports.weeklyDeepCleanup = dataCleanup.weeklyDeepCleanup; // Sunday 4 AM UTC - deep clean security_events

// Note: cleanupOldLogs is exported from cleanup.js as cleanupOldLogsV2
// It runs daily at 3 AM UTC and cleans up logs older than 30 days

