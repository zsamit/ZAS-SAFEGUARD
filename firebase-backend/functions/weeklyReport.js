/**
 * ZAS Safeguard - Weekly Summary Report
 * Sends weekly email summaries to users with their activity stats
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * Weekly Summary Email - Runs every Sunday at 9:00 AM UTC
 * Aggregates: blocks count, top categories, study mode usage, devices online
 */
exports.sendWeeklySummary = functions.pubsub.schedule('0 9 * * 0')
    .timeZone('America/Los_Angeles')
    .onRun(async (context) => {
        console.log('[WeeklyReport] Starting weekly summary generation...');

        try {
            // Get all users who have weekly email enabled
            const usersSnapshot = await db.collection('users')
                .where('settings.weeklyEmailEnabled', '==', true)
                .get();

            console.log(`[WeeklyReport] Found ${usersSnapshot.size} users with weekly email enabled`);

            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            for (const userDoc of usersSnapshot.docs) {
                const userId = userDoc.id;
                const userData = userDoc.data();
                const email = userData.email;

                if (!email) continue;

                try {
                    // Get block events from past week
                    const eventsSnapshot = await db.collection('security_events')
                        .where('userId', '==', userId)
                        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(oneWeekAgo))
                        .get();

                    // Aggregate stats
                    let totalBlocks = 0;
                    const categoryCount = {};
                    let tamperAttempts = 0;

                    eventsSnapshot.docs.forEach(doc => {
                        const event = doc.data();
                        if (event.eventType === 'BLOCKED_SITE' || event.eventType === 'SCAN_MALICIOUS') {
                            totalBlocks++;
                            const category = event.details?.category || 'unknown';
                            categoryCount[category] = (categoryCount[category] || 0) + 1;
                        }
                        if (event.eventType === 'TAMPER_ATTEMPT' || event.eventType === 'DISABLE_ATTEMPT' || event.eventType === 'DEVTOOLS_OPENED') {
                            tamperAttempts++;
                        }
                    });

                    // Get top 3 categories
                    const topCategories = Object.entries(categoryCount)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([cat, count]) => `${cat}: ${count}`);

                    // Get device count
                    const devicesSnapshot = await db.collection('devices')
                        .where('userId', '==', userId)
                        .get();
                    const deviceCount = devicesSnapshot.size;

                    // Get study sessions from past week
                    const studySnapshot = await db.collection('study_sessions')
                        .where('userId', '==', userId)
                        .where('startedAt', '>=', admin.firestore.Timestamp.fromDate(oneWeekAgo))
                        .get();
                    const studySessions = studySnapshot.size;

                    // Create email
                    const emailHtml = generateWeeklyEmailHtml({
                        userName: userData.displayName || email.split('@')[0],
                        totalBlocks,
                        topCategories,
                        tamperAttempts,
                        deviceCount,
                        studySessions,
                        weekStart: oneWeekAgo.toLocaleDateString(),
                        weekEnd: new Date().toLocaleDateString()
                    });

                    // Send via mail collection (firestore-send-email extension)
                    await db.collection('mail').add({
                        to: email,
                        message: {
                            subject: `📊 Your ZAS Safeguard Weekly Summary`,
                            html: emailHtml
                        }
                    });

                    console.log(`[WeeklyReport] Sent summary to ${email}`);

                } catch (userError) {
                    console.error(`[WeeklyReport] Error processing user ${userId}:`, userError);
                }
            }

            console.log('[WeeklyReport] Completed weekly summary generation');
            return null;

        } catch (error) {
            console.error('[WeeklyReport] Fatal error:', error);
            return null;
        }
    });

/**
 * Generate HTML email for weekly summary
 */
function generateWeeklyEmailHtml(data) {
    const alertStyle = data.tamperAttempts > 0
        ? 'background: #fee2e2; border-color: #ef4444; color: #991b1b;'
        : 'background: #d1fae5; border-color: #34d399; color: #065f46;';

    const alertMessage = data.tamperAttempts > 0
        ? `⚠️ ${data.tamperAttempts} tamper attempt(s) detected this week`
        : '✅ No tamper attempts detected';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #ffffff; padding: 40px 20px;">
    <div style="max-width: 600px; margin: 0 auto; background: #13131a; border-radius: 16px; overflow: hidden;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">📊 Weekly Protection Report</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">Week of ${data.weekStart} - ${data.weekEnd}</p>
        </div>
        
        <!-- Greeting -->
        <div style="padding: 30px;">
            <p style="color: #a1a1aa; margin: 0 0 20px;">Hi ${data.userName},</p>
            <p style="color: #a1a1aa; margin: 0 0 30px;">Here's your weekly activity summary from ZAS Safeguard:</p>
            
            <!-- Stats Grid -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">
                <div style="background: #1e1e2a; padding: 20px; border-radius: 12px; text-align: center;">
                    <div style="font-size: 32px; font-weight: bold; color: #6366f1;">${data.totalBlocks}</div>
                    <div style="color: #71717a; font-size: 14px;">Sites Blocked</div>
                </div>
                <div style="background: #1e1e2a; padding: 20px; border-radius: 12px; text-align: center;">
                    <div style="font-size: 32px; font-weight: bold; color: #34d399;">${data.deviceCount}</div>
                    <div style="color: #71717a; font-size: 14px;">Protected Devices</div>
                </div>
                <div style="background: #1e1e2a; padding: 20px; border-radius: 12px; text-align: center;">
                    <div style="font-size: 32px; font-weight: bold; color: #fbbf24;">${data.studySessions}</div>
                    <div style="color: #71717a; font-size: 14px;">Study Sessions</div>
                </div>
                <div style="background: #1e1e2a; padding: 20px; border-radius: 12px; text-align: center;">
                    <div style="font-size: 32px; font-weight: bold; color: ${data.tamperAttempts > 0 ? '#ef4444' : '#34d399'};">${data.tamperAttempts}</div>
                    <div style="color: #71717a; font-size: 14px;">Tamper Attempts</div>
                </div>
            </div>
            
            <!-- Alert Banner -->
            <div style="padding: 15px 20px; border-radius: 8px; border: 1px solid; margin-bottom: 25px; ${alertStyle}">
                ${alertMessage}
            </div>
            
            <!-- Top Categories -->
            ${data.topCategories.length > 0 ? `
            <div style="background: #1e1e2a; padding: 20px; border-radius: 12px; margin-bottom: 25px;">
                <h3 style="margin: 0 0 15px; font-size: 16px; color: #ffffff;">Top Blocked Categories</h3>
                <ul style="margin: 0; padding: 0 0 0 20px; color: #a1a1aa;">
                    ${data.topCategories.map(cat => `<li style="padding: 5px 0;">${cat}</li>`).join('')}
                </ul>
            </div>
            ` : ''}
            
            <!-- CTA -->
            <div style="text-align: center; margin-top: 30px;">
                <a href="https://zassafeguard.com/app/" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">View Full Dashboard</a>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="padding: 20px 30px; border-top: 1px solid #27272a; text-align: center; color: #71717a; font-size: 12px;">
            <p style="margin: 0 0 10px;">You're receiving this because you enabled weekly summaries in ZAS Safeguard.</p>
            <p style="margin: 0;">
                <a href="https://zassafeguard.com/app/#settings" style="color: #6366f1;">Manage email preferences</a> |
                <a href="https://zassafeguard.com/privacy.html" style="color: #6366f1;">Privacy</a>
            </p>
            <p style="margin: 10px 0 0;">© ${new Date().getFullYear()} ZAS Global LLC. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;
}
