import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { useAuth } from '../../context/AuthContext';
import { db, app, auth } from '../../firebase';
import { doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    User,
    CreditCard,
    Bell,
    Shield,
    Clock,
    Globe,
    ExternalLink,
    Trash2,
    Loader,
    LogOut,
    Save
} from 'lucide-react';
import styles from './Settings.module.css';

// UI-07: Inline CheckCircle2 and XCircle for toast
import { CheckCircle2, XCircle } from 'lucide-react';

const Settings = () => {
    const { user, userProfile, logout } = useAuth();
    const functions = getFunctions(app);

    const [notifications, setNotifications] = useState({
        dailyDigestEnabled: true,
        instantAlertsEnabled: true,
        weeklyReportEnabled: true,
    });

    const [quietHours, setQuietHours] = useState({
        enabled: false,
        start: '22:00',
        end: '07:00',
    });

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [loadingPortal, setLoadingPortal] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState('');

    // UI-07: Toast notification state (replaces native alert())
    const [toast, setToast] = useState(null);
    const showToast = (message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    // Load notification settings from Firestore
    useEffect(() => {
        if (user?.uid) {
            loadSettings();
        }
    }, [user?.uid]);

    const loadSettings = async () => {
        try {
            // Load from user profile (where Cloud Functions check)
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                const settings = data.settings || {};
                setNotifications({
                    dailyDigestEnabled: settings.dailyDigestEnabled ?? true,
                    instantAlertsEnabled: settings.instantAlertsEnabled ?? true,
                    weeklyReportEnabled: settings.weeklyReportEnabled ?? true,
                });
                setQuietHours({
                    enabled: settings.quietHoursEnabled ?? false,
                    start: settings.quietStart || '22:00',
                    end: settings.quietEnd || '07:00',
                });
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    };

    // Save notification settings to Firestore (user profile)
    const saveSettings = async () => {
        if (!user?.uid) return;
        setSaving(true);
        try {
            // Save to user profile settings (where Cloud Functions check)
            await setDoc(doc(db, 'users', user.uid), {
                settings: {
                    dailyDigestEnabled: notifications.dailyDigestEnabled,
                    instantAlertsEnabled: notifications.instantAlertsEnabled,
                    weeklyReportEnabled: notifications.weeklyReportEnabled,
                    quietHoursEnabled: quietHours.enabled,
                    quietStart: quietHours.start,
                    quietEnd: quietHours.end,
                    updatedAt: new Date(),
                }
            }, { merge: true });
            showToast('Settings saved!', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            showToast('Failed to save settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    // Handle Manage Subscription - opens Stripe portal
    const handleManageSubscription = async () => {
        setLoadingPortal(true);
        try {
            // Debug: Check if user is authenticated
            const currentUser = auth.currentUser;
            if (!currentUser) {
                showToast('You are not logged in. Please log in first.', 'error');
                setLoadingPortal(false);
                return;
            }
            console.log('Current user UID:', currentUser.uid);

            // Get fresh ID token to ensure it's valid
            const idToken = await currentUser.getIdToken(true);
            console.log('Got fresh ID token, length:', idToken?.length);

            const createPortalSession = httpsCallable(functions, 'createPortalSession');
            const result = await createPortalSession({ returnUrl: window.location.href });
            if (result.data?.url) {
                window.open(result.data.url, '_blank');
            } else {
                showToast('Could not open billing portal. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Portal error:', error);
            showToast('Error opening billing portal: ' + error.message, 'error');
        } finally {
            setLoadingPortal(false);
        }
    };

    // Handle View Invoices
    const handleViewInvoices = async () => {
        try {
            const getInvoices = httpsCallable(functions, 'getInvoices');
            const result = await getInvoices({ limit: 10 });
            if (result.data?.invoices?.length > 0) {
                // Open first invoice PDF or hosted URL
                const invoice = result.data.invoices[0];
                window.open(invoice.hostedUrl || invoice.pdfUrl, '_blank');
            } else {
                showToast('No invoices found.', 'info');
            }
        } catch (error) {
            console.error('Invoices error:', error);
            showToast('Error loading invoices: ' + error.message, 'error');
        }
    };

    // Handle Delete Account
    const handleDeleteAccount = async () => {
        if (deleteConfirm !== 'DELETE') {
            showToast('Please type DELETE to confirm', 'error');
            return;
        }

        // No more window.confirm - typing DELETE is the confirmation
        setDeleting(true);
        try {
            // Verify user is authenticated before calling Cloud Function
            const currentUser = auth.currentUser;
            if (!currentUser) {
                showToast('You are not logged in. Please log in first.', 'error');
                setDeleting(false);
                return;
            }
            console.log('Deleting account for UID:', currentUser.uid);

            // Get fresh ID token to ensure auth is passed to Cloud Function
            await currentUser.getIdToken(true);
            console.log('Got fresh ID token for deletion');

            const deleteAccount = httpsCallable(functions, 'deleteAccount');
            await deleteAccount({ confirmDelete: 'DELETE_MY_ACCOUNT' });
            showToast('Account deleted. Goodbye!', 'success');

            // Force sign out directly from auth
            try {
                await auth.signOut();
            } catch (e) {
                console.log('Already signed out');
            }

            // Hard redirect to landing page
            window.location.replace('/');
        } catch (error) {
            console.error('Delete error:', error);
            showToast('Error deleting account: ' + error.message, 'error');
        } finally {
            setDeleting(false);
        }
    };

    // Handle Logout
    const handleLogout = async () => {
        try {
            await logout();
            // Redirect handled by AuthContext
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

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

    // Don't block on userProfile - show settings with defaults if not logged in

    return (
        <div className={styles.page}>
            {/* UI-07: Toast notification */}
            {toast && (
                <div style={{
                    position: 'fixed', top: 24, right: 24, zIndex: 9999,
                    padding: '12px 20px', borderRadius: 10,
                    background: toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#6366f1',
                    color: '#fff', display: 'flex', alignItems: 'center', gap: 8,
                    boxShadow: '0 4px 24px rgba(0,0,0,0.18)', fontSize: 14, fontWeight: 500,
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    {toast.type === 'success' ? <CheckCircle2 size={16} /> : toast.type === 'error' ? <XCircle size={16} /> : null}
                    {toast.message}
                </div>
            )}

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
                            defaultValue={userProfile?.displayName || user?.displayName || ''}
                        />
                        <Input
                            label="Mode"
                            defaultValue={userProfile?.mode?.charAt(0).toUpperCase() + userProfile?.mode?.slice(1) || 'Owner'}
                            disabled
                        />
                    </div>
                    <Input
                        label="Email"
                        defaultValue={user?.email || ''}
                        disabled
                    />
                    <div className={styles.accountActions}>
                        <Button variant="secondary" className={styles.updateBtn}>
                            Update Profile
                        </Button>
                        <Button variant="ghost" onClick={handleLogout}>
                            <LogOut size={16} />
                            Log Out
                        </Button>
                    </div>
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
                                    subscription.plan === 'pro_monthly' ? '$4.99' :
                                        subscription.plan === 'pro_yearly' ? '$49.99' : 'Free'}
                            </span>
                            <span className={styles.period}>
                                {isLifetime ? '∞' :
                                    subscription.plan ? (subscription.plan.includes('yearly') ? '/year' : '/month') : ''}
                            </span>
                        </div>
                    </div>
                    {!isLifetime && (
                        <div className={styles.subActions}>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleManageSubscription}
                                disabled={loadingPortal}
                            >
                                {loadingPortal ? <Loader size={14} className={styles.spinner} /> : 'Manage Subscription'}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleViewInvoices}>
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
                        label="Daily Digest"
                        description="Receive a morning summary email of yesterday's activity"
                        checked={notifications.dailyDigestEnabled}
                        onChange={() => setNotifications(n => ({ ...n, dailyDigestEnabled: !n.dailyDigestEnabled }))}
                    />
                    <div className={styles.divider} />
                    <ToggleItem
                        label="Instant Alerts"
                        description="Get notified immediately for security events"
                        checked={notifications.instantAlertsEnabled}
                        onChange={() => setNotifications(n => ({ ...n, instantAlertsEnabled: !n.instantAlertsEnabled }))}
                    />
                    <div className={styles.divider} />
                    <ToggleItem
                        label="Weekly Report"
                        description="Comprehensive weekly protection summary (Sundays)"
                        checked={notifications.weeklyReportEnabled}
                        onChange={() => setNotifications(n => ({ ...n, weeklyReportEnabled: !n.weeklyReportEnabled }))}
                    />
                    <div className={styles.saveRow}>
                        <Button onClick={saveSettings} disabled={saving}>
                            {saving ? <Loader size={14} className={styles.spinner} /> : <Save size={14} />}
                            Save Settings
                        </Button>
                    </div>
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
                        <div className={styles.deleteConfirm}>
                            <Input
                                placeholder="Type DELETE to confirm"
                                value={deleteConfirm}
                                onChange={(e) => setDeleteConfirm(e.target.value)}
                            />
                        </div>
                    </div>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={handleDeleteAccount}
                        disabled={deleting || deleteConfirm !== 'DELETE'}
                    >
                        {deleting ? <Loader size={16} className={styles.spinner} /> : <Trash2 size={16} />}
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
