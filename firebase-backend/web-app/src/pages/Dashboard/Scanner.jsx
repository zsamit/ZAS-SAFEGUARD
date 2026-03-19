import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import {
    Search,
    ShieldCheck,
    ShieldAlert,
    Clock,
    Globe,
    Loader,
    ExternalLink,
    AlertTriangle,
    CheckCircle,
    XCircle,
    Info
} from 'lucide-react';
import LockedFeature from '../../components/LockedFeature';
import styles from './Scanner.module.css';

const Scanner = () => {
    const { isActive } = useOutletContext();
    if (!isActive) return <LockedFeature feature="url_scanning" />;

    const { user } = useAuth();
    const [url, setUrl] = useState('');
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState(null);
    const [recentScans, setRecentScans] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(true);

    // Load recent scans on mount
    React.useEffect(() => {
        loadRecentScans();
    }, [user]);

    const loadRecentScans = async () => {
        if (!user) {
            setLoadingHistory(false);
            return;
        }

        try {
            const scansQuery = query(
                collection(db, 'logs'),
                where('userId', '==', user.uid),
                where('action', '==', 'url_scan'),
                orderBy('timestamp', 'desc'),
                limit(5)
            );
            const snapshot = await getDocs(scansQuery);
            const scans = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate()
            }));
            setRecentScans(scans);
        } catch (error) {
            console.error('Error loading recent scans:', error);
        }
        setLoadingHistory(false);
    };

    const handleScan = async () => {
        if (!url) return;

        // Validate URL format
        let cleanUrl = url.trim();
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
            cleanUrl = 'https://' + cleanUrl;
        }

        try {
            new URL(cleanUrl);
        } catch {
            alert('Please enter a valid URL');
            return;
        }

        setScanning(true);
        setResult(null);

        const domain = new URL(cleanUrl).hostname;

        // Get auth token from extension
        const extensionId = localStorage.getItem('zasExtensionId');
        let token = null;

        if (extensionId && window.chrome?.runtime?.sendMessage) {
            token = await new Promise((resolve) => {
                try {
                    chrome.runtime.sendMessage(extensionId, { type: 'GET_TOKEN' }, (response) => {
                        resolve(chrome.runtime.lastError ? null : (response?.token || null));
                    });
                } catch {
                    resolve(null);
                }
            });
        }

        if (!token) {
            setResult({
                status: 'error',
                domain,
                url: cleanUrl,
                threats: [],
                message: 'Extension not connected. Make sure ZAS Safeguard is installed and you are signed in.'
            });
            setScanning(false);
            return;
        }

        // Call real checkUrlReputation Cloud Function
        let scanResult;
        try {
            const response = await fetch(
                'https://us-central1-zas-safeguard.cloudfunctions.net/checkUrlReputation',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ url: cleanUrl, userId: user?.uid })
                }
            );
            const data = await response.json();
            scanResult = {
                status: data.safe === false ? 'danger' : data.suspicious ? 'warning' : 'safe',
                url: cleanUrl,
                domain,
                threats: data.threats || [],
                message: data.message || (
                    data.safe === false
                        ? `Threat detected: ${data.category || 'malicious content'}`
                        : data.suspicious
                            ? 'This site shows suspicious patterns. Proceed with caution.'
                            : 'No threats detected. This site appears safe.'
                )
            };
        } catch (err) {
            scanResult = {
                status: 'error',
                url: cleanUrl,
                domain,
                threats: [],
                message: `Scan failed: ${err.message}`
            };
        }

        setResult(scanResult);

        // Log the scan to Firestore
        if (user) {
            try {
                await addDoc(collection(db, 'logs'), {
                    userId: user.uid,
                    action: 'url_scan',
                    url: cleanUrl,
                    domain,
                    result: scanResult.status,
                    timestamp: serverTimestamp()
                });
                // Reload recent scans
                loadRecentScans();
            } catch (error) {
                console.error('Error logging scan:', error);
            }
        }

        setScanning(false);
    };

    const getResultIcon = (status) => {
        switch (status) {
            case 'safe': return <CheckCircle size={48} />;
            case 'warning': return <AlertTriangle size={48} />;
            case 'danger': return <XCircle size={48} />;
            default: return <ShieldCheck size={48} />;
        }
    };

    const getResultVariant = (status) => {
        switch (status) {
            case 'safe': return 'success';
            case 'warning': return 'warning';
            case 'danger': return 'danger';
            default: return 'info';
        }
    };

    const formatTime = (date) => {
        if (!date) return '';
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1>Link Scanner <Badge variant="info">Beta Preview</Badge></h1>
                <p>Check if a website is safe before visiting.</p>
            </header>

            {/* Scanner Input */}
            <Card className={styles.scannerCard}>
                <div className={styles.inputRow}>
                    <Input
                        placeholder="Enter a URL to scan (e.g., example.com)"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                        icon={Globe}
                    />
                    <Button onClick={handleScan} disabled={!url || scanning}>
                        {scanning ? (
                            <>
                                <Loader size={18} className={styles.spinner} />
                                Scanning...
                            </>
                        ) : (
                            <>
                                <Search size={18} />
                                Scan
                            </>
                        )}
                    </Button>
                </div>
            </Card>

            {/* Scan Result */}
            {result && (
                <Card variant={getResultVariant(result.status)} className={styles.resultCard}>
                    <div className={styles.resultIcon} data-status={result.status}>
                        {getResultIcon(result.status)}
                    </div>
                    <div className={styles.resultContent}>
                        <Badge variant={getResultVariant(result.status)}>
                            {result.status === 'safe' ? 'Safe' :
                                result.status === 'warning' ? 'Caution' : 'Blocked'}
                        </Badge>
                        <h3>{result.domain}</h3>
                        <p>{result.message}</p>
                        {result.threats.length > 0 && (
                            <ul className={styles.threats}>
                                {result.threats.map((threat, i) => (
                                    <li key={i}><AlertTriangle size={14} /> {threat}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </Card>
            )}

            {/* Recent Scans */}
            <section className={styles.section}>
                <h3>Recent Scans</h3>
                {loadingHistory ? (
                    <div className={styles.loadingState}>
                        <Loader size={24} className={styles.spinner} />
                    </div>
                ) : recentScans.length === 0 ? (
                    <Card className={styles.emptyState}>
                        <Clock size={32} />
                        <p>No recent scans</p>
                    </Card>
                ) : (
                    <div className={styles.scanList}>
                        {recentScans.map(scan => (
                            <div key={scan.id} className={styles.scanItem}>
                                <div className={`${styles.statusDot} ${styles[scan.result]}`} />
                                <div className={styles.scanInfo}>
                                    <span className={styles.scanDomain}>{scan.domain}</span>
                                    <span className={styles.scanTime}>{formatTime(scan.timestamp)}</span>
                                </div>
                                <button
                                    className={styles.rescanBtn}
                                    onClick={() => {
                                        setUrl(scan.url);
                                        handleScan();
                                    }}
                                >
                                    Rescan
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Info Card */}
            <Card className={styles.infoCard}>
                <Info size={20} />
                <div>
                    <h4>How it works</h4>
                    <p>
                        Our scanner checks URLs against multiple threat databases including
                        Google Safe Browsing, phishing databases, and our blocklist to ensure
                        the site is safe before you visit.
                    </p>
                </div>
            </Card>
        </div>
    );
};

export default Scanner;
