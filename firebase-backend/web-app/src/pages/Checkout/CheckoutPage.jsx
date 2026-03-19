import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { Shield, Check, ArrowLeft, Loader } from 'lucide-react';
import Logo from '../../components/Logo';
import styles from './CheckoutPage.module.css';

// Initialize Stripe
// L-03: Stripe publishable key from env var (set VITE_STRIPE_PUBLISHABLE_KEY in .env)
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

// Plan details
const PLANS = {
    monthly: {
        name: 'Pro Monthly',
        price: '$4.99',
        period: '/month',
        description: 'Everything you need to browse safely, block distractions, and protect your family — starting today. Adult content is blocked the moment you install. Ads and trackers are stripped from every page. The URL Scanner checks every link before it loads, catching phishing sites, malware, and scams that get past normal browsers. Focus Mode locks out social media and distractions for as long as you need. Internet Lock gives you or a parent total control with one tap. Manage every device from one dashboard and get instant alerts when something tries to get through. Cancel any time — no questions.',
        trial: 'Try everything free for 7 days. No credit card charge until your trial ends. Cancel before day 7 and you pay nothing.',
        features: [
            'Adult content blocked on install',
            'Ads & trackers stripped from every page',
            'URL Scanner — phishing, malware & scams',
            'Focus Mode — block distractions on demand',
            'Internet Lock — total control with one tap',
            'Instant alerts for blocked threats',
            'Manage all devices from one dashboard',
            'Cancel any time — no questions'
        ]
    },
    yearly: {
        name: 'Pro Yearly',
        price: '$49.99',
        period: '/year',
        savings: '2 months free',
        description: 'Everything in Pro Monthly, billed once a year at just $4.17 per month. Two months completely free compared to paying monthly. One payment, twelve months of uninterrupted protection across every device in your home. No monthly reminders, no renewal anxiety — just protection running quietly in the background all year. The best option if you are serious about keeping your family safe online and want the lowest possible cost to do it.',
        trial: 'Try everything free for 7 days. No credit card charge until your trial ends. Cancel before day 7 and you pay nothing.',
        features: [
            'Everything in Pro Monthly',
            'Just $4.17/month — 2 months free',
            'One payment, 12 months of protection',
            'No monthly reminders or renewal anxiety',
            'Adult content blocked on install',
            'Ads & trackers stripped from every page',
            'URL Scanner — phishing, malware & scams',
            'Focus Mode, Internet Lock & instant alerts'
        ]
    }
};


// Payment Form Component
const PaymentForm = ({ plan, isSetupIntent, trialEligible }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;

        setLoading(true);
        setError('');

        try {
            let result;
            if (isSetupIntent) {
                // For trials - use confirmSetup
                result = await stripe.confirmSetup({
                    elements,
                    confirmParams: {
                        return_url: `${window.location.origin}/app/dashboard?trial=started`,
                    },
                });
            } else {
                // For regular payments - use confirmPayment
                result = await stripe.confirmPayment({
                    elements,
                    confirmParams: {
                        return_url: `${window.location.origin}/app/dashboard?payment=success`,
                    },
                });
            }

            if (result.error) {
                setError(result.error.message);
            }
        } catch (err) {
            setError('Payment failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const planDetails = PLANS[plan] || PLANS.monthly;

    return (
        <form onSubmit={handleSubmit} className={styles.paymentForm}>
            {/* Express Checkout - Google Pay / Apple Pay */}
            <div className={styles.expressCheckout}>
                <ExpressCheckoutElement
                    onConfirm={async (event) => {
                        if (!stripe || !elements) return;

                        setLoading(true);
                        setError('');

                        try {
                            let result;
                            if (isSetupIntent) {
                                result = await stripe.confirmSetup({
                                    elements,
                                    confirmParams: {
                                        return_url: `${window.location.origin}/app/dashboard?trial=started`,
                                    },
                                });
                            } else {
                                result = await stripe.confirmPayment({
                                    elements,
                                    confirmParams: {
                                        return_url: `${window.location.origin}/app/dashboard?payment=success`,
                                    },
                                });
                            }

                            if (result.error) {
                                setError(result.error.message);
                            }
                        } catch (err) {
                            setError('Payment failed. Please try again.');
                        } finally {
                            setLoading(false);
                        }
                    }}
                    options={{
                        wallets: {
                            applePay: 'auto',
                            googlePay: 'auto',
                        },
                    }}
                />
            </div>

            {/* Divider */}
            <div className={styles.divider}>
                <span>or pay with card</span>
            </div>

            <div className={styles.paymentElementWrapper}>
                <PaymentElement
                    options={{
                        layout: 'accordion',
                        wallets: {
                            applePay: 'never',
                            googlePay: 'never',
                        },
                    }}
                />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button
                type="submit"
                disabled={!stripe || loading}
                className={styles.submitButton}
            >
                {loading ? (
                    <>
                        <Loader className={styles.spinner} size={20} />
                        Processing...
                    </>
                ) : (
                    trialEligible
                        ? 'Start Free Trial'
                        : `Subscribe ${planDetails.price}${planDetails.period}`
                )}
            </button>

            <p className={styles.terms}>
                By subscribing, you agree to our Terms of Service and Privacy Policy.
                Cancel anytime.
            </p>
        </form>
    );
};

// Main Checkout Page
const CheckoutPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [clientSecret, setClientSecret] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [trialEligible, setTrialEligible] = useState(false);
    const [isSetupIntent, setIsSetupIntent] = useState(false);

    const searchParams = new URLSearchParams(location.search);
    const initialPlan = searchParams.get('plan') === 'yearly' ? 'yearly' : 'monthly';
    const [selectedPlan, setSelectedPlan] = useState(initialPlan);
    const plan = selectedPlan;
    const planDetails = PLANS[plan] || PLANS.monthly;

    // Re-initialize checkout when plan changes
    const [checkoutKey, setCheckoutKey] = useState(0);

    const handlePlanSwitch = (newPlan) => {
        if (newPlan === selectedPlan) return;
        setSelectedPlan(newPlan);
        setClientSecret('');
        setLoading(true);
        setError('');
        setCheckoutKey(k => k + 1);
    };

    useEffect(() => {
        const initCheckout = async () => {
            try {
                const createSubscriptionIntent = httpsCallable(functions, 'createSubscriptionIntent');
                const result = await createSubscriptionIntent({
                    plan: plan === 'monthly' ? 'pro_monthly' : 'pro_yearly'
                });

                if (result.data.clientSecret) {
                    setClientSecret(result.data.clientSecret);
                }
                setTrialEligible(result.data.trialEligible);
                setIsSetupIntent(result.data.isSetupIntent || false);
                // Don't redirect - always show payment form
            } catch (err) {
                console.error('Checkout init error:', err);
                setError(err.message || 'Failed to initialize checkout');
            } finally {
                setLoading(false);
            }
        };

        initCheckout();
    }, [plan, checkoutKey]);

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <Loader className={styles.loadingSpinner} size={40} />
                <p>Preparing your checkout...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorContainer}>
                <div className={styles.errorCard}>
                    <h2>Something went wrong</h2>
                    <p>{error}</p>
                    <button onClick={() => navigate('/')} className={styles.backButton}>
                        <ArrowLeft size={18} />
                        Back to Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.checkoutPage}>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <button onClick={() => navigate(-1)} className={styles.backLink}>
                        <ArrowLeft size={18} />
                        Back
                    </button>
                    <Logo size="sm" variant="white" />
                </div>

                <div className={styles.content}>
                    {/* Order Summary */}
                    <div className={styles.orderSummary}>
                        <h2>Order Summary</h2>

                        {/* Billing period toggle */}
                        <div className={styles.planToggle}>
                            <button
                                className={`${styles.toggleBtn} ${plan === 'monthly' ? styles.toggleActive : ''}`}
                                onClick={() => handlePlanSwitch('monthly')}
                            >
                                Monthly
                            </button>
                            <button
                                className={`${styles.toggleBtn} ${plan === 'yearly' ? styles.toggleActive : ''}`}
                                onClick={() => handlePlanSwitch('yearly')}
                            >
                                Yearly
                                <span className={styles.savePill}>Save 17%</span>
                            </button>
                        </div>

                        <div className={styles.planCard}>
                            <div className={styles.planHeader}>
                                <h3>{planDetails.name}</h3>
                                {planDetails.savings && (
                                    <span className={styles.savingsBadge}>{planDetails.savings}</span>
                                )}
                            </div>
                            <div className={styles.planPrice}>
                                <span className={styles.amount}>{planDetails.price}</span>
                                <span className={styles.period}>{planDetails.period}</span>
                            </div>
                            {trialEligible && (
                                <div className={styles.trialBadge}>
                                    🎉 {planDetails.trial}
                                </div>
                            )}
                            <p className={styles.planDescription}>{planDetails.description}</p>
                            <ul className={styles.featureList}>
                                {planDetails.features.map((feature, i) => (
                                    <li key={i}>
                                        <Check size={16} />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Payment Form */}
                    <div className={styles.paymentSection}>
                        <h2>Payment Details</h2>
                        {clientSecret ? (
                            <Elements
                                stripe={stripePromise}
                                options={{
                                    clientSecret,
                                    appearance: {
                                        theme: 'night',
                                        variables: {
                                            colorPrimary: '#6366f1',
                                            colorBackground: '#1a1a2e',
                                            colorText: '#ffffff',
                                            colorDanger: '#ef4444',
                                            fontFamily: 'Inter, system-ui, sans-serif',
                                            borderRadius: '12px',
                                        },
                                    },
                                }}
                            >
                                <PaymentForm plan={plan} isSetupIntent={isSetupIntent} trialEligible={trialEligible} />
                            </Elements>
                        ) : (
                            <div className={styles.noPaymentNeeded}>
                                <p>Your 7-day free trial has started!</p>
                                <button
                                    onClick={() => navigate('/app/dashboard')}
                                    className={styles.submitButton}
                                >
                                    Go to Dashboard
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Trust Badges */}
                <div className={styles.trustSection}>
                    <div className={styles.trustBadge}>
                        <Shield size={16} />
                        Secure checkout
                    </div>
                    <div className={styles.trustBadge}>
                        🔒 256-bit encryption
                    </div>
                    <div className={styles.trustBadge}>
                        Cancel anytime
                    </div>
                </div>
                <div className={styles.stripeBadge}>
                    <span>Payments secured by</span>
                    <span className={styles.stripeLogo}>stripe</span>
                </div>
            </div>
        </div>
    );
};

export default CheckoutPage;
