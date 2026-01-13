/**
 * ZAS Safeguard - Daily Digest Email
 * Sends daily morning summary of yesterday's activity
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

// Runtime config
const runtimeOpts = {
    timeoutSeconds: 300,
    memory: '512MB'
};

/**
 * Daily Digest Email - Runs every day at 8:00 AM PST
 * Aggregates yesterday's: ads blocked, sites blocked, security alerts
 */
exports.sendDailyDigest = functions.runWith(runtimeOpts).pubsub
    .schedule('0 8 * * *')
    .timeZone('America/Los_Angeles')
    .onRun(async (context) => {
        console.log('[DailyDigest] Starting daily digest generation...');

        try {
            // Get all users who have daily digest enabled
            const usersSnapshot = await db.collection('users')
                .where('settings.dailyDigestEnabled', '==', true)
                .get();

            console.log(`[DailyDigest] Found ${usersSnapshot.size} users with daily digest enabled`);

            // Calculate yesterday's date range
            const now = new Date();
            const yesterdayStart = new Date(now);
            yesterdayStart.setDate(yesterdayStart.getDate() - 1);
            yesterdayStart.setHours(0, 0, 0, 0);

            const yesterdayEnd = new Date(now);
            yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
            yesterdayEnd.setHours(23, 59, 59, 999);

            let successCount = 0;
            let errorCount = 0;

            for (const userDoc of usersSnapshot.docs) {
                const userId = userDoc.id;
                const userData = userDoc.data();
                const email = userData.email;

                if (!email) continue;

                try {
                    // Get log events from yesterday
                    const logsSnapshot = await db.collection('logs')
                        .where('userId', '==', userId)
                        .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(yesterdayStart))
                        .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(yesterdayEnd))
                        .get();

                    // Aggregate stats
                    let adsBlocked = 0;
                    let sitesBlocked = 0;
                    let totalCount = 0;

                    logsSnapshot.docs.forEach(doc => {
                        const log = doc.data();
                        totalCount += log.count || 1;
                        if (log.action === 'ad_blocked') {
                            adsBlocked += log.count || 1;
                        } else if (log.action === 'navigate_blocked') {
                            sitesBlocked += 1;
                        }
                    });

                    // Get security alerts from yesterday
                    const alertsSnapshot = await db.collection('alerts')
                        .where('userId', '==', userId)
                        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(yesterdayStart))
                        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(yesterdayEnd))
                        .get();

                    const alertCount = alertsSnapshot.size;

                    // Get devices count
                    const devicesSnapshot = await db.collection('devices')
                        .where('userId', '==', userId)
                        .get();
                    const deviceCount = devicesSnapshot.size;

                    // Skip if no activity
                    if (adsBlocked === 0 && sitesBlocked === 0 && alertCount === 0) {
                        console.log(`[DailyDigest] No activity for ${email}, skipping`);
                        continue;
                    }

                    // Create email
                    const emailHtml = generateDailyDigestHtml({
                        userName: userData.displayName || email.split('@')[0],
                        adsBlocked,
                        sitesBlocked,
                        alertCount,
                        deviceCount,
                        date: yesterdayStart.toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })
                    });

                    // Send via mail collection (firestore-send-email extension)
                    await db.collection('mail').add({
                        to: email,
                        message: {
                            subject: `📊 Your Daily ZAS Safeguard Summary - ${adsBlocked} ads blocked`,
                            html: emailHtml
                        }
                    });

                    console.log(`[DailyDigest] Sent digest to ${email}: ${adsBlocked} ads, ${sitesBlocked} sites`);
                    successCount++;

                } catch (userError) {
                    console.error(`[DailyDigest] Error processing user ${userId}:`, userError);
                    errorCount++;
                }
            }

            console.log(`[DailyDigest] Completed: ${successCount} sent, ${errorCount} errors`);
            return null;

        } catch (error) {
            console.error('[DailyDigest] Fatal error:', error);
            return null;
        }
    });

/**
 * Generate HTML email for daily digest
 */
function generateDailyDigestHtml(data) {
    const hasAlerts = data.alertCount > 0;
    const statusColor = hasAlerts ? '#ef4444' : '#34d399';
    const statusText = hasAlerts
        ? `⚠️ ${data.alertCount} security alert${data.alertCount > 1 ? 's' : ''} detected`
        : '✅ All systems secure - no threats detected';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #ffffff; padding: 40px 20px; margin: 0;">
    <div style="max-width: 600px; margin: 0 auto; background: #13131a; border-radius: 16px; overflow: hidden;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: white;">☀️ Good Morning!</h1>
            <p style="margin: 10px 0 0; opacity: 0.9; color: white;">Your daily protection summary</p>
        </div>
        
        <!-- Greeting -->
        <div style="padding: 30px;">
            <p style="color: #a1a1aa; margin: 0 0 8px;">Hi ${data.userName},</p>
            <p style="color: #71717a; margin: 0 0 25px; font-size: 14px;">${data.date}</p>
            
            <!-- Status Banner -->
            <div style="padding: 15px 20px; border-radius: 8px; border-left: 4px solid ${statusColor}; background: ${hasAlerts ? '#1c1c1c' : '#1c1c1c'}; margin-bottom: 25px;">
                <span style="color: ${statusColor};">${statusText}</span>
            </div>
            
            <!-- Stats Grid -->
            <div style="display: flex; gap: 15px; margin-bottom: 25px;">
                <div style="flex: 1; background: #1e1e2a; padding: 20px; border-radius: 12px; text-align: center;">
                    <div style="font-size: 36px; font-weight: bold; color: #6366f1;">${data.adsBlocked.toLocaleString()}</div>
                    <div style="color: #71717a; font-size: 13px;">Ads Blocked</div>
                </div>
                <div style="flex: 1; background: #1e1e2a; padding: 20px; border-radius: 12px; text-align: center;">
                    <div style="font-size: 36px; font-weight: bold; color: #f59e0b;">${data.sitesBlocked}</div>
                    <div style="color: #71717a; font-size: 13px;">Sites Blocked</div>
                </div>
            </div>
            
            <!-- Secondary Stats -->
            <div style="display: flex; gap: 15px; margin-bottom: 25px;">
                <div style="flex: 1; background: #1e1e2a; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: #34d399;">${data.deviceCount}</div>
                    <div style="color: #71717a; font-size: 12px;">Protected Devices</div>
                </div>
                <div style="flex: 1; background: #1e1e2a; padding: 15px; border-radius: 8px; text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: ${hasAlerts ? '#ef4444' : '#34d399'};">${data.alertCount}</div>
                    <div style="color: #71717a; font-size: 12px;">Security Alerts</div>
                </div>
            </div>
            
            <!-- CTA -->
            <div style="text-align: center; margin-top: 30px;">
                <a href="https://zassafeguard.com/app/" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">View Full Dashboard</a>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="padding: 20px 30px; border-top: 1px solid #27272a; text-align: center; color: #71717a; font-size: 12px;">
            <p style="margin: 0 0 10px;">You're receiving this daily digest from ZAS Safeguard.</p>
            <p style="margin: 0;">
                <a href="https://zassafeguard.com/app/settings" style="color: #6366f1;">Manage preferences</a> |
                <a href="https://zassafeguard.com/privacy.html" style="color: #6366f1;">Privacy</a>
            </p>
            <p style="margin: 10px 0 0;">© ${new Date().getFullYear()} ZAS Global LLC</p>
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Manual trigger for testing daily digest (callable function)
 */
exports.testDailyDigest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const userId = context.auth.uid;

    try {
        const userDoc = await db.doc(`users/${userId}`).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }

        const userData = userDoc.data();
        const email = userData.email;

        // Get today's stats (for testing)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const logsSnapshot = await db.collection('logs')
            .where('userId', '==', userId)
            .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(todayStart))
            .get();

        let adsBlocked = 0;
        let sitesBlocked = 0;

        logsSnapshot.docs.forEach(doc => {
            const log = doc.data();
            if (log.action === 'ad_blocked') {
                adsBlocked += log.count || 1;
            } else if (log.action === 'navigate_blocked') {
                sitesBlocked += 1;
            }
        });

        const alertsSnapshot = await db.collection('alerts')
            .where('userId', '==', userId)
            .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(todayStart))
            .get();

        const devicesSnapshot = await db.collection('devices')
            .where('userId', '==', userId)
            .get();

        const emailHtml = generateDailyDigestHtml({
            userName: userData.displayName || email.split('@')[0],
            adsBlocked,
            sitesBlocked,
            alertCount: alertsSnapshot.size,
            deviceCount: devicesSnapshot.size,
            date: new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
        });

        await db.collection('mail').add({
            to: email,
            message: {
                subject: `📊 [TEST] Your Daily ZAS Safeguard Summary`,
                html: emailHtml
            }
        });

        return {
            success: true,
            message: `Test digest sent to ${email}`,
            stats: { adsBlocked, sitesBlocked, alerts: alertsSnapshot.size }
        };

    } catch (error) {
        console.error('[TestDailyDigest] Error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
