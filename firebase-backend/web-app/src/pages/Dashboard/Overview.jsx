import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStats, useProtectionStatus } from '../../hooks/useFirestore';
import { useFocusMode, useInternetLock } from '../../hooks/useExtension';
import TrialExpiredModal from './TrialExpiredModal';
import {
    ShieldCheck,
    ShieldAlert,
    Ban,
    Smartphone,
    Bell,
    ScanLine,
    Focus,
    Wifi,
    AlertCircle,
    Loader,
    Clock,
    X,
    Lock,
    Shield,
    Sparkles,
    Eye,
    BookOpen,
    BarChart3,
    Users,
    ArrowRight
} from 'lucide-react';
import styles from './Overview.module.css';

// Local quotes - no external API
const quotes = {
    motivational: [
        { text: "The best way to predict the future is to create it.", author: "Abraham Lincoln" },
        { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
        { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
        { text: "Your focus determines your reality.", author: "Qui-Gon Jinn" },
    ],
    islamic: [
        { text: "Verily, with hardship comes ease.", author: "Quran 94:6" },
        { text: "The strong person is not the one who can overpower others, but the one who controls themselves when angry.", author: "Prophet Muhammad ﷺ" },
        { text: "Take advantage of five before five: your youth before your old age, your health before your sickness, your wealth before your poverty, your free time before your busyness, and your life before your death.", author: "Prophet Muhammad ﷺ" },
    ]
};

// Duration options for Focus Mode
const DURATION_OPTIONS = [
    { label: '30 min', minutes: 30 },
    { label: '1 hour', minutes: 60 },
    { label: '2 hours', minutes: 120 },
    { label: '4 hours', minutes: 240 },
    { label: 'Until midnight', minutes: 'midnight' },
    { label: 'Until tomorrow', minutes: 'tomorrow' },
];

const Overview = () => {
    const navigate = useNavigate();
    const { isActive, isExpired, isTrial, isPremium, planName } = useOutletContext();

    // Real data from Firebase
    const { userProfile } = useAuth();
    const stats = useDashboardStats();
    const { status, isProtected } = useProtectionStatus();

    // Extension-controlled states (persisted)
    const { isActive: focusModeActive, toggleFocusMode, loading: focusLoading, endTime: focusEndTime, startFocusWithDuration } = useFocusMode();
    const { isLocked: internetLockActive, toggleInternetLock, loading: lockLoading } = useInternetLock();

    // Extension stats (real-time from extension)
    const [extensionStats, setExtensionStats] = useState(null);

    // Duration picker modal
    const [showDurationPicker, setShowDurationPicker] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState('');

    // Trial expired modal state
    const [showTrialExpired, setShowTrialExpired] = useState(false);

    // Check if trial/subscription is expired on mount
    useEffect(() => {
        console.log('[TrialCheck] userProfile:', userProfile);
        console.log('[TrialCheck] subscription:', userProfile?.subscription);

        if (userProfile?.subscription) {
            const sub = userProfile.subscription;
            // Check both 'status' and 'plan_status' fields (Firestore structure varies)
            const status = (sub.status || sub.plan_status || '').toLowerCase();
            const plan = (sub.plan || '').toLowerCase();

            console.log('[TrialCheck] Status:', status, '| Plan:', plan);

            // Show popup for these statuses
            const expiredStatuses = ['canceled', 'cancelled', 'unpaid', 'past_due', 'incomplete_expired', 'expired', 'inactive'];

            // Check if subscription is expired OR user is on free plan after trial
            const isExpired = expiredStatuses.includes(status);
            const isFreeAfterTrial = plan === 'free' && sub.trial_active === false;

            // Check if trial ended without converting
            const trialEnd = sub.trial_end;
            let trialEnded = false;
            if (trialEnd) {
                const endDate = trialEnd.toDate ? trialEnd.toDate() : new Date(trialEnd);
                trialEnded = endDate < new Date() && status !== 'active';
                console.log('[TrialCheck] Trial end date:', endDate, '| Ended:', trialEnded);
            }

            console.log('[TrialCheck] isExpired:', isExpired, '| isFreeAfterTrial:', isFreeAfterTrial, '| trialEnded:', trialEnded);

            // Show popup if any condition is true
            if (isExpired || isFreeAfterTrial || trialEnded) {
                // Check if user already dismissed (don't show again for 24 hours)
                const dismissedAt = localStorage.getItem('trialExpiredDismissed');
                const shouldShow = !dismissedAt || Date.now() - parseInt(dismissedAt) > 24 * 60 * 60 * 1000;
                console.log('[TrialCheck] Should show popup:', shouldShow);
                if (shouldShow) {
                    setShowTrialExpired(true);
                }
            }
        }
    }, [userProfile]);

    const handleDismissTrialModal = () => {
        localStorage.setItem('trialExpiredDismissed', Date.now().toString());
        setShowTrialExpired(false);
    };

    // Fetch extension stats with unmount guard and timeout
    useEffect(() => {
        let isMounted = true;
        const TIMEOUT_MS = 3000;

        const fetchExtensionStats = async () => {
            try {
                // Get extension ID
                const extId = localStorage.getItem('zasExtensionId');
                if (extId && window.chrome?.runtime?.sendMessage) {
                    // Use timeout to prevent hanging callbacks
                    let responded = false;
                    const timeout = setTimeout(() => {
                        responded = true; // Just mark as responded, don't update state
                    }, TIMEOUT_MS);

                    window.chrome.runtime.sendMessage(extId, { type: 'ADBLOCK_GET_STATS' }, (response) => {
                        if (!responded) {
                            clearTimeout(timeout);
                            // Guard: only update state if component is still mounted
                            if (isMounted && !chrome.runtime.lastError && response?.stats) {
                                setExtensionStats(response.stats);
                            }
                        }
                    });
                }
            } catch (e) {
                // Extension not available
            }
        };

        fetchExtensionStats();
        const interval = setInterval(fetchExtensionStats, 30000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, []);

    // Calculate time remaining
    useEffect(() => {
        if (!focusModeActive || !focusEndTime) {
            setTimeRemaining('');
            return;
        }

        const updateRemaining = () => {
            const end = new Date(focusEndTime);
            const now = new Date();
            const diff = end - now;

            if (diff <= 0) {
                setTimeRemaining('Ending...');
                return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

            if (hours > 0) {
                setTimeRemaining(`${hours}h ${minutes}m remaining`);
            } else {
                setTimeRemaining(`${minutes}m remaining`);
            }
        };

        updateRemaining();
        const interval = setInterval(updateRemaining, 60000); // Update every minute
        return () => clearInterval(interval);
    }, [focusModeActive, focusEndTime]);

    // Simple locale detection for quote selection
    const quote = useMemo(() => {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const islamicTimezones = ['Asia/Riyadh', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Jakarta', 'Asia/Kuala_Lumpur', 'Africa/Cairo', 'Asia/Tehran'];
        const useIslamic = islamicTimezones.some(tz => timezone.includes(tz.split('/')[1]));
        const quoteList = useIslamic ? quotes.islamic : quotes.motivational;
        return quoteList[Math.floor(Math.random() * quoteList.length)];
    }, []);

    // Quick action handlers
    const handleScanLink = () => {
        navigate('/app/scanner');
    };

    const handleFocusMode = async () => {
        if (focusModeActive) {
            // If already active, stop it
            await toggleFocusMode();
        } else {
            // Show duration picker
            setShowDurationPicker(true);
        }
    };

    const handleSelectDuration = async (option) => {
        setShowDurationPicker(false);

        let durationMinutes;
        if (option.minutes === 'midnight') {
            // Calculate minutes until midnight
            const now = new Date();
            const midnight = new Date(now);
            midnight.setHours(24, 0, 0, 0);
            durationMinutes = Math.floor((midnight - now) / (1000 * 60));
        } else if (option.minutes === 'tomorrow') {
            // Calculate minutes until tomorrow midnight
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(24, 0, 0, 0);
            durationMinutes = Math.floor((tomorrow - now) / (1000 * 60));
        } else {
            durationMinutes = option.minutes;
        }

        await startFocusWithDuration(durationMinutes);
    };

    const handleInternetLock = async () => {
        const newState = await toggleInternetLock();
    };

    const handleViewAlerts = () => {
        navigate('/app/alerts');
    };

    return (
        <div className={styles.page}>
            {/* Trial Expired Modal */}
            <TrialExpiredModal
                isOpen={showTrialExpired}
                onClose={handleDismissTrialModal}
                subscription={userProfile?.subscription}
            />

            <header className={styles.header}>
                <h1>Dashboard</h1>
                <p>Overview of your protection status.</p>
            </header>

            {/* Expired/Free User: Account State Section */}
            {isExpired && (
                <div className={styles.expiredSection}>
                    {/* Status Card */}
                    <Card className={styles.accountStateCard}>
                        <div className={styles.accountStateHeader}>
                            <div className={styles.accountStateIcon}>
                                <Shield size={24} />
                            </div>
                            <div className={styles.accountStateInfo}>
                                <h3>Account Status</h3>
                                <div className={styles.accountStateBadges}>
                                    <Badge variant="neutral">{planName}</Badge>
                                </div>
                            </div>
                        </div>
                        <div className={styles.accountStateDetails}>
                            <div className={styles.stateItem}>
                                <ShieldCheck size={16} className={styles.activeIcon} />
                                <span>Adult blocking</span>
                                <Badge variant="success">Active</Badge>
                            </div>
                            <div className={styles.stateItem}>
                                <Lock size={16} className={styles.lockedIcon} />
                                <span>Premium features</span>
                                <Badge variant="warning">Inactive</Badge>
                            </div>
                        </div>
                    </Card>

                    {/* Active vs Locked Features */}
                    <div className={styles.featureColumns}>
                        <Card className={styles.featureCard}>
                            <h4 className={styles.featureCardTitle}>
                                <ShieldCheck size={16} className={styles.activeIcon} />
                                Active on your plan
                            </h4>
                            <div className={styles.featureListSimple}>
                                <div className={styles.featureItem}>
                                    <Shield size={14} />
                                    <span>Adult content blocking</span>
                                </div>
                            </div>
                        </Card>

                        <Card className={styles.featureCard}>
                            <h4 className={styles.featureCardTitle}>
                                <Lock size={16} className={styles.lockedIcon} />
                                Requires Premium
                            </h4>
                            <div className={styles.featureListSimple}>
                                {[
                                    { icon: Eye, label: 'Security Intelligence' },
                                    { icon: ScanLine, label: 'URL Scanning' },
                                    { icon: Ban, label: 'Category Controls' },
                                    { icon: BookOpen, label: 'Study & Focus Mode' },
                                    { icon: BarChart3, label: 'Analytics Dashboard' },
                                    { icon: Smartphone, label: 'Device Management' },
                                    { icon: Bell, label: 'Advanced Alerts' },
                                    { icon: Users, label: 'Family Controls' },
                                ].map(f => (
                                    <div key={f.label} className={styles.featureItem}>
                                        <f.icon size={14} />
                                        <span>{f.label}</span>
                                        <Lock size={12} className={styles.featureItemLock} />
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>

                    {/* Upgrade CTA */}
                    <Card className={styles.upgradeCta}>
                        <div className={styles.upgradeContent}>
                            <Sparkles size={20} className={styles.upgradeIcon} />
                            <div>
                                <h4>Upgrade to Premium</h4>
                                <p>Restore full AI Browser Security protection across all your devices.</p>
                            </div>
                        </div>
                        <div className={styles.upgradeActions}>
                            <Button onClick={() => navigate('/app/checkout?plan=yearly')}>
                                <Sparkles size={14} />
                                Upgrade Now
                            </Button>
                            <button className={styles.comparePlansLink} onClick={() => navigate('/#pricing')}>
                                Compare plans <ArrowRight size={14} />
                            </button>
                        </div>
                    </Card>
                </div>
            )}

            {/* Status Card */}
            <Card variant={isProtected ? 'success' : 'warning'} className={styles.statusCard}>
                <div className={styles.statusContent}>
                    <div className={styles.statusIcon}>
                        {isProtected ? (
                            <ShieldCheck size={36} />
                        ) : (
                            <ShieldAlert size={36} className={styles.pulseIcon} />
                        )}
                    </div>
                    <div className={styles.statusText}>
                        <h2>{isProtected ? 'Protected' : 'Attention Needed'}</h2>
                        <p>
                            {isProtected
                                ? 'All systems operational. No threats detected.'
                                : 'Some protection features need your attention.'}
                        </p>
                    </div>
                </div>
                <Badge variant={isProtected ? 'success' : 'warning'}>
                    {isProtected ? 'Active' : 'Review'}
                </Badge>
            </Card>

            {/* Stats Grid - REAL DATA FROM FIRESTORE */}
            <div className={styles.statsGrid}>
                <StatCard
                    icon={<Ban />}
                    label="Ads Blocked"
                    value={stats.loading ? '—' : stats.adsBlockedToday.toLocaleString()}
                    subtext="Today"
                    iconColor="var(--zas-indigo)"
                    loading={stats.loading}
                />
                <StatCard
                    icon={<AlertCircle />}
                    label="Sites Blocked"
                    value={stats.loading ? '—' : stats.sitesBlockedToday.toLocaleString()}
                    subtext="Today"
                    iconColor="var(--crimson)"
                    loading={stats.loading}
                />
                <StatCard
                    icon={<Smartphone />}
                    label="Active Devices"
                    value={stats.loading ? '—' : stats.activeDevices.toString()}
                    subtext="Connected"
                    iconColor="var(--text-secondary)"
                    loading={stats.loading}
                    onClick={() => navigate('/app/devices')}
                />
                <StatCard
                    icon={<Bell />}
                    label="Alerts"
                    value={stats.loading ? '—' : stats.alertsCount.toString()}
                    subtext={stats.alertsCount === 0 ? 'No new alerts' : 'Needs attention'}
                    iconColor="var(--amber)"
                    loading={stats.loading}
                    onClick={() => navigate('/app/alerts')}
                />
            </div>

            {/* Quick Actions & Quote */}
            <div className={styles.bottomGrid}>
                <div className={styles.actionsSection}>
                    <h3>Quick Actions</h3>
                    <div className={styles.actionsGrid}>
                        <ActionCard
                            icon={<ScanLine size={20} />}
                            label="Scan a Link"
                            iconBg="var(--zas-indigo-subtle)"
                            iconColor="var(--zas-indigo)"
                            onClick={handleScanLink}
                        />
                        <ActionCard
                            icon={focusLoading ? <Loader size={20} className={styles.spinner} /> : <Focus size={20} />}
                            label={focusModeActive ? "Stop Focus" : "Start Focus Mode"}
                            sublabel={focusModeActive && timeRemaining ? timeRemaining : null}
                            iconBg={focusModeActive ? "var(--emerald-subtle)" : "var(--amber-subtle)"}
                            iconColor={focusModeActive ? "var(--emerald)" : "var(--amber)"}
                            onClick={handleFocusMode}
                            active={focusModeActive}
                            disabled={focusLoading}
                        />
                        <ActionCard
                            icon={lockLoading ? <Loader size={20} className={styles.spinner} /> : <Wifi size={20} />}
                            label={internetLockActive ? "Unlock Internet" : "Internet Lock"}
                            iconBg={internetLockActive ? "var(--crimson-subtle)" : "var(--text-tertiary)"}
                            iconColor={internetLockActive ? "var(--crimson)" : "var(--text-secondary)"}
                            onClick={handleInternetLock}
                            active={internetLockActive}
                            disabled={lockLoading}
                        />
                        <ActionCard
                            icon={<Bell size={20} />}
                            label="View Alerts"
                            iconBg="var(--amber-subtle)"
                            iconColor="var(--amber)"
                            onClick={handleViewAlerts}
                        />
                    </div>
                </div>

                {/* Quote Section */}
                <Card className={styles.quoteCard}>
                    <p className={styles.quoteText}>"{quote.text}"</p>
                    <span className={styles.quoteAuthor}>— {quote.author}</span>
                </Card>
            </div>

            {/* Duration Picker Modal */}
            {showDurationPicker && (
                <div className={styles.modalOverlay} onClick={() => setShowDurationPicker(false)}>
                    <Card className={styles.durationModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <div>
                                <h3>Start Focus Mode</h3>
                                <p>Choose how long to block distractions</p>
                            </div>
                            <button className={styles.closeBtn} onClick={() => setShowDurationPicker(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className={styles.durationGrid}>
                            {DURATION_OPTIONS.map((option, index) => (
                                <button
                                    key={index}
                                    className={styles.durationOption}
                                    onClick={() => handleSelectDuration(option)}
                                >
                                    <Clock size={18} />
                                    <span>{option.label}</span>
                                </button>
                            ))}
                        </div>
                        <p className={styles.blockedSites}>
                            Will block: Instagram, TikTok, Twitter, YouTube, Reddit, and gaming sites
                        </p>
                    </Card>
                </div>
            )}
        </div>
    );
};

// Stat Card Component
const StatCard = ({ icon, label, value, subtext, iconColor, loading, onClick }) => (
    <Card
        className={`${styles.statCard} ${onClick ? styles.clickable : ''}`}
        onClick={onClick}
    >
        <div className={styles.statIcon} style={{ color: iconColor }}>
            {loading ? <Loader size={24} className={styles.spinner} /> : icon}
        </div>
        <div className={styles.statInfo}>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{label}</span>
            <span className={styles.statSubtext}>{subtext}</span>
        </div>
    </Card>
);

// Action Card Component
const ActionCard = ({ icon, label, sublabel, iconBg, iconColor, onClick, active, disabled }) => (
    <button
        className={`${styles.actionCard} ${active ? styles.active : ''} ${disabled ? styles.disabled : ''}`}
        onClick={onClick}
        disabled={disabled}
    >
        <div className={styles.actionIcon} style={{ background: iconBg, color: iconColor }}>
            {icon}
        </div>
        <div className={styles.actionContent}>
            <span className={styles.actionLabel}>{label}</span>
            {sublabel && <span className={styles.actionSublabel}>{sublabel}</span>}
        </div>
    </button>
);

export default Overview;
