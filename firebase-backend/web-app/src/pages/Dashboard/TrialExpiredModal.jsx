import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, X, Sparkles, Check, Star } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import styles from './TrialExpiredModal.module.css';

/**
 * TrialExpiredModal - Shows when user's trial has ended or subscription is inactive
 */
const TrialExpiredModal = ({ isOpen, onClose, subscription }) => {
    const navigate = useNavigate();
    const [selectedPlan, setSelectedPlan] = useState('yearly'); // Default to yearly (better value)

    if (!isOpen) return null;

    const handleUpgrade = () => {
        navigate(`/app/checkout?plan=${selectedPlan}`);
        onClose();
    };

    const plans = {
        monthly: { price: '$4.99', period: '/month', savings: null },
        yearly: { price: '$49.99', period: '/year', savings: 'Save 17%', monthly: '$4.17/mo' }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <button className={styles.closeBtn} onClick={onClose}>
                    <X size={20} />
                </button>

                <div className={styles.iconWrapper}>
                    <Shield size={48} />
                </div>

                <h2>Your Free Trial Has Ended</h2>
                <p className={styles.subtitle}>
                    Subscribe now to continue protecting yourself and your family online.
                </p>

                <div className={styles.features}>
                    <div className={styles.feature}>
                        <Check size={16} />
                        <span>Block adult content & harmful sites</span>
                    </div>
                    <div className={styles.feature}>
                        <Check size={16} />
                        <span>Remove ads & trackers</span>
                    </div>
                    <div className={styles.feature}>
                        <Check size={16} />
                        <span>Malware & phishing protection</span>
                    </div>
                    <div className={styles.feature}>
                        <Check size={16} />
                        <span>Focus Mode for productivity</span>
                    </div>
                    <div className={styles.feature}>
                        <Check size={16} />
                        <span>Unlimited devices</span>
                    </div>
                </div>

                {/* Plan Toggle */}
                <div className={styles.planToggle}>
                    <button
                        className={`${styles.planOption} ${selectedPlan === 'monthly' ? styles.planActive : ''}`}
                        onClick={() => setSelectedPlan('monthly')}
                    >
                        <span className={styles.planLabel}>Monthly</span>
                        <span className={styles.planPrice}>{plans.monthly.price}</span>
                    </button>
                    <button
                        className={`${styles.planOption} ${selectedPlan === 'yearly' ? styles.planActive : ''}`}
                        onClick={() => setSelectedPlan('yearly')}
                    >
                        {plans.yearly.savings && (
                            <span className={styles.savingsBadge}>
                                <Star size={12} />
                                {plans.yearly.savings}
                            </span>
                        )}
                        <span className={styles.planLabel}>Yearly</span>
                        <span className={styles.planPrice}>{plans.yearly.price}</span>
                        <span className={styles.planMonthly}>{plans.yearly.monthly}</span>
                    </button>
                </div>

                <Button size="lg" fullWidth onClick={handleUpgrade}>
                    <Sparkles size={18} />
                    Upgrade to Pro
                </Button>

                <p className={styles.note}>
                    Cancel anytime • 7-day money-back guarantee
                </p>
            </div>
        </div>
    );
};

export default TrialExpiredModal;
