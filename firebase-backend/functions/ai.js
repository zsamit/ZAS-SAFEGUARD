/**
 * ZAS Safeguard - AI Functions
 * Content classification, risk scoring, and behavior analysis
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

// Adult content keywords for basic classification
const ADULT_KEYWORDS = [
    'porn', 'xxx', 'adult', 'sex', 'nude', 'naked', 'erotic', 'fetish',
    'hentai', 'nsfw', 'escort', 'stripper', 'cam girl', 'onlyfans',
    // Add more in production
];

const GAMBLING_KEYWORDS = [
    'casino', 'poker', 'betting', 'gamble', 'slots', 'blackjack',
    'roulette', 'sportsbook', 'wager',
];

/**
 * Classify content for adult/harmful material
 * Uses OpenAI GPT-4 for advanced classification
 */
exports.classifyContent = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { url, title, content } = data;
    const uid = context.auth.uid;

    try {
        // Quick keyword check first
        const textToCheck = `${url} ${title} ${content}`.toLowerCase();

        let quickResult = {
            isAdult: false,
            isGambling: false,
            categories: [],
            confidence: 0,
        };

        // Check adult keywords
        for (const keyword of ADULT_KEYWORDS) {
            if (textToCheck.includes(keyword)) {
                quickResult.isAdult = true;
                quickResult.categories.push('adult');
                quickResult.confidence = 0.9;
                break;
            }
        }

        // Check gambling keywords
        for (const keyword of GAMBLING_KEYWORDS) {
            if (textToCheck.includes(keyword)) {
                quickResult.isGambling = true;
                quickResult.categories.push('gambling');
                quickResult.confidence = Math.max(quickResult.confidence, 0.8);
                break;
            }
        }

        // If quick check found something, return immediately
        if (quickResult.confidence > 0.8) {
            return {
                success: true,
                classification: quickResult,
                method: 'keyword',
            };
        }

        // Use OpenAI for advanced classification
        const openaiApiKey = process.env.OPENAI_API_KEY;

        if (openaiApiKey) {
            const OpenAI = require('openai');
            const openai = new OpenAI({ apiKey: openaiApiKey });

            const prompt = `Classify the following web content. Respond with JSON only.

URL: ${url}
Title: ${title}
Content snippet: ${content?.substring(0, 500)}

Classify into categories: safe, adult, gambling, violence, drugs, social_media, gaming
Return format: {"categories": ["category1"], "isAdult": boolean, "isHarmful": boolean, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

            try {
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a content classifier for a parental control system. Be strict about adult content detection. Respond only with valid JSON.',
                        },
                        { role: 'user', content: prompt },
                    ],
                    max_tokens: 200,
                    temperature: 0.1,
                });

                const aiResponse = completion.choices[0].message.content;
                const classification = JSON.parse(aiResponse);

                return {
                    success: true,
                    classification,
                    method: 'ai',
                };
            } catch (aiError) {
                console.error('OpenAI classification error:', aiError);
                // Fall back to keyword result
            }
        }

        // Return keyword result or safe default
        return {
            success: true,
            classification: quickResult.confidence > 0 ? quickResult : {
                isAdult: false,
                isGambling: false,
                categories: ['unknown'],
                confidence: 0.5,
            },
            method: 'keyword',
        };
    } catch (error) {
        console.error('Classify content error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to classify content');
    }
});

/**
 * Generate risk score based on user behavior
 */
exports.generateRiskScore = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { timeframe } = data; // 'day', 'week', 'month'
    const uid = context.auth.uid;

    try {
        // Calculate time range
        const now = new Date();
        let startDate;

        switch (timeframe) {
            case 'day':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
            default:
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // Get user's block logs
        const logs = await db.collection('logs')
            .where('userId', '==', uid)
            .where('type', '==', 'block')
            .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .get();

        // Analyze patterns
        const analysis = {
            totalBlocks: logs.size,
            byCategory: {},
            byHour: new Array(24).fill(0),
            peakHours: [],
            riskFactors: [],
            score: 0,
        };

        logs.forEach(doc => {
            const log = doc.data();

            // Count by category
            const category = log.category || 'unknown';
            analysis.byCategory[category] = (analysis.byCategory[category] || 0) + 1;

            // Count by hour
            if (log.timestamp) {
                const hour = log.timestamp.toDate().getHours();
                analysis.byHour[hour]++;
            }
        });

        // Calculate risk score
        let riskScore = 0;

        // Factor 1: High block count
        if (analysis.totalBlocks > 50) {
            riskScore += 2;
            analysis.riskFactors.push('High block frequency');
        } else if (analysis.totalBlocks > 20) {
            riskScore += 1;
        }

        // Factor 2: Late night activity (11pm - 5am)
        const lateNightBlocks = analysis.byHour.slice(23).concat(analysis.byHour.slice(0, 5))
            .reduce((a, b) => a + b, 0);
        if (lateNightBlocks > analysis.totalBlocks * 0.4) {
            riskScore += 2;
            analysis.riskFactors.push('Significant late-night activity');
        }

        // Factor 3: Adult content attempts
        if ((analysis.byCategory.adult || 0) > 5) {
            riskScore += 3;
            analysis.riskFactors.push('Multiple adult content attempts');
        }

        // Factor 4: Unlock attempts
        const unlockLogs = await db.collection('logs')
            .where('userId', '==', uid)
            .where('type', 'in', ['unlock_request', 'unlock_failed'])
            .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .get();

        if (unlockLogs.size > 3) {
            riskScore += 2;
            analysis.riskFactors.push(`${unlockLogs.size} unlock attempts`);
        }

        // Find peak hours
        const maxBlocks = Math.max(...analysis.byHour);
        analysis.byHour.forEach((count, hour) => {
            if (count === maxBlocks && count > 0) {
                analysis.peakHours.push(hour);
            }
        });

        // Normalize score to 0-10
        analysis.score = Math.min(10, Math.round(riskScore));

        // Determine risk level
        if (analysis.score >= 7) {
            analysis.riskLevel = 'high';
        } else if (analysis.score >= 4) {
            analysis.riskLevel = 'medium';
        } else {
            analysis.riskLevel = 'low';
        }

        return {
            success: true,
            analysis,
            timeframe,
            periodStart: startDate.toISOString(),
            periodEnd: now.toISOString(),
        };
    } catch (error) {
        console.error('Generate risk score error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to generate risk score');
    }
});

/**
 * Generate weekly report for parents
 */
exports.generateWeeklyReport = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { childId } = data;
    const uid = context.auth.uid;

    try {
        // Verify parent has access to this child
        const childDoc = await db.doc(`children/${childId}`).get();
        if (!childDoc.exists || childDoc.data().parentUid !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Not authorized');
        }

        const child = childDoc.data();
        const childDevices = child.devices || [];

        // Get logs for the past week
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        let allLogs = [];
        for (const deviceId of childDevices) {
            const deviceLogs = await db.collection('logs')
                .where('deviceId', '==', deviceId)
                .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(weekAgo))
                .get();

            allLogs = allLogs.concat(deviceLogs.docs.map(d => d.data()));
        }

        // Compile report
        const report = {
            childName: child.name,
            periodStart: weekAgo.toISOString(),
            periodEnd: new Date().toISOString(),
            summary: {
                totalBlocks: 0,
                totalTamperAttempts: 0,
                categoriesBlocked: {},
                deviceActivity: {},
            },
            highlights: [],
            recommendations: [],
        };

        allLogs.forEach(log => {
            if (log.type === 'block') {
                report.summary.totalBlocks++;
                const cat = log.category || 'unknown';
                report.summary.categoriesBlocked[cat] = (report.summary.categoriesBlocked[cat] || 0) + 1;
            } else if (log.type === 'tamper') {
                report.summary.totalTamperAttempts++;
            }

            // Track device activity
            const device = log.deviceId || 'unknown';
            report.summary.deviceActivity[device] = (report.summary.deviceActivity[device] || 0) + 1;
        });

        // Generate highlights
        if (report.summary.totalBlocks === 0) {
            report.highlights.push('✅ No blocked content attempts this week!');
        } else if (report.summary.totalBlocks < 5) {
            report.highlights.push('👍 Very few blocked content attempts this week.');
        } else {
            report.highlights.push(`⚠️ ${report.summary.totalBlocks} blocked content attempts this week.`);
        }

        if (report.summary.totalTamperAttempts > 0) {
            report.highlights.push(`🚨 ${report.summary.totalTamperAttempts} tamper attempts detected!`);
            report.recommendations.push('Consider having a conversation about the importance of the protection.');
        }

        // Add recommendations based on patterns
        const pornAttempts = report.summary.categoriesBlocked.adult || 0;
        if (pornAttempts > 3) {
            report.recommendations.push('Consider discussing internet safety and healthy online habits.');
        }

        // Use AI for summary if available
        const openaiApiKey = process.env.OPENAI_API_KEY;

        if (openaiApiKey && allLogs.length > 0) {
            try {
                const OpenAI = require('openai');
                const openai = new OpenAI({ apiKey: openaiApiKey });

                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful parental control assistant. Write a brief, encouraging weekly summary for parents. Be constructive, not alarming.',
                        },
                        {
                            role: 'user',
                            content: `Write a 2-3 sentence summary for a parent about their child's online activity this week. Child name: ${child.name}. Stats: ${report.summary.totalBlocks} blocked attempts, ${report.summary.totalTamperAttempts} tamper attempts. Categories: ${JSON.stringify(report.summary.categoriesBlocked)}`,
                        },
                    ],
                    max_tokens: 150,
                });

                report.aiSummary = completion.choices[0].message.content;
            } catch (e) {
                console.log('AI summary generation failed:', e.message);
            }
        }

        return {
            success: true,
            report,
        };
    } catch (error) {
        console.error('Generate weekly report error:', error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Failed to generate report');
    }
});
