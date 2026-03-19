import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStats, useProtectionStatus, useAlerts } from '../../hooks/useFirestore';
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
    ArrowRight,
    Activity,
    ChevronRight,
    AlertTriangle,
    CheckCircle,
    Zap,
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

// Threat type labels + icons
const THREAT_LABELS = {
    adult: { label: 'Adult Content', color: 'var(--crimson)' },
    malware: { label: 'Malware', color: 'var(--crimson)' },
    phishing: { label: 'Phishing', color: 'var(--crimson)' },
    ad_blocked: { label: 'Ad Blocked', color: 'var(--zas-indigo)' },
    tracker_blocked: { label: 'Tracker', color: 'var(--zas-indigo)' },
    focus_blocked: { label: 'Focus Block', color: 'var(--amber)' },
    extension_disabled: { label: 'Extension Disabled', color: 'var(--amber)' },
    devtools_opened: { label: 'Tamper Attempt', color: 'var(--crimson)' },
};

/**
 * Compute a 0-100 Security Score from available data.
 * Factors:
 *   Extension connected        30 pts
 *   No high-severity alerts today 25 pts
 *   Protections enabled (3×10) 30 pts
 *   Active devices > 0         15 pts
 */
function computeSecurityScore(isProtected, userProfile, stats, recentAlerts) {
    let score = 0;

    if (isProtected) score += 30;

    const settings = userProfile?.protectionSettings || {};
    if (settings.malware !== false) score += 10;
    if (settings.adblock !== false) score += 10;
    if (settings.trackers !== false) score += 10;

    const highToday = (recentAlerts || []).filter(a => {
        if (a.severity !== 'high') return false;
        const ts = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        return Date.now() - ts < 24 * 60 * 60 * 1000;
    });
    if (highToday.length === 0) score += 25;
    else if (highToday.length <= 2) score += 12;

    if (!stats.loading && stats.activeDevices > 0) score += 15;

    return Math.min(100, score);
}

/** Friendly "X min ago / X hr ago / Yesterday" */
function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return 'Yesterday';
}

// ─── Security Score Ring ───────────────────────────────────────────────────
const SecurityScoreRing = ({ score }) => {
    const r = 46;
    const circ = 2 * Math.PI * r;
    const filled = (score / 100) * circ;
    const color =
        score >= 80 ? 'var(--emerald)' :
        score >= 50 ? 'var(--amber)' :
        'var(--crimson)';
    const label =
        score >= 80 ? 'Excellent' :
        score >= 50 ? 'Fair' :
        'At Risk';

    return (
        <div className={styles.scoreRingWrap}>
            <svg viewBox="0 0 110 110" width="110" height="110" aria-label={`Security score ${score}`}>
                {/* Track */}
                <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                {/* Progress */}
                <circle
                    cx="55" cy="55" r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth="8"
                    strokeDasharray={`${filled} ${circ}`}
                    strokeLinecap="round"
                    transform="rotate(-90 55 55)"
                    style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)' }}
                />
                <text x="55" y="50" textAnchor="middle" fill="var(--text-primary)" fontSize="20" fontWeight="700" fontFamily="inherit">{score}</text>
                <text x="55" y="65" textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontFamily="inherit">{label}</text>
            </svg>
        </div>
    );
};

// ─── Main Component ────────────────────────────────────────────────────────
const Overview = () => {
    const navigate = useNavigate();
    const { isActive, isExpired, isTrial, isPremium, planName } = useOutletContext();

    const { userProfile } = useAuth();
    const stats = useDashboardStats();
    const { status, isProtected, extensionConnected } = useProtectionStatus();
    const { alerts: recentAlerts, loading: alertsLoading } = useAlerts(8);

    const { isActive: focusModeActive, toggleFocusMode, loading: focusLoading, endTime: focusEndTime, startFocusWithDuration } = useFocusMode();
    const { isLocked: internetLockActive, toggleInternetLock, loading: lockLoading } = useInternetLock();

    const [extensionStats, setExtensionStats] = useState(null);
    const [showDurationPicker, setShowDurationPicker] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState('');
    const [showTrialExpired, setShowTrialExpired] = useState(false);

    // Security Score (live computed)
    const securityScore = useMemo(
        () => computeSecurityScore(isProtected, userProfile, stats, recentAlerts),
        [isProtected, userProfile, stats, recentAlerts]
    );

    // Trial/expired modal check
    useEffect(() => {
        if (userProfile?.subscription) {
            const sub = userProfile.subscription;
            const subStatus = (sub.status || sub.plan_status || '').toLowerCase();
            const plan = (sub.plan || '').toLowerCase();
            const expiredStatuses = ['canceled', 'cancelled', 'unpaid', 'past_due', 'incomplete_expired', 'expired', 'inactive'];
            const isSubExpired = expiredStatuses.includes(subStatus);
            const hasStartedTrial = !!sub.trial_start || sub.trial_used === true;
            const isFreeAfterTrial = plan === 'free' && sub.trial_active === false && hasStartedTrial;
            const trialEnd = sub.trial_end;
            let trialEnded = false;
            if (trialEnd) {
                const endDate = trialEnd.toDate ? trialEnd.toDate() : new Date(trialEnd);
                trialEnded = endDate < new Date() && subStatus !== 'active';
            }
            if (isSubExpired || isFreeAfterTrial || trialEnded) {
                const uid = userProfile?.uid || 'unknown';
                const dismissedAt = localStorage.getItem(`trialExpiredDismissed_${uid}`);
                if (!dismissedAt || Date.now() - parseInt(dismissedAt) > 24 * 60 * 60 * 1000) {
                    setShowTrialExpired(true);
                }
            }
        }
    }, [userProfile]);

    const handleDismissTrialModal = () => {
        const uid = userProfile?.uid || 'unknown';
        localStorage.setItem(`trialExpiredDismissed_${uid}`, Date.now().toString());
        setShowTrialExpired(false);
    };

    // Extension stats polling
    useEffect(() => {
        let isMounted = true;
        const fetchExtensionStats = async () => {
            try {
                const extId = localStorage.getItem('zasExtensionId');
                if (extId && window.chrome?.runtime?.sendMessage) {
                    let responded = false;
                    const timeout = setTimeout(() => { responded = true; }, 3000);
                    window.chrome.runtime.sendMessage(extId, { type: 'ADBLOCK_GET_STATS' }, (response) => {
                        if (!responded) {
                            clearTimeout(timeout);
                            if (isMounted && !chrome.runtime.lastError && response?.stats) {
                                setExtensionStats(response.stats);
                            }
                        }
                    });
                }
            } catch (_) {}
        };
        fetchExtensionStats();
        const interval = setInterval(fetchExtensionStats, 30000);
        return () => { isMounted = false; clearInterval(interval); };
    }, []);

    // Focus mode countdown
    useEffect(() => {
        if (!focusModeActive || !focusEndTime) { setTimeRemaining(''); return; }
        const update = () => {
            const diff = new Date(focusEndTime) - new Date();
            if (diff <= 0) { setTimeRemaining('Ending...'); return; }
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            setTimeRemaining(h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`);
        };
        update();
        const interval = setInterval(update, 60000);
        return () => clearInterval(interval);
    }, [focusModeActive, focusEndTime]);

    const quote = useMemo(() => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const islamicTZs = ['Asia/Riyadh', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Jakarta', 'Asia/Kuala_Lumpur', 'Africa/Cairo', 'Asia/Tehran'];
        const useIslamic = islamicTZs.some(t => tz.includes(t.split('/')[1]));
        const list = useIslamic ? quotes.islamic : quotes.motivational;
        return list[Math.floor(Math.random() * list.length)];
    }, []);

    const handleFocusMode = async () => {
        if (focusModeActive) await toggleFocusMode();
        else setShowDurationPicker(true);
    };

    const handleSelectDuration = async (option) => {
        setShowDurationPicker(false);
        let mins = option.minutes;
        if (mins === 'midnight') {
            const m = new Date(); const mid = new Date(m); mid.setHours(24, 0, 0, 0);
            mins = Math.floor((mid - m) / 60000);
        } else if (mins === 'tomorrow') {
            const m = new Date(); const tom = new Date(m); tom.setDate(tom.getDate() + 1); tom.setHours(24, 0, 0, 0);
            mins = Math.floor((tom - m) / 60000);
        }
        await startFocusWithDuration(mins);
    };

    return (
        <div className={styles.page}>
            <TrialExpiredModal
                isOpen={showTrialExpired}
                onClose={handleDismissTrialModal}
                subscription={userProfile?.subscription}
            />

            <header className={styles.header}>
                <h1>Dashboard</h1>
                <p>Your security overview at a glance.</p>
            </header>

            {/* ── ROW 1: Status + Security Score ────────────────────────── */}
            <div className={styles.topRow}>
                <Card variant={isProtected ? 'success' : 'warning'} className={styles.statusCard}>
                    <div className={styles.statusContent}>
                        <div className={styles.statusIcon}>
                            {isProtected
                                ? <ShieldCheck size={36} />
                                : <ShieldAlert size={36} className={styles.pulseIcon} />}
                        </div>
                        <div className={styles.statusText}>
                            <h2>{isProtected ? 'Protected' : 'Attention Needed'}</h2>
                            <p>
                                {isProtected
                                    ? 'All systems operational. Extension connected.'
                                    : 'Install or reconnect the ZAS extension to activate protection.'}
                            </p>
                        </div>
                    </div>
                    <Badge variant={isProtected ? 'success' : 'warning'}>
                        {isProtected ? 'Active' : 'Review'}
                    </Badge>
                </Card>

                {/* ── FEATURE 1: Security Score ─────────────────────────── */}
                <Card className={styles.scoreCard}>
                    <div className={styles.scoreHeader}>
                        <div className={styles.scoreTitle}>
                            <Activity size={16} />
                            <span>Security Score</span>
                        </div>
                        <Badge
                            variant={securityScore >= 80 ? 'success' : securityScore >= 50 ? 'warning' : 'error'}
                        >
                            {securityScore >= 80 ? 'Excellent' : securityScore >= 50 ? 'Fair' : 'At Risk'}
                        </Badge>
                    </div>
                    <div className={styles.scoreBody}>
                        <SecurityScoreRing score={securityScore} />
                        <div className={styles.scoreFactors}>
                            <ScoreFactor
                                ok={extensionConnected === true}
                                label="Extension connected"
                            />
                            <ScoreFactor
                                ok={userProfile?.protectionSettings?.malware !== false}
                                label="Malware protection on"
                            />
                            <ScoreFactor
                                ok={userProfile?.protectionSettings?.adblock !== false}
                                label="Ad blocker on"
                            />
                            <ScoreFactor
                                ok={!stats.loading && stats.activeDevices > 0}
                                label="Device active"
                            />
                        </div>
                    </div>
                    <p className={styles.scoreHint}>
                        Score updates in real time as your protection changes.
                    </p>
                </Card>
            </div>

            {/* ── ROW 2: Quick Actions ───────────────────────────────────── */}
            <section className={styles.actionsSection}>
                <h3>Quick Actions</h3>
                <div className={styles.actionsGrid}>
                    <ActionCard
                        icon={<ScanLine size={20} />}
                        label="Scan a Link"
                        sublabel="Check any URL instantly"
                        iconBg="var(--zas-indigo-subtle)"
                        iconColor="var(--zas-indigo)"
                        onClick={() => navigate('/app/scanner')}
                    />
                    <ActionCard
                        icon={focusLoading ? <Loader size={20} className={styles.spinner} /> : <Focus size={20} />}
                        label={focusModeActive ? 'Stop Focus Mode' : 'Start Focus Mode'}
                        sublabel={focusModeActive && timeRemaining ? timeRemaining : 'Block distractions'}
                        iconBg={focusModeActive ? 'var(--emerald-subtle)' : 'var(--amber-subtle)'}
                        iconColor={focusModeActive ? 'var(--emerald)' : 'var(--amber)'}
                        onClick={handleFocusMode}
                        active={focusModeActive}
                        disabled={focusLoading}
                    />
                    <ActionCard
                        icon={lockLoading ? <Loader size={20} className={styles.spinner} /> : <Wifi size={20} />}
                        label={internetLockActive ? 'Unlock Internet' : 'Internet Lock'}
                        sublabel={internetLockActive ? 'Whitelist only mode' : 'Block all browsing'}
                        iconBg={internetLockActive ? 'var(--crimson-subtle)' : 'rgba(255,255,255,0.06)'}
                        iconColor={internetLockActive ? 'var(--crimson)' : 'var(--text-secondary)'}
                        onClick={() => toggleInternetLock()}
                        active={internetLockActive}
                        disabled={lockLoading}
                    />
                    <ActionCard
                        icon={<Bell size={20} />}
                        label="View Alerts"
                        sublabel={stats.alertsCount > 0 ? `${stats.alertsCount} unread` : 'All clear'}
                        iconBg="var(--amber-subtle)"
                        iconColor="var(--amber)"
                        onClick={() => navigate('/app/alerts')}
                    />
                </div>
            </section>

            {/* ── ROW 3: Stats Grid ──────────────────────────────────────── */}
            <div className={styles.statsGrid}>
                <StatCard
                    icon={<Ban />}
                    label="Ads Blocked"
                    value={stats.loading ? '—' : (
                        extensionStats?.blockedToday != null
                            ? extensionStats.blockedToday.toLocaleString()
                            : stats.adsBlockedToday.toLocaleString()
                    )}
                    subtext={extensionStats?.blockedToday != null ? 'Live from extension' : 'Today'}
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

            {/* ── ROW 4: Threat Feed + Quote ─────────────────────────────── */}
            <div className={styles.bottomGrid}>
                {/* ── FEATURE 2: Live Threat Feed ──────────────────────── */}
                <Card className={styles.threatFeedCard}>
                    <div className={styles.threatFeedHeader}>
                        <div className={styles.threatFeedTitle}>
                            <Zap size={16} />
                            <span>Live Threat Feed</span>
                            <span className={styles.liveDot} aria-label="live" />
                        </div>
                        <button
                            className={styles.viewAllBtn}
                            onClick={() => navigate('/app/alerts')}
                        >
                            View all <ChevronRight size={14} />
                        </button>
                    </div>

                    {alertsLoading ? (
                        <div className={styles.threatFeedLoading}>
                            <Loader size={18} className={styles.spinner} />
                            <span>Loading threats…</span>
                        </div>
                    ) : recentAlerts.length === 0 ? (
                        <div className={styles.threatFeedEmpty}>
                            <CheckCircle size={32} style={{ color: 'var(--emerald)', marginBottom: 8 }} />
                            <p>No threats detected recently.</p>
                            <span>Your protection is working.</span>
                        </div>
                    ) : (
                        <ul className={styles.threatList}>
                            {recentAlerts.slice(0, 6).map((alert) => {
                                const info = THREAT_LABELS[alert.type] || { label: alert.type || 'Unknown', color: 'var(--text-muted)' };
                                const isHigh = alert.severity === 'high';
                                return (
                                    <li key={alert.id} className={styles.threatItem}>
                                        <span
                                            className={styles.threatDot}
                                            style={{ background: info.color }}
                                        />
                                        <div className={styles.threatInfo}>
                                            <span className={styles.threatLabel}>{info.label}</span>
                                            {alert.url && (
                                                <span className={styles.threatUrl}>
                                                    {(() => { try { return new URL(alert.url).hostname; } catch { return alert.url.slice(0, 32); } })()}
                                                </span>
                                            )}
                                        </div>
                                        <div className={styles.threatMeta}>
                                            {isHigh && (
                                                <Badge variant="error" style={{ fontSize: '0.65rem', padding: '1px 6px' }}>
                                                    High
                                                </Badge>
                                            )}
                                            <span className={styles.threatTime}>{timeAgo(alert.timestamp)}</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Card>

                <Card className={styles.quoteCard}>
                    <p className={styles.quoteText}>"{quote.text}"</p>
                    <span className={styles.quoteAuthor}>— {quote.author}</span>
                </Card>
            </div>

            {/* ── Expired / Free User Section ───────────────────────────── */}
            {isExpired && (
                <div className={styles.expiredSection}>
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
                                    { icon: Eye, label: 'Ad & Threat Protection' },
                                    { icon: ScanLine, label: 'Link Scanner', beta: true },
                                    { icon: Ban, label: 'Category Controls', beta: true },
                                    { icon: BookOpen, label: 'Study & Focus Mode' },
                                    { icon: BarChart3, label: 'Analytics Dashboard', beta: true },
                                    { icon: Smartphone, label: 'Device Management' },
                                    { icon: Bell, label: 'Advanced Alerts' },
                                    { icon: Users, label: 'Family Controls', beta: true },
                                ].map(f => (
                                    <div key={f.label} className={styles.featureItem}>
                                        <f.icon size={14} />
                                        <span>{f.label}</span>
                                        {f.beta && <Badge variant="info" style={{ fontSize: '0.6rem', padding: '1px 6px' }}>Beta</Badge>}
                                        <Lock size={12} className={styles.featureItemLock} />
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </div>

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

            {/* ── Focus Duration Picker Modal ────────────────────────────── */}
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
                            {DURATION_OPTIONS.map((option, i) => (
                                <button
                                    key={i}
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

// ─── Sub-components ────────────────────────────────────────────────────────

const ScoreFactor = ({ ok, label }) => (
    <div className={styles.scoreFactor}>
        {ok
            ? <CheckCircle size={13} style={{ color: 'var(--emerald)', flexShrink: 0 }} />
            : <AlertTriangle size={13} style={{ color: 'var(--amber)', flexShrink: 0 }} />
        }
        <span className={ok ? styles.scoreFactorOk : styles.scoreFactorWarn}>{label}</span>
    </div>
);

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
