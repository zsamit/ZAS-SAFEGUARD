import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, X, Sparkles, Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import styles from './TrialExpiredModal.module.css';

/**
 * TrialExpiredModal - Shows when user's trial has ended or subscription is inactive
 */
const TrialExpiredModal = ({ isOpen, onClose, subscription }) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleUpgrade = () => {
        navigate('/app/checkout?plan=monthly');
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
                        <span>Focus Mode for productivity</span>
                    </div>
                    <div className={styles.feature}>
                        <Check size={16} />
                        <span>Unlimited devices</span>
                    </div>
                </div>

                <div className={styles.pricing}>
                    <span className={styles.price}>$4.99</span>
                    <span className={styles.period}>/month</span>
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
