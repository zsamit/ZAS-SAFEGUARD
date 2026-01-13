import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { Shield, Check, ArrowLeft, Loader } from 'lucide-react';
import Logo from '../../components/Logo';
import styles from './CheckoutPage.module.css';

// Initialize Stripe
const stripePromise = loadStripe('pk_live_51SROIVRwbGN3ywzEmYipPR4iUh1nM6QDVDzQlbaaO7oWSicFgUHR7Aaczgh1sIXizRzNgvs6IfDP2C1uu5v9yTaY00C2MzNjDV');

// Plan details
const PLANS = {
    monthly: {
        name: 'Pro Monthly',
        price: '$4.99',
        period: '/month',
        features: [
            'Adult content blocking',
            'Ad & tracker blocking',
            'Unlimited devices',
            'Focus Mode',
            'Priority support'
        ]
    },
    yearly: {
        name: 'Pro Yearly',
        price: '$59.99',
        period: '/year',
        savings: 'Save 17%',
        features: [
            'Everything in Monthly',
            '2 months free',
            'Priority support',
            'Early access to features',
            'Family sharing (up to 5)'
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
            <div className={styles.paymentElementWrapper}>
                <PaymentElement
                    options={{
                        layout: 'accordion',
                        wallets: {
                            applePay: 'auto',
                            googlePay: 'auto',
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
    const plan = searchParams.get('plan') || 'monthly';
    const planDetails = PLANS[plan] || PLANS.monthly;

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
    }, [plan, navigate]);

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
                                    🎉 7-day free trial included!
                                </div>
                            )}
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
                    <svg viewBox="0 0 60 25" xmlns="http://www.w3.org/2000/svg" width="60" height="25" style={{ marginLeft: '8px' }}>
                        <path fill="#635BFF" d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-6.3-5.88c-1.06 0-1.77.8-1.94 2.07h3.79c-.14-1.27-.79-2.07-1.85-2.07zM41.56 5.55V2.1l4.22-.9v4.35h2.52v3.52h-2.52v4.88c0 1.13.47 1.52 1.33 1.52.4 0 .85-.05 1.19-.14v3.48c-.67.2-1.52.3-2.43.3-2.69 0-4.52-1.32-4.52-4.47V9.07h-1.72V5.55h1.93zm-6.12 0l.21 1.32a4.04 4.04 0 0 1 3.38-1.55c2.9 0 4.37 1.95 4.37 5.27v8.38h-4.22v-7.84c0-1.41-.45-2.13-1.49-2.13-.63 0-1.17.32-1.56.86-.37.54-.47 1.27-.47 2.02v7.09h-4.22V5.55h4zm-9.2-3.45l4.23-.9v17.77h-4.22V2.1zm-8.98 8.95c0-4.47 2.96-7.75 7.62-7.75 1.14 0 2.08.15 2.93.41v3.96a4.5 4.5 0 0 0-2.44-.68c-2.1 0-3.53 1.5-3.53 4.01 0 2.47 1.42 3.9 3.5 3.9.93 0 1.86-.24 2.47-.65v3.91c-.85.26-1.81.42-2.93.42-4.62 0-7.62-3.25-7.62-7.53zM5.8 6.24c-.6-1.27-1.43-1.9-2.71-1.9-1.2 0-2.13.62-2.13 1.68 0 .97.65 1.4 1.71 1.73L4.3 8.3c2.58.78 4.25 2.16 4.25 4.81 0 3.23-2.66 5.5-6.1 5.5A6.73 6.73 0 0 1 0 17.09l1.76-3.27c.67 1.57 1.88 2.3 3.26 2.3 1.4 0 2.35-.76 2.35-1.86 0-1.11-.75-1.57-2.04-1.98l-1.6-.52C1.37 11 .03 9.51.03 6.95.03 3.97 2.5 1.54 5.78 1.54c2.24 0 4.03 1.1 4.94 3.33z" />
                    </svg>
                </div>
            </div>
        </div>
    );
};

export default CheckoutPage;
