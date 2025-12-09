/**
 * ZAS Safeguard - Subscription Functions
 * Handles Stripe integration, regional pricing, and trial management
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

// Regional pricing map
const REGION_TO_TIER = {
    'US': 'usa', 'CA': 'usa', 'GB': 'eu', 'DE': 'eu', 'FR': 'eu', 'IT': 'eu', 'ES': 'eu',
    'AF': 'afg',
    'PK': 'pak',
    'IN': 'ind',
    'EG': 'egy',
    'BD': 'bgd',
};

/**
 * Create Stripe checkout session with regional pricing
 */
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = context.auth.uid;
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    try {
        // Get user data and fraud score
        const userDoc = await db.doc(`users/${uid}`).get();
        const userData = userDoc.data();

        // Calculate fraud score and get pricing
        const fraudDoc = await db.doc(`fraud_scores/${uid}`).get();
        const fraudScore = fraudDoc.exists ? fraudDoc.data().score : 0;

        // Determine pricing tier
        let priceTier = userData.subscription?.price_tier || 'usa';

        if (fraudScore >= 4) {
            priceTier = 'usa'; // Force US pricing for high fraud
        }

        // Get price from regional pricing
        const pricingDoc = await db.doc(`region_pricing/${priceTier}`).get();
        const pricing = pricingDoc.data();

        if (!pricing || !pricing.stripe_price_id) {
            throw new functions.https.HttpsError('not-found', 'Pricing not configured');
        }

        // Check trial eligibility
        const trialEligible = await checkTrialEligibilityInternal(uid);

        // Get or create Stripe customer
        let stripeCustomerId = userData.subscription?.stripe_customer_id;

        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: userData.email,
                metadata: { firebaseUid: uid },
            });
            stripeCustomerId = customer.id;

            await db.doc(`users/${uid}`).update({
                'subscription.stripe_customer_id': stripeCustomerId,
            });
        }

        // Create checkout session
        const sessionParams = {
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            line_items: [{
                price: pricing.stripe_price_id,
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: `${data.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: data.cancelUrl,
            metadata: {
                userId: uid,
                priceTier: priceTier,
            },
        };

        // Add trial if eligible
        if (trialEligible.eligible) {
            sessionParams.subscription_data = {
                trial_period_days: 7,
                metadata: { userId: uid },
            };
        }

        const session = await stripe.checkout.sessions.create(sessionParams);

        return {
            success: true,
            sessionId: session.id,
            sessionUrl: session.url,
            trialEligible: trialEligible.eligible,
        };
    } catch (error) {
        console.error('Checkout session error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to create checkout session');
    }
});

/**
 * Stripe webhook handler
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const uid = session.metadata.userId;
                const priceTier = session.metadata.priceTier;

                // Update subscription status
                await db.doc(`users/${uid}`).update({
                    'subscription.plan': 'monthly',
                    'subscription.plan_status': 'active',
                    'subscription.price_tier': priceTier,
                });

                // Create subscription record
                await db.doc(`subscriptions/${uid}`).set({
                    stripe_subscription_id: session.subscription,
                    status: 'active',
                    price_id: session.metadata.priceId,
                    region: priceTier,
                    created_at: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });

                console.log(`Subscription activated for user: ${uid}`);
                break;
            }

            case 'customer.subscription.trial_will_end': {
                const subscription = event.data.object;
                const customer = await stripe.customers.retrieve(subscription.customer);
                const uid = customer.metadata.firebaseUid;

                // Send trial ending notification
                await db.collection('logs').add({
                    userId: uid,
                    type: 'notification',
                    message: 'Trial ending in 3 days',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                });
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const customer = await stripe.customers.retrieve(subscription.customer);
                const uid = customer.metadata.firebaseUid;

                // Check if trial just ended
                if (subscription.status === 'active' && !subscription.trial_end) {
                    await db.doc(`users/${uid}`).update({
                        'subscription.trial_active': false,
                        'subscription.plan_status': 'active',
                    });
                }

                // Update subscription record
                await db.doc(`subscriptions/${uid}`).update({
                    status: subscription.status,
                    current_period_start: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
                    current_period_end: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
                });
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const customer = await stripe.customers.retrieve(subscription.customer);
                const uid = customer.metadata.firebaseUid;

                // Update user subscription status
                await db.doc(`users/${uid}`).update({
                    'subscription.plan_status': 'cancelled',
                    'subscription.trial_active': false,
                });

                await db.doc(`subscriptions/${uid}`).update({
                    status: 'cancelled',
                    cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
                });

                console.log(`Subscription cancelled for user: ${uid}`);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const customer = await stripe.customers.retrieve(invoice.customer);
                const uid = customer.metadata.firebaseUid;

                await db.doc(`users/${uid}`).update({
                    'subscription.plan_status': 'past_due',
                });

                // Log payment failure
                await db.collection('logs').add({
                    userId: uid,
                    type: 'payment_failed',
                    message: 'Subscription payment failed',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                });
                break;
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * Check if user is eligible for free trial
 */
async function checkTrialEligibilityInternal(uid) {
    // Get user's device fingerprint
    const userDevices = await db.collection('devices')
        .where('userId', '==', uid)
        .limit(1)
        .get();

    if (userDevices.empty) {
        return { eligible: true, reason: 'No devices registered yet' };
    }

    const fingerprint = userDevices.docs[0].data().fingerprint;

    // Check 1: Device fingerprint
    const deviceRegistry = await db.doc(`device_registry/${fingerprint}`).get();
    if (deviceRegistry.exists && deviceRegistry.data().trial_used) {
        return { eligible: false, reason: 'device_used' };
    }

    // Check 2: Phone number (for discounted regions)
    const userDoc = await db.doc(`users/${uid}`).get();
    const userData = userDoc.data();

    if (userData.phone) {
        const phoneUsers = await db.collection('users')
            .where('phone', '==', userData.phone)
            .where('subscription.trial_active', '==', true)
            .get();

        if (!phoneUsers.empty) {
            return { eligible: false, reason: 'phone_used' };
        }
    }

    // Check 3: Fraud score
    const fraudDoc = await db.doc(`fraud_scores/${uid}`).get();
    if (fraudDoc.exists && fraudDoc.data().score >= 3) {
        return { eligible: false, reason: 'fraud_detected' };
    }

    // Check 4: Payment card (checked during Stripe session creation)

    return { eligible: true };
}

exports.checkTrialEligibility = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }
    return await checkTrialEligibilityInternal(context.auth.uid);
});

/**
 * Get regional pricing for user
 */
exports.getRegionalPrice = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = context.auth.uid;

    try {
        // Get user's verified country
        const userDoc = await db.doc(`users/${uid}`).get();
        const phoneCountry = userDoc.data()?.phone_country;

        // Get fraud score for tier adjustment
        const fraudDoc = await db.doc(`fraud_scores/${uid}`).get();
        const fraudScore = fraudDoc.exists ? fraudDoc.data().score : 0;

        // Determine price tier
        let priceTier = REGION_TO_TIER[phoneCountry] || 'usa';

        if (fraudScore >= 4) {
            priceTier = 'usa';
        } else if (fraudScore >= 2) {
            // Move to higher tier
            if (priceTier !== 'usa' && priceTier !== 'eu') {
                priceTier = 'usa';
            }
        }

        // Get pricing
        const pricingDoc = await db.doc(`region_pricing/${priceTier}`).get();
        const pricing = pricingDoc.data();

        return {
            success: true,
            region: priceTier,
            currency: pricing.currency,
            amount: pricing.amount,
            fraudScore,
        };
    } catch (error) {
        console.error('Get regional price error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get pricing');
    }
});

/**
 * Handle trial end - called by scheduled function or webhook
 */
exports.handleTrialEnd = functions.https.onCall(async (data, context) => {
    // This can be called internally or by admin
    const { userId } = data;

    if (!userId) {
        throw new functions.https.HttpsError('invalid-argument', 'userId required');
    }

    try {
        const userDoc = await db.doc(`users/${userId}`).get();
        const userData = userDoc.data();

        if (userData.subscription?.plan_status !== 'active') {
            // Trial ended without conversion
            await db.doc(`users/${userId}`).update({
                'subscription.trial_active': false,
                'subscription.plan_status': 'expired',
            });

            // For owner mode, keep porn blocking active
            if (userData.mode === 'owner') {
                console.log(`Owner mode ${userId}: keeping porn blocking active despite expired trial`);
            }

            // Log trial expiration
            await db.collection('logs').add({
                userId,
                type: 'trial_expired',
                message: 'Trial ended without subscription',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        return { success: true };
    } catch (error) {
        console.error('Handle trial end error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to handle trial end');
    }
});
