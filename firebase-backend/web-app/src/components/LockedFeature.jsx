import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Shield, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from './ui/Button';
import styles from './LockedFeature.module.css';

const FEATURE_INFO = {
    security_intelligence: {
        title: 'Ad & Threat Protection',
        description: 'Advanced AI-powered threat detection that monitors web traffic in real-time, blocking malware, phishing attempts, and malicious scripts before they reach your browser.',
        icon: Shield
    },
    url_scanning: {
        title: 'URL Scanner',
        description: 'Scan any URL before visiting. Check links against global threat databases and receive instant safety ratings to protect against phishing and malicious websites.',
        icon: Shield
    },
    category_blocking: {
        title: 'Category Controls',
        description: 'Fine-grained content filtering by category. Block social media, gaming, gambling, or other distracting content categories with customizable schedules.',
        icon: Shield
    },
    study_mode: {
        title: 'Study & Focus Mode',
        description: 'Lock distractions during study sessions or deep work. Schedule quiet hours, set focus timers, and create distraction-free browsing environments.',
        icon: Shield
    },
    analytics: {
        title: 'Analytics Dashboard',
        description: 'Detailed browsing analytics showing threats blocked, time saved, and protection statistics. Understand your browsing patterns and security posture.',
        icon: Shield
    },
    dashboard_admin: {
        title: 'Dashboard Administration',
        description: 'Manage connected devices, family members, and protection policies from a centralized control panel. Monitor activity and configure alerts.',
        icon: Shield
    },
    advanced_alerts: {
        title: 'Advanced Alerts',
        description: 'Receive detailed security notifications about blocked threats, suspicious activity, and protection events. Configure alert thresholds and notification preferences.',
        icon: Shield
    }
};

const LockedFeature = ({ feature, customTitle, customDescription }) => {
    const navigate = useNavigate();
    const info = FEATURE_INFO[feature] || {};
    const title = customTitle || info.title || 'Premium Feature';
    const description = customDescription || info.description || 'This feature is included in Premium.';
    const IconComponent = info.icon || Shield;

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.iconWrapper}>
                    <Lock size={32} className={styles.lockIcon} />
                </div>

                <div className={styles.badge}>
                    <Sparkles size={14} />
                    <span>Premium Feature</span>
                </div>

                <h2 className={styles.title}>{title}</h2>

                <p className={styles.description}>{description}</p>

                <div className={styles.activeNotice}>
                    <Shield size={16} />
                    <span>Adult blocking remains active on your current plan.</span>
                </div>

                <div className={styles.actions}>
                    <Button
                        size="lg"
                        onClick={() => navigate('/app/checkout?plan=yearly')}
                    >
                        <Sparkles size={16} />
                        Upgrade to Premium
                    </Button>
                    <button
                        className={styles.compareLink}
                        onClick={() => navigate('/')}
                    >
                        Compare plans <ArrowRight size={14} />
                    </button>
                </div>

                <p className={styles.footer}>
                    Upgrade to restore full AI Browser Security protection.
                </p>
            </div>
        </div>
    );
};

export default LockedFeature;
