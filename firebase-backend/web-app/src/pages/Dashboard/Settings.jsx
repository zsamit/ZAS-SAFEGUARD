import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import {
    User,
    CreditCard,
    Bell,
    Shield,
    Clock,
    Globe,
    ExternalLink,
    Trash2,
    Loader
} from 'lucide-react';
import styles from './Settings.module.css';

const Settings = () => {
    const { user, userProfile, logout } = useAuth();

    const [notifications, setNotifications] = useState({
        emailAlerts: true,
        pushNotifications: true,
        weeklyReport: true,
    });

    const [quietHours, setQuietHours] = useState({
        enabled: false,
        start: '22:00',
        end: '07:00',
    });

    const [saving, setSaving] = useState(false);

    // Get subscription from user profile
    const subscription = userProfile?.subscription || {};

    // Determine plan name - check for lifetime first
    const getPlanName = () => {
        if (subscription.plan === 'lifetime' || subscription.status === 'lifetime') {
            return 'Lifetime';
        }
        if (subscription.plan === 'pro_monthly') return 'Pro Monthly';
        if (subscription.plan === 'pro_yearly') return 'Pro Yearly';
        if (subscription.trialActive) return 'Trial';
        return 'Free';
    };
    const planName = getPlanName();

    const isLifetime = subscription.plan === 'lifetime' || subscription.status === 'lifetime';
    const subscriptionStatus = isLifetime ? 'lifetime' : (subscription.status || 'free');

    // Calculate next billing date
    const getNextBillingDate = () => {
        if (isLifetime) return 'Never - Lifetime Access';
        if (subscription.trialEnd) {
            const trialEnd = subscription.trialEnd.toDate?.() || new Date(subscription.trialEnd);
            return trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        }
        return 'N/A';
    };

    if (!userProfile) {
        return (
            <div className={styles.page}>
                <div className={styles.loadingState}>
                    <Loader size={32} className={styles.spinner} />
                    <span>Loading settings...</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1>Settings</h1>
                <p>Manage your account and preferences.</p>
            </header>

            {/* Account - REAL DATA */}
            <section className={styles.section}>
                <h3>
                    <User size={18} />
                    Account
                </h3>
                <Card className={styles.formCard}>
                    <div className={styles.formRow}>
                        <Input
                            label="Display Name"
                            defaultValue={userProfile.displayName || user?.displayName || ''}
                        />
                        <Input
                            label="Mode"
                            defaultValue={userProfile.mode?.charAt(0).toUpperCase() + userProfile.mode?.slice(1) || 'Owner'}
                            disabled
                        />
                    </div>
                    <Input
                        label="Email"
                        defaultValue={user?.email || ''}
                        disabled
                    />
                    <Button variant="secondary" className={styles.updateBtn}>
                        Update Profile
                    </Button>
                </Card>
            </section>

            {/* Subscription - REAL DATA */}
            <section className={styles.section}>
                <h3>
                    <CreditCard size={18} />
                    Subscription
                </h3>
                <Card variant="info" className={styles.subCard}>
                    <div className={styles.subHeader}>
                        <div>
                            <div className={styles.planName}>
                                <h4>{planName.charAt(0).toUpperCase() + planName.slice(1)} Plan</h4>
                                <Badge variant={subscriptionStatus === 'active' || subscription.trialActive ? 'success' : 'warning'}>
                                    {subscription.trialActive ? 'Trial' : subscriptionStatus.charAt(0).toUpperCase() + subscriptionStatus.slice(1)}
                                </Badge>
                            </div>
                            <p>
                                {isLifetime
                                    ? 'Thank you for your lifetime support!'
                                    : subscription.trialActive
                                        ? `Trial ends: ${getNextBillingDate()}`
                                        : `Next billing date: ${getNextBillingDate()}`}
                            </p>
                        </div>
                        <div className={styles.planPrice}>
                            <span className={styles.price}>
                                {isLifetime ? 'Paid' :
                                    subscription.plan === 'pro_monthly' ? '$5.99' :
                                        subscription.plan === 'pro_yearly' ? '$59.99' : 'Free'}
                            </span>
                            <span className={styles.period}>
                                {isLifetime ? '∞' :
                                    subscription.plan ? (subscription.plan.includes('yearly') ? '/year' : '/month') : ''}
                            </span>
                        </div>
                    </div>
                    {!isLifetime && (
                        <div className={styles.subActions}>
                            <Button variant="secondary" size="sm">
                                Manage Subscription
                            </Button>
                            <Button variant="ghost" size="sm">
                                View Invoices
                                <ExternalLink size={14} />
                            </Button>
                        </div>
                    )}
                </Card>
            </section>

            {/* Notifications */}
            <section className={styles.section}>
                <h3>
                    <Bell size={18} />
                    Notifications
                </h3>
                <Card className={styles.toggleCard}>
                    <ToggleItem
                        label="Email Alerts"
                        description="Receive security alerts via email"
                        checked={notifications.emailAlerts}
                        onChange={() => setNotifications(n => ({ ...n, emailAlerts: !n.emailAlerts }))}
                    />
                    <div className={styles.divider} />
                    <ToggleItem
                        label="Push Notifications"
                        description="Browser and mobile push notifications"
                        checked={notifications.pushNotifications}
                        onChange={() => setNotifications(n => ({ ...n, pushNotifications: !n.pushNotifications }))}
                    />
                    <div className={styles.divider} />
                    <ToggleItem
                        label="Weekly Report"
                        description="Summary of your protection activity"
                        checked={notifications.weeklyReport}
                        onChange={() => setNotifications(n => ({ ...n, weeklyReport: !n.weeklyReport }))}
                    />
                </Card>
            </section>

            {/* Privacy & Timezone */}
            <section className={styles.section}>
                <h3>
                    <Globe size={18} />
                    Privacy & Region
                </h3>
                <Card className={styles.formCard}>
                    <div className={styles.selectRow}>
                        <label>Timezone</label>
                        <select defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}>
                            <option value="America/New_York">Eastern Time (ET)</option>
                            <option value="America/Chicago">Central Time (CT)</option>
                            <option value="America/Denver">Mountain Time (MT)</option>
                            <option value="America/Los_Angeles">Pacific Time (PT)</option>
                            <option value="Europe/London">London (GMT)</option>
                            <option value="Asia/Dubai">Dubai (GST)</option>
                            <option value="Asia/Karachi">Karachi (PKT)</option>
                        </select>
                    </div>
                </Card>
            </section>

            {/* Quiet Hours */}
            <section className={styles.section}>
                <h3>
                    <Clock size={18} />
                    Quiet Hours
                </h3>
                <Card className={styles.quietCard}>
                    <div className={styles.quietHeader}>
                        <div>
                            <h4>Enable Quiet Hours</h4>
                            <p>Pause non-critical notifications during specific times</p>
                        </div>
                        <Toggle
                            checked={quietHours.enabled}
                            onChange={() => setQuietHours(q => ({ ...q, enabled: !q.enabled }))}
                        />
                    </div>
                    {quietHours.enabled && (
                        <div className={styles.quietTimes}>
                            <div className={styles.timeInput}>
                                <label>Start</label>
                                <input
                                    type="time"
                                    value={quietHours.start}
                                    onChange={(e) => setQuietHours(q => ({ ...q, start: e.target.value }))}
                                />
                            </div>
                            <div className={styles.timeInput}>
                                <label>End</label>
                                <input
                                    type="time"
                                    value={quietHours.end}
                                    onChange={(e) => setQuietHours(q => ({ ...q, end: e.target.value }))}
                                />
                            </div>
                        </div>
                    )}
                </Card>
            </section>

            {/* Danger Zone */}
            <section className={`${styles.section} ${styles.danger}`}>
                <h3>
                    <Shield size={18} />
                    Danger Zone
                </h3>
                <Card className={styles.dangerCard}>
                    <div>
                        <h4>Delete Account</h4>
                        <p>Permanently delete your account and all associated data.</p>
                    </div>
                    <Button variant="danger" size="sm">
                        <Trash2 size={16} />
                        Delete Account
                    </Button>
                </Card>
            </section>
        </div>
    );
};

const ToggleItem = ({ label, description, checked, onChange }) => (
    <div className={styles.toggleItem}>
        <div>
            <span className={styles.toggleLabel}>{label}</span>
            <span className={styles.toggleDesc}>{description}</span>
        </div>
        <Toggle checked={checked} onChange={onChange} />
    </div>
);

export default Settings;
