/**
 * ZAS Safeguard - Subscription Functions
 * Handles Stripe integration, regional pricing, and trial management
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * Generate HTML email for trial expired notification
 */
function generateTrialExpiredEmailHtml(userName) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 40px 20px;">
            <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px; text-align: center;">
                    <h1 style="color: #fff; margin: 0; font-size: 24px;">Your Free Trial Has Ended</h1>
                </div>
                <div style="padding: 32px;">
                    <p style="font-size: 16px; color: #334155; margin-bottom: 24px;">
                        Hey ${userName},
                    </p>
                    <p style="font-size: 15px; color: #64748b; line-height: 1.6; margin-bottom: 24px;">
                        Your 7-day free trial of ZAS Safeguard has ended. We hope you enjoyed the peace of mind of protected browsing!
                    </p>
                    <p style="font-size: 15px; color: #64748b; line-height: 1.6; margin-bottom: 32px;">
                        To continue protecting yourself online with ad-blocking, content filtering, and Focus Mode, subscribe to our Pro plan.
                    </p>
                    <div style="text-align: center; margin-bottom: 32px;">
                        <a href="https://zassafeguard.com/app/checkout?plan=yearly" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-size: 16px; font-weight: 600;">
                            Upgrade to Pro
                        </a>
                    </div>
                    <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                        <p style="font-size: 14px; color: #475569; margin: 0 0 12px; font-weight: 600;">What you're missing:</p>
                        <ul style="margin: 0; padding-left: 20px; color: #64748b; font-size: 14px; line-height: 1.8;">
                            <li>Block adult content & harmful sites</li>
                            <li>Remove ads & trackers</li>
                            <li>Focus Mode for productivity</li>
                            <li>Unlimited devices</li>
                        </ul>
                    </div>
                    <p style="font-size: 13px; color: #94a3b8; text-align: center;">
                        Cancel anytime • 7-day money-back guarantee
                    </p>
                </div>
                <div style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                        © 2025 ZAS Safeguard. All rights reserved.
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;
}

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
 * Stripe Price IDs - Update these with your actual Stripe price IDs
 */
const STRIPE_PRICE_IDS = {
    essential_monthly: process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY || 'price_essential_monthly',
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_1Sm14ZRwbGN3ywzEIfFE81W6',
    essential_yearly: process.env.STRIPE_PRICE_ESSENTIAL_YEARLY || 'price_essential_yearly',
    pro_yearly: process.env.STRIPE_PRICE_PRO_YEARLY || 'price_1Sm15iRwbGN3ywzEZTQ8GZJ7',
};

const VALID_PLANS = ['essential_monthly', 'pro_monthly', 'essential_yearly', 'pro_yearly', 'monthly', 'yearly'];

/**
 * Create Stripe checkout session
 */
exports.createCheckoutSession = functions
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
        const { plan, successUrl, cancelUrl } = data;

        // Validate plan
        if (!plan || !VALID_PLANS.includes(plan)) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid plan selected');
        }

        // Normalize legacy plan names
        let normalizedPlan = plan;
        if (plan === 'monthly') normalizedPlan = 'pro_monthly';
        if (plan === 'yearly') normalizedPlan = 'pro_yearly';

        if (!process.env.STRIPE_SECRET_KEY) {
            throw new functions.https.HttpsError('failed-precondition', 'Stripe secret key not configured. Please set STRIPE_SECRET_KEY.');
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        try {
            // Get user data
            const userDoc = await db.doc(`users/${uid}`).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            // Get price ID - first try from Firestore config, then env vars
            let priceId;
            const pricingDoc = await db.doc('config/stripe_prices').get();
            if (pricingDoc.exists && pricingDoc.data()[normalizedPlan]) {
                priceId = pricingDoc.data()[normalizedPlan];
            } else {
                priceId = STRIPE_PRICE_IDS[normalizedPlan];
            }

            // Check if price ID is a placeholder (not configured)
            const isPlaceholder = !priceId ||
                priceId.includes('REPLACE') ||
                priceId === 'price_essential_monthly' ||
                priceId === 'price_pro_monthly' ||
                priceId === 'price_essential_yearly' ||
                priceId === 'price_pro_yearly';

            if (isPlaceholder) {
                console.error('Stripe price not configured. Plan:', normalizedPlan, 'PriceId:', priceId);
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    'Stripe price not configured. Please set up Stripe price IDs in Firebase config or environment.'
                );
            }

            // Check trial eligibility
            const trialEligible = await checkTrialEligibilityInternal(uid);

            // Get or create Stripe customer
            let stripeCustomerId = userData.subscription?.stripe_customer_id;

            if (!stripeCustomerId) {
                const customer = await stripe.customers.create({
                    email: userData.email || context.auth.token?.email,
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
                    price: priceId,
                    quantity: 1,
                }],
                mode: 'subscription',
                automatic_tax: {
                    enabled: true,
                },
                customer_update: {
                    address: 'auto',
                    name: 'auto',
                },
                tax_id_collection: {
                    enabled: true,
                },
                metadata: {
                    userId: uid,
                    plan: normalizedPlan,
                },
            };

            // Handle embedded vs hosted mode
            if (data.mode === 'embedded') {
                sessionParams.ui_mode = 'embedded';
                sessionParams.return_url = `${data.origin || 'https://zassafeguard.com'}/app/checkout/return?session_id={CHECKOUT_SESSION_ID}`;
            } else {
                sessionParams.success_url = successUrl || `${data.origin || 'https://zas-safeguard.web.app'}/app/?payment=success`;
                sessionParams.cancel_url = cancelUrl || `${data.origin || 'https://zas-safeguard.web.app'}/app/?payment=cancelled`;
            }

            // Add trial if eligible
            if (trialEligible.eligible) {
                sessionParams.subscription_data = {
                    trial_period_days: 7,
                    metadata: { userId: uid, plan: normalizedPlan },
                };
            }

            const session = await stripe.checkout.sessions.create(sessionParams);

            return {
                success: true,
                sessionId: session.id,
                sessionUrl: session.url,
                clientSecret: session.client_secret,
                trialEligible: trialEligible.eligible,
            };
        } catch (error) {
            console.error('Checkout session error:', error);
            if (error instanceof functions.https.HttpsError) {
                throw error;
            }
            throw new functions.https.HttpsError('internal', `Checkout failed: ${error.message}`);
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

                // Get user data for email
                const userDoc = await db.doc(`users/${uid}`).get();
                const userData = userDoc.exists ? userDoc.data() : {};

                // Update user subscription status
                await db.doc(`users/${uid}`).update({
                    'subscription.plan_status': 'cancelled',
                    'subscription.plan': 'free',
                    'subscription.trial_active': false,
                });

                await db.doc(`subscriptions/${uid}`).update({
                    status: 'cancelled',
                    cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
                });

                // Send trial/subscription expired email
                if (userData.email) {
                    const userName = userData.displayName || userData.email.split('@')[0];
                    await db.collection('mail').add({
                        to: userData.email,
                        message: {
                            subject: 'Your ZAS Safeguard Trial Has Ended',
                            html: generateTrialExpiredEmailHtml(userName),
                        },
                    });
                    console.log(`[Email] Sent trial expired email to ${userData.email}`);
                }

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

/**
 * Create Stripe Customer Portal session
 * Allows users to manage their subscription, payment methods, and view invoices
 */
exports.createPortalSession = functions
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
        const { returnUrl } = data;

        if (!process.env.STRIPE_SECRET_KEY) {
            throw new functions.https.HttpsError('failed-precondition', 'Stripe not configured');
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        try {
            // Get user's Stripe customer ID
            const userDoc = await db.doc(`users/${uid}`).get();
            const customerId = userDoc.data()?.subscription?.stripe_customer_id;

            if (!customerId) {
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    'No subscription found. Please subscribe first.'
                );
            }

            // Create portal session
            const session = await stripe.billingPortal.sessions.create({
                customer: customerId,
                return_url: returnUrl || 'https://zassafeguard.com/app/settings',
            });

            return {
                success: true,
                url: session.url
            };
        } catch (error) {
            console.error('Portal session error:', error);
            if (error instanceof functions.https.HttpsError) throw error;
            throw new functions.https.HttpsError('internal', `Portal creation failed: ${error.message}`);
        }
    });

/**
 * Get user's invoices from Stripe
 */
exports.getInvoices = functions
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
        const { limit = 10 } = data;

        if (!process.env.STRIPE_SECRET_KEY) {
            throw new functions.https.HttpsError('failed-precondition', 'Stripe not configured');
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        try {
            // Get user's Stripe customer ID
            const userDoc = await db.doc(`users/${uid}`).get();
            const customerId = userDoc.data()?.subscription?.stripe_customer_id;

            if (!customerId) {
                return { success: true, invoices: [], message: 'No billing history' };
            }

            // Fetch invoices
            const invoices = await stripe.invoices.list({
                customer: customerId,
                limit: Math.min(limit, 100),
            });

            // Map to simplified format
            const formattedInvoices = invoices.data.map(inv => ({
                id: inv.id,
                number: inv.number,
                amount: inv.amount_due / 100,
                currency: inv.currency.toUpperCase(),
                status: inv.status,
                date: new Date(inv.created * 1000).toISOString(),
                pdfUrl: inv.invoice_pdf,
                hostedUrl: inv.hosted_invoice_url,
            }));

            return {
                success: true,
                invoices: formattedInvoices
            };
        } catch (error) {
            console.error('Get invoices error:', error);
            throw new functions.https.HttpsError('internal', `Failed to fetch invoices: ${error.message}`);
        }
    });

/**
 * Get user's subscription status (real data from Firestore + Stripe)
 * Used by dashboard and extension to display correct plan
 */
exports.getSubscription = functions
    .runWith({ memory: '512MB', timeoutSeconds: 60 })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
        }

        const uid = context.auth.uid;

        try {
            // Get user data
            const userDoc = await db.doc(`users/${uid}`).get();
            if (!userDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'User not found');
            }

            const userData = userDoc.data();
            const subscription = userData.subscription || {};

            // Get subscription record for more details
            const subDoc = await db.doc(`subscriptions/${uid}`).get();
            const subData = subDoc.exists ? subDoc.data() : {};

            // Determine plan type
            let planType = 'free';
            let planStatus = subscription.plan_status || 'inactive';

            // Check for lifetime purchase
            if (subscription.plan === 'lifetime' || subData.plan === 'lifetime') {
                planType = 'lifetime';
                planStatus = 'active';
            } else if (planStatus === 'active' || planStatus === 'trialing') {
                planType = subscription.plan || subData.plan || 'pro';
            }

            // Calculate days remaining in trial
            let trialDaysRemaining = 0;
            if (subscription.trial_active && subscription.trial_end) {
                const trialEnd = subscription.trial_end.toDate();
                trialDaysRemaining = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
            }

            return {
                success: true,
                subscription: {
                    plan: planType,
                    status: planStatus,
                    trialActive: subscription.trial_active || false,
                    trialDaysRemaining,
                    currentPeriodEnd: subData.current_period_end?.toDate?.()?.toISOString() || null,
                    customerId: subscription.stripe_customer_id || null,
                    hasPaymentMethod: !!subscription.stripe_customer_id
                }
            };
        } catch (error) {
            console.error('Get subscription error:', error);
            if (error instanceof functions.https.HttpsError) throw error;
            throw new functions.https.HttpsError('internal', `Failed to get subscription: ${error.message}`);
        }
    });

/**
 * Create subscription intent for custom PaymentElement checkout
 * Returns clientSecret for frontend to confirm payment
 */
exports.createSubscriptionIntent = functions
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
        const { plan } = data;

        // Validate plan
        if (!plan || !VALID_PLANS.includes(plan)) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid plan selected');
        }

        // Normalize legacy plan names
        let normalizedPlan = plan;
        if (plan === 'monthly') normalizedPlan = 'pro_monthly';
        if (plan === 'yearly') normalizedPlan = 'pro_yearly';

        if (!process.env.STRIPE_SECRET_KEY) {
            throw new functions.https.HttpsError('failed-precondition', 'Stripe secret key not configured');
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        try {
            // Get user data
            const userDoc = await db.doc(`users/${uid}`).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            // Get price ID
            const priceId = STRIPE_PRICE_IDS[normalizedPlan];
            if (!priceId || priceId.includes('price_essential') || priceId.includes('price_pro_monthly') && !priceId.startsWith('price_1')) {
                throw new functions.https.HttpsError('failed-precondition', 'Stripe price not configured');
            }

            // Get or create Stripe customer
            let stripeCustomerId = userData.subscription?.stripe_customer_id;

            if (!stripeCustomerId) {
                const customer = await stripe.customers.create({
                    email: userData.email || context.auth.token?.email,
                    metadata: { firebaseUid: uid },
                });
                stripeCustomerId = customer.id;

                await db.doc(`users/${uid}`).set({
                    subscription: { stripe_customer_id: stripeCustomerId },
                }, { merge: true });
            }

            // Check trial eligibility
            const trialEligible = await checkTrialEligibilityInternal(uid);

            // Create subscription with payment_behavior: default_incomplete
            const subscriptionParams = {
                customer: stripeCustomerId,
                items: [{ price: priceId }],
                payment_behavior: 'default_incomplete',
                payment_settings: {
                    save_default_payment_method: 'on_subscription',
                },
                metadata: {
                    userId: uid,
                    plan: normalizedPlan,
                },
            };

            // Add trial if eligible - also need to expand pending_setup_intent
            if (trialEligible.eligible) {
                subscriptionParams.trial_period_days = 7;
                subscriptionParams.expand = ['pending_setup_intent'];
            } else {
                subscriptionParams.expand = ['latest_invoice.payment_intent'];
            }

            const subscription = await stripe.subscriptions.create(subscriptionParams);

            // Get client secret - from setup_intent for trials, payment_intent otherwise
            let clientSecret;
            if (trialEligible.eligible) {
                clientSecret = subscription.pending_setup_intent?.client_secret;
            } else {
                clientSecret = subscription.latest_invoice?.payment_intent?.client_secret;
            }

            if (!clientSecret) {
                throw new functions.https.HttpsError('internal', 'Failed to get client secret for payment');
            }

            return {
                success: true,
                subscriptionId: subscription.id,
                clientSecret: clientSecret,
                trialEligible: trialEligible.eligible,
                requiresPayment: true, // Always require payment info collection
                isSetupIntent: trialEligible.eligible, // Frontend needs to know which type
            };
        } catch (error) {
            console.error('Create subscription intent error:', error);
            if (error instanceof functions.https.HttpsError) throw error;
            throw new functions.https.HttpsError('internal', `Subscription failed: ${error.message}`);
        }
    });
