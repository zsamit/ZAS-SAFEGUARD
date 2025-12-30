import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { useAdBlockerStats } from '../../hooks/useFirestore';
import { db } from '../../firebase';
import { doc, updateDoc, arrayUnion, arrayRemove, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import {
    Trash2,
    Plus,
    Globe,
    Ban,
    BarChart3,
    AlertCircle,
    Sparkles,
    Video,
    Cookie,
    Loader,
    ExternalLink,
    CheckCircle,
    AlertTriangle
} from 'lucide-react';
import styles from './AdBlocker.module.css';

// Extension communication helper
const sendToExtension = async (message) => {
    // Try to get extension ID from URL or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    let extensionId = urlParams.get('ext') || localStorage.getItem('zasExtensionId');

    // Known extension IDs (add yours here if unpacked)
    const KNOWN_EXTENSION_IDS = [
        'anclbiffkkdjjfgpnmmndjoefejdekkf', // User's unpacked extension
    ];

    // If no ID found, try known ones
    if (!extensionId && window.chrome?.runtime?.sendMessage) {
        for (const id of KNOWN_EXTENSION_IDS) {
            try {
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage(id, { type: 'PING' }, (resp) => {
                        if (chrome.runtime.lastError) {
                            resolve(null);
                        } else {
                            resolve(resp);
                        }
                    });
                });
                if (response?.status === 'alive') {
                    extensionId = id;
                    localStorage.setItem('zasExtensionId', id);
                    console.log('[AdBlocker] Auto-detected extension:', id);
                    break;
                }
            } catch (e) {
                // Try next
            }
        }
    }

    if (!extensionId) {
        console.log('[AdBlocker] No extension ID found');
        return null;
    }

    if (extensionId && window.chrome?.runtime?.sendMessage) {
        try {
            return await new Promise((resolve, reject) => {
                window.chrome.runtime.sendMessage(extensionId, message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
        } catch (error) {
            console.error('[AdBlocker] Extension communication error:', error);
            return null;
        }
    }
    return null;
};

const AdBlocker = () => {
    const { user, userProfile } = useAuth();
    const adStats = useAdBlockerStats();

    // Extension stats (try to get from extension)
    const [extensionStats, setExtensionStats] = useState(null);
    const [extensionConnected, setExtensionConnected] = useState(false);

    // Manual extension connection
    const handleConnectExtension = () => {
        const id = prompt(
            'Enter your ZAS Safeguard Extension ID:\n\n' +
            'To find it:\n' +
            '1. Go to chrome://extensions\n' +
            '2. Find "ZAS Safeguard"\n' +
            '3. Copy the ID (looks like: abcdefghij...)'
        );

        if (id && id.length > 10) {
            localStorage.setItem('zasExtensionId', id);
            window.location.reload();
        }
    };

    // Get categories from user profile
    const categories = userProfile?.settings?.categories || {};
    const [enabled, setEnabled] = useState(true);

    // Initialize from localStorage first, then sync with Firestore
    const [localCategories, setLocalCategories] = useState(() => {
        // Try localStorage first
        const saved = localStorage.getItem('adblockCategories');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) { }
        }
        // Default values
        return {
            displayAds: true,
            videoAds: true,
            socialAds: true,
            trackingScripts: true,
            cookiePopups: false,
        };
    });

    // Allowlist from user profile
    const allowlist = userProfile?.settings?.customAllowlist || [];
    const [newDomain, setNewDomain] = useState('');
    const [saving, setSaving] = useState(false);

    // Report modal state
    const [showReportModal, setShowReportModal] = useState(false);
    const [reportUrl, setReportUrl] = useState('');
    const [reportDescription, setReportDescription] = useState('');
    const [reportSubmitted, setReportSubmitted] = useState(false);
    const [reportSaving, setReportSaving] = useState(false);

    // Try to connect to extension on mount
    useEffect(() => {
        const checkExtension = async () => {
            try {
                const response = await sendToExtension({ type: 'ADBLOCK_GET_STATS' });
                if (response?.stats) {
                    setExtensionStats(response.stats);
                    setExtensionConnected(true);
                    console.log('[AdBlocker] Extension connected, stats:', response.stats);
                }
            } catch (e) {
                console.log('[AdBlocker] Extension not connected');
            }
        };
        checkExtension();

        // Poll for stats every 30 seconds
        const interval = setInterval(checkExtension, 30000);
        return () => clearInterval(interval);
    }, []);

    // Sync categories from Firestore when available (one-time sync)
    useEffect(() => {
        const hasFirestoreData = Object.keys(categories).length > 0;
        const hasLocalData = localStorage.getItem('adblockCategories');

        // Only sync from Firestore if we don't have local data yet
        if (hasFirestoreData && !hasLocalData) {
            const newState = {
                displayAds: categories.displayAds?.enabled ?? true,
                videoAds: categories.videoAds?.enabled ?? true,
                socialAds: categories.socialAds?.enabled ?? true,
                trackingScripts: categories.trackers?.enabled ?? true,
                cookiePopups: categories.cookiePopups?.enabled ?? false,
            };
            console.log('[AdBlocker] Initial sync from Firestore:', newState);
            setLocalCategories(newState);
            localStorage.setItem('adblockCategories', JSON.stringify(newState));
        }
    }, [JSON.stringify(categories)]);

    const handleAdd = async () => {
        if (!newDomain || !user) return;

        const domain = newDomain.toLowerCase().trim();
        if (!domain.match(/^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/)) {
            alert('Please enter a valid domain (e.g., example.com)');
            return;
        }

        setSaving(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                'settings.customAllowlist': arrayUnion(domain)
            });

            // Also tell extension
            await sendToExtension({ type: 'ADBLOCK_ADD_ALLOWLIST', domain });

            setNewDomain('');
        } catch (error) {
            console.error('Error adding domain:', error);
            alert('Failed to add domain');
        }
        setSaving(false);
    };

    const handleRemove = async (domain) => {
        if (!user) return;

        try {
            await updateDoc(doc(db, 'users', user.uid), {
                'settings.customAllowlist': arrayRemove(domain)
            });

            // Also tell extension
            await sendToExtension({ type: 'ADBLOCK_REMOVE_ALLOWLIST', domain });
        } catch (error) {
            console.error('Error removing domain:', error);
            alert('Failed to remove domain');
        }
    };

    const handleCategoryToggle = async (key) => {
        const newValue = !localCategories[key];
        console.log('[AdBlocker] Toggling', key, 'to', newValue);

        const newCategories = { ...localCategories, [key]: newValue };
        setLocalCategories(newCategories);

        // Save to localStorage immediately for persistence
        localStorage.setItem('adblockCategories', JSON.stringify(newCategories));
        console.log('[AdBlocker] Saved to localStorage');

        // Also persist to Firebase
        if (user) {
            try {
                const firestoreKey = key === 'trackingScripts' ? 'trackers' : key;
                await updateDoc(doc(db, 'users', user.uid), {
                    [`settings.categories.${firestoreKey}.enabled`]: newValue
                });
                console.log('[AdBlocker] Saved to Firestore');
            } catch (error) {
                console.error('[AdBlocker] Error updating Firestore:', error);
            }
        }

        // Send to extension
        try {
            await sendToExtension({
                type: 'ADBLOCK_SET_CATEGORY',
                category: key,
                enabled: newValue
            });
        } catch (e) {
            console.log('[AdBlocker] Could not send to extension');
        }
    };

    const handleEnableToggle = async (newEnabled) => {
        setEnabled(newEnabled);

        // Send to extension
        try {
            await sendToExtension({
                type: newEnabled ? 'ADBLOCK_ENABLE' : 'ADBLOCK_DISABLE'
            });
        } catch (e) {
            console.log('[AdBlocker] Could not send to extension');
        }

        // Persist to Firebase
        if (user) {
            try {
                await updateDoc(doc(db, 'users', user.uid), {
                    'settings.adBlockerEnabled': newEnabled
                });
            } catch (error) {
                console.error('Error updating ad blocker state:', error);
            }
        }
    };

    const handleReportSubmit = async () => {
        if (!reportUrl) {
            alert('Please enter the URL of the broken site');
            return;
        }

        setReportSaving(true);

        try {
            // Save to Firestore - you can view these in Firebase Console
            await addDoc(collection(db, 'breakage_reports'), {
                url: reportUrl,
                description: reportDescription,
                userId: user?.uid || 'anonymous',
                userEmail: user?.email || 'anonymous',
                timestamp: serverTimestamp(),
                status: 'new',
                browser: navigator.userAgent,
            });

            // Also log to extension
            await sendToExtension({
                type: 'ADBLOCK_BREAKAGE',
                domain: reportUrl,
                timestamp: new Date().toISOString()
            });

            setReportSubmitted(true);
            setTimeout(() => {
                setShowReportModal(false);
                setReportUrl('');
                setReportDescription('');
                setReportSubmitted(false);
            }, 2000);
        } catch (error) {
            console.error('Error submitting report:', error);
            alert('Failed to submit report. Please try again.');
        }

        setReportSaving(false);
    };

    // Use extension stats if available, otherwise use Firestore stats
    const displayStats = extensionConnected && extensionStats ? {
        today: extensionStats.blockedToday ?? 0,
        week: extensionStats.blockedTotal ?? 0, // Extension doesn't track weekly/monthly yet, show total
        month: extensionStats.blockedTotal ?? 0,
        loading: false
    } : adStats;

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div>
                    <h1>Ad Blocker</h1>
                    <p>Manage ad blocking preferences and exceptions.</p>
                    {!extensionConnected && (
                        <Badge variant="warning" className={styles.extensionWarning}>
                            <AlertTriangle size={12} />
                            Extension not connected
                        </Badge>
                    )}
                </div>
                <Toggle
                    checked={enabled}
                    onChange={handleEnableToggle}
                />
            </header>

            {/* Stats - REAL DATA from Extension or Firestore */}
            <div className={styles.statsRow}>
                <div className={styles.stat}>
                    <BarChart3 size={18} />
                    <div>
                        <span className={styles.statValue}>
                            {displayStats.loading ? '—' : displayStats.today.toLocaleString()}
                        </span>
                        <span className={styles.statLabel}>Today</span>
                    </div>
                </div>
                <div className={styles.stat}>
                    <div>
                        <span className={styles.statValue}>
                            {displayStats.loading ? '—' : displayStats.week.toLocaleString()}
                        </span>
                        <span className={styles.statLabel}>This Week</span>
                    </div>
                </div>
                <div className={styles.stat}>
                    <div>
                        <span className={styles.statValue}>
                            {displayStats.loading ? '—' : displayStats.month.toLocaleString()}
                        </span>
                        <span className={styles.statLabel}>This Month</span>
                    </div>
                </div>
            </div>

            {/* Categories */}
            <section className={styles.section}>
                <h3>Blocking Categories</h3>
                <Card className={styles.categoryCard}>
                    <CategoryItem
                        icon={<Ban size={18} />}
                        label="Display Ads"
                        description="Banner ads, pop-ups, and sidebar advertisements"
                        checked={localCategories.displayAds}
                        onChange={() => handleCategoryToggle('displayAds')}
                    />
                    <div className={styles.divider} />
                    <CategoryItem
                        icon={<Video size={18} />}
                        label="Video Ads"
                        description="Pre-roll, mid-roll, and overlay video ads"
                        checked={localCategories.videoAds}
                        onChange={() => handleCategoryToggle('videoAds')}
                    />
                    <div className={styles.divider} />
                    <CategoryItem
                        icon={<Sparkles size={18} />}
                        label="Social Media Widgets"
                        description="Share buttons, like buttons, and social trackers"
                        checked={localCategories.socialAds}
                        onChange={() => handleCategoryToggle('socialAds')}
                    />
                    <div className={styles.divider} />
                    <CategoryItem
                        icon={<Globe size={18} />}
                        label="Tracking Scripts"
                        description="Analytics, fingerprinting, and user tracking"
                        checked={localCategories.trackingScripts}
                        onChange={() => handleCategoryToggle('trackingScripts')}
                    />
                    <div className={styles.divider} />
                    <CategoryItem
                        icon={<Cookie size={18} />}
                        label="Cookie Consent Popups"
                        description="Auto-decline cookie consent banners"
                        checked={localCategories.cookiePopups}
                        onChange={() => handleCategoryToggle('cookiePopups')}
                        badge="Beta"
                    />
                </Card>
            </section>

            {/* Allowlist - REAL DATA */}
            <section className={styles.section}>
                <h3>Allowlist</h3>
                <p className={styles.sectionDesc}>
                    Ads will not be blocked on these websites.
                </p>

                <Card noPadding className={styles.allowlistCard}>
                    <div className={styles.addRow}>
                        <Input
                            placeholder="example.com"
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                            icon={Globe}
                        />
                        <Button onClick={handleAdd} disabled={!newDomain || saving}>
                            {saving ? <Loader size={16} className={styles.spinner} /> : <Plus size={16} />}
                            Add
                        </Button>
                    </div>

                    <div className={styles.allowlist}>
                        {allowlist.length === 0 ? (
                            <div className={styles.emptyState}>
                                <Globe size={32} />
                                <span>No allowed sites</span>
                            </div>
                        ) : (
                            allowlist.map((site, index) => (
                                <div key={index} className={styles.allowlistItem}>
                                    <span>{site}</span>
                                    <button
                                        onClick={() => handleRemove(site)}
                                        className={styles.removeBtn}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </Card>
            </section>

            {/* Report */}
            <Card className={styles.reportCard}>
                <div>
                    <h4>Report a Broken Site</h4>
                    <p>If a site isn't working correctly with ad blocking enabled, let us know.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowReportModal(true)}>
                    <AlertCircle size={16} />
                    Report Issue
                </Button>
            </Card>

            {/* Report Modal */}
            {showReportModal && (
                <div className={styles.modalOverlay} onClick={() => setShowReportModal(false)}>
                    <Card className={styles.modal} onClick={e => e.stopPropagation()}>
                        {reportSubmitted ? (
                            <div className={styles.successMessage}>
                                <CheckCircle size={48} />
                                <h3>Report Submitted</h3>
                                <p>Thank you! We'll look into this.</p>
                            </div>
                        ) : (
                            <>
                                <h3>Report Broken Site</h3>
                                <p>Tell us about the site that's not working correctly.</p>
                                <Input
                                    label="Website URL"
                                    placeholder="https://example.com"
                                    value={reportUrl}
                                    onChange={(e) => setReportUrl(e.target.value)}
                                    icon={Globe}
                                />
                                <div className={styles.textareaWrapper}>
                                    <label>Description (optional)</label>
                                    <textarea
                                        placeholder="What's broken? (e.g., videos won't play, page layout is messed up)"
                                        value={reportDescription}
                                        onChange={(e) => setReportDescription(e.target.value)}
                                        rows={3}
                                    />
                                </div>
                                <div className={styles.modalActions}>
                                    <Button variant="ghost" onClick={() => setShowReportModal(false)}>
                                        Cancel
                                    </Button>
                                    <Button onClick={handleReportSubmit} disabled={reportSaving}>
                                        {reportSaving ? <Loader size={16} className={styles.spinner} /> : null}
                                        Submit Report
                                    </Button>
                                </div>
                            </>
                        )}
                    </Card>
                </div>
            )}
        </div>
    );
};

const CategoryItem = ({ icon, label, description, checked, onChange, badge }) => (
    <div className={styles.categoryItem}>
        <div className={styles.categoryIcon}>{icon}</div>
        <div className={styles.categoryContent}>
            <div className={styles.categoryHeader}>
                <span className={styles.categoryLabel}>{label}</span>
                {badge && <Badge variant="info">{badge}</Badge>}
            </div>
            <span className={styles.categoryDesc}>{description}</span>
        </div>
        <Toggle checked={checked} onChange={onChange} />
    </div>
);

export default AdBlocker;
