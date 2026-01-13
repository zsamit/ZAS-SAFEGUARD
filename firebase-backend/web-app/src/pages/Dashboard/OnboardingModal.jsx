import React, { useState } from 'react';
import { db } from '../../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { Shield, Users, Lock } from 'lucide-react';
import styles from './OnboardingModal.module.css';

const OnboardingModal = ({ onComplete }) => {
    const { user } = useAuth();
    const [saving, setSaving] = useState(false);

    const handleSelect = async (mode) => {
        if (!user || saving) return;
        setSaving(true);
        try {
            await setDoc(doc(db, 'users', user.uid), {
                protectionMode: mode,
                onboardingComplete: true
            }, { merge: true });
            onComplete?.();
        } catch (error) {
            console.error('Error saving mode:', error);
        }
        setSaving(false);
    };

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <Shield size={40} className={styles.icon} />
                    <h1>Welcome to ZAS Safeguard!</h1>
                    <p>How will you be using this protection?</p>
                </div>

                <div className={styles.options}>
                    <button
                        type="button"
                        className={styles.optionCard}
                        onClick={() => handleSelect('parental')}
                        disabled={saving}
                    >
                        <span className={styles.optionIcon}>👨‍👩‍👧</span>
                        <span className={styles.optionTitle}>Parental Control</span>
                        <span className={styles.optionDesc}>
                            I'm a parent protecting my child's device.
                            All activity alerts will be sent to my email.
                        </span>
                        <ul className={styles.features}>
                            <li>📧 Get emails for blocked sites</li>
                            <li>📧 Get emails for DevTools usage</li>
                            <li>📧 Get emails if extension is disabled</li>
                        </ul>
                    </button>

                    <button
                        type="button"
                        className={styles.optionCard}
                        onClick={() => handleSelect('personal')}
                        disabled={saving}
                    >
                        <span className={styles.optionIcon}>🔒</span>
                        <span className={styles.optionTitle}>Personal Use</span>
                        <span className={styles.optionDesc}>
                            I'm protecting myself (self-control mode).
                            Only critical alerts will be sent.
                        </span>
                        <ul className={styles.features}>
                            <li>❌ No emails for blocked sites</li>
                            <li>❌ No emails for DevTools</li>
                            <li>📧 Only email if extension disabled</li>
                        </ul>
                    </button>
                </div>

                <p className={styles.footer}>
                    You can change this later in Protection settings.
                </p>
            </div>
        </div>
    );
};

export default OnboardingModal;
