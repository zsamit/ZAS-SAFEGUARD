import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { Shield, EyeOff, Lock, Zap, Bug, Globe, Loader } from 'lucide-react';
import styles from './Protection.module.css';

const Protection = () => {
    const { user, userProfile } = useAuth();

    // Get settings from user profile
    const categories = userProfile?.settings?.categories || {};

    // Check if user has pro/lifetime - don't show Pro badge if they already have access
    const subscription = userProfile?.subscription || {};
    const isPro = subscription.plan === 'lifetime' ||
        subscription.plan === 'pro_monthly' ||
        subscription.plan === 'pro_yearly' ||
        subscription.status === 'lifetime' ||
        subscription.status === 'active';

    const [settings, setSettings] = useState({
        adult: true, // Always locked ON
        malware: true,
        ads: true,
        trackers: true,
        social: false,
        gambling: true,
        violence: true,
    });

    const [saving, setSaving] = useState(false);

    // Sync local state with Firestore data (stabilized dependency)
    useEffect(() => {
        if (categories) {
            setSettings({
                adult: true, // Always ON
                malware: categories.malware?.enabled ?? true,
                ads: categories.ads?.enabled ?? true,
                trackers: categories.trackers?.enabled ?? true,
                social: categories.social_media?.enabled ?? false,
                gambling: categories.gambling?.enabled ?? true,
                violence: categories.violence?.enabled ?? true,
            });
        }
    }, [JSON.stringify(categories)]); // Stringify to stabilize dependency

    const handleToggle = async (key) => {
        if (key === 'adult' || !user) return; // Locked ON

        const newValue = !settings[key];
        setSettings(prev => ({ ...prev, [key]: newValue }));

        // Map local key to Firestore key
        const firestoreKey = key === 'social' ? 'social_media' : key;

        setSaving(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                [`settings.categories.${firestoreKey}.enabled`]: newValue
            });
        } catch (error) {
            console.error('Error updating protection:', error);
            // Revert on error
            setSettings(prev => ({ ...prev, [key]: !newValue }));
        }
        setSaving(false);
    };

    // Show content even while loading (with default settings if no profile)

    // Protection Mode state (parental vs personal)
    const protectionMode = userProfile?.protectionMode || 'parental';
    const [modeLoading, setModeLoading] = useState(false);

    const handleModeChange = async (mode) => {
        if (!user || modeLoading) return;
        setModeLoading(true);
        try {
            await setDoc(doc(db, 'users', user.uid), {
                protectionMode: mode
            }, { merge: true });
        } catch (error) {
            console.error('Error updating mode:', error);
        }
        setModeLoading(false);
    };

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1>Protection Levels</h1>
                <p>Configure what to block across all devices.</p>
                {saving && <span className={styles.savingIndicator}>Saving...</span>}
            </header>

            {/* Protection Mode Toggle */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <Shield size={20} />
                    <h3>Protection Mode</h3>
                </div>
                <Card className={styles.toggleCard}>
                    <div className={styles.modeSelector}>
                        <p className={styles.modeDescription}>
                            Choose how alerts are handled:
                        </p>
                        <div className={styles.modeButtons}>
                            <button
                                type="button"
                                className={`${styles.modeButton} ${protectionMode === 'parental' ? styles.modeActive : ''}`}
                                onClick={() => handleModeChange('parental')}
                                disabled={modeLoading || !user}
                            >
                                <span className={styles.modeIcon}>👨‍👩‍👧</span>
                                <span className={styles.modeTitle}>Parental</span>
                                <span className={styles.modeHint}>Alerts go to parent's email</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.modeButton} ${protectionMode === 'personal' ? styles.modeActive : ''}`}
                                onClick={() => handleModeChange('personal')}
                                disabled={modeLoading || !user}
                            >
                                <span className={styles.modeIcon}>🔒</span>
                                <span className={styles.modeTitle}>Personal</span>
                                <span className={styles.modeHint}>Self-control, minimal alerts</span>
                            </button>
                        </div>
                        <p className={styles.modeCurrentInfo}>
                            {protectionMode === 'parental'
                                ? '📧 DevTools, blocked sites, extension disables → Email parent'
                                : '📧 Only extension disable → Email self'}
                        </p>
                    </div>
                </Card>
            </section>

            {/* Core Security */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <Shield size={20} />
                    <h3>Core Security</h3>
                </div>
                <Card className={styles.toggleCard}>
                    <ProtectionItem
                        label="Adult Content Protection"
                        description="Blocks explicit content, gambling, and violent material."
                        checked={settings.adult}
                        onChange={() => handleToggle('adult')}
                        locked
                        icon={<Lock size={16} />}
                    />
                    <div className={styles.divider} />
                    <ProtectionItem
                        label="Phishing & Malware Protection"
                        description="Real-time scanning for malware and deceptive sites."
                        checked={settings.malware}
                        onChange={() => handleToggle('malware')}
                        badge={isPro ? null : "Pro"}
                        icon={<Bug size={16} />}
                    />
                </Card>
            </section>

            {/* Privacy & Ads */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <EyeOff size={20} />
                    <h3>Privacy & Ads</h3>
                </div>
                <Card className={styles.toggleCard}>
                    <ProtectionItem
                        label="Ad Blocker"
                        description="Removes intrusive ads from websites and videos."
                        checked={settings.ads}
                        onChange={() => handleToggle('ads')}
                    />
                    <div className={styles.divider} />
                    <ProtectionItem
                        label="Tracker Blocking"
                        description="Stops data collectors from following your browsing history."
                        checked={settings.trackers}
                        onChange={() => handleToggle('trackers')}
                    />
                </Card>
            </section>

            {/* Focus */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <Zap size={20} />
                    <h3>Focus Mode</h3>
                </div>
                <Card className={styles.toggleCard}>
                    <ProtectionItem
                        label="Block Social Media"
                        description="Restricts access to Instagram, TikTok, Twitter, YouTube, etc."
                        checked={settings.social}
                        onChange={() => handleToggle('social')}
                        helperText="Active during Focus Mode or Internet Lock"
                    />
                </Card>
            </section>

            {/* Content Categories */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <Globe size={20} />
                    <h3>Content Categories</h3>
                </div>
                <Card className={styles.toggleCard}>
                    <ProtectionItem
                        label="Gambling Sites"
                        description="Blocks online casinos, betting, and gambling platforms."
                        checked={settings.gambling}
                        onChange={() => handleToggle('gambling')}
                    />
                    <div className={styles.divider} />
                    <ProtectionItem
                        label="Violence & Gore"
                        description="Blocks extremely violent or graphic content."
                        checked={settings.violence}
                        onChange={() => handleToggle('violence')}
                    />
                </Card>
            </section>
        </div>
    );
};

const ProtectionItem = ({
    label,
    description,
    checked,
    onChange,
    locked,
    badge,
    icon,
    helperText
}) => (
    <div className={styles.protectionItem}>
        <div className={styles.itemContent}>
            <div className={styles.itemHeader}>
                {icon && <span className={styles.itemIcon}>{icon}</span>}
                <span className={styles.itemLabel}>{label}</span>
                {badge && <Badge variant="pro">{badge}</Badge>}
            </div>
            <p className={styles.itemDescription}>{description}</p>
            {helperText && <p className={styles.helperText}>{helperText}</p>}
        </div>
        <div className={styles.itemControl}>
            {locked && <span className={styles.lockedLabel}>Locked On</span>}
            <Toggle
                checked={checked}
                onChange={onChange}
                disabled={locked}
                locked={locked}
            />
        </div>
    </div>
);

export default Protection;
