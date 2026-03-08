import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { useAlerts } from '../../hooks/useFirestore';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, AlertTriangle, AlertCircle, CheckCircle, Laptop, Smartphone, Tablet, Loader } from 'lucide-react';
import LockedFeature from '../../components/LockedFeature';
import styles from './Alerts.module.css';

const Alerts = () => {
    const { isActive } = useOutletContext();
    if (!isActive) return <LockedFeature feature="advanced_alerts" />;

    // Real alerts from Firebase  
    const { alerts, loading } = useAlerts();
    const { user } = useAuth();

    // Format timestamp to readable format
    const formatTime = (date) => {
        if (!date) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date) => {
        if (!date) return '';
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    if (loading) {
        return (
            <div className={styles.page}>
                <header className={styles.header}>
                    <h1>Security Alerts</h1>
                    <p>Timeline of security events and blocked attempts.</p>
                </header>
                <div className={styles.loadingState}>
                    <Loader size={32} className={styles.spinner} />
                    <span>Loading alerts...</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1>Security Alerts</h1>
                <p>Timeline of security events and blocked attempts.</p>
            </header>

            {alerts.length === 0 ? (
                <div className={styles.emptyState}>
                    <CheckCircle size={48} />
                    <h3>All Clear</h3>
                    <p>No security alerts in the last 30 days.</p>
                </div>
            ) : (
                <div className={styles.timeline}>
                    {alerts.map(alert => (
                        <AlertItem
                            key={alert.id}
                            alert={{
                                ...alert,
                                time: formatTime(alert.timestamp),
                                date: formatDate(alert.timestamp)
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const AlertItem = ({ alert }) => {
    // Map alert type to severity
    const getSeverity = () => {
        const type = alert.type?.toLowerCase() || '';
        if (type.includes('malware') || type.includes('phishing') || type.includes('danger')) return 'high';
        if (type.includes('adult') || type.includes('blocked') || type.includes('warning')) return 'medium';
        if (type.includes('tracker') || type.includes('ad')) return 'low';
        return 'info';
    };

    const severity = getSeverity();

    const getSeverityIcon = () => {
        switch (severity) {
            case 'high': return <ShieldAlert size={18} />;
            case 'medium': return <AlertTriangle size={18} />;
            case 'low': return <AlertCircle size={18} />;
            default: return <AlertCircle size={18} />;
        }
    };

    const getDeviceIcon = () => {
        const deviceType = alert.deviceType?.toLowerCase() || '';
        if (deviceType.includes('laptop') || deviceType.includes('mac')) return <Laptop size={14} />;
        if (deviceType.includes('tablet') || deviceType.includes('ipad')) return <Tablet size={14} />;
        return <Smartphone size={14} />;
    };

    const getSeverityVariant = () => {
        switch (severity) {
            case 'high': return 'danger';
            case 'medium': return 'warning';
            case 'low': return 'neutral';
            default: return 'info';
        }
    };

    return (
        <div className={styles.alertItem}>
            {/* Severity Dot */}
            <div className={`${styles.severityDot} ${styles[severity]}`} />

            {/* Content */}
            <Card className={styles.alertCard}>
                <div className={styles.alertHeader}>
                    <div className={styles.alertIcon} data-severity={severity}>
                        {getSeverityIcon()}
                    </div>
                    <div className={styles.alertMeta}>
                        <span className={styles.alertDate}>{alert.date}</span>
                        <span className={styles.alertTime}>{alert.time}</span>
                    </div>
                </div>

                <h3 className={styles.alertTitle}>{alert.title || alert.type || 'Alert'}</h3>
                <p className={styles.alertDesc}>{alert.description || alert.url || alert.details || 'Security event detected'}</p>

                <div className={styles.alertFooter}>
                    <div className={styles.deviceBadge}>
                        {getDeviceIcon()}
                        <span>{alert.deviceName || alert.deviceType || 'Unknown Device'}</span>
                    </div>
                    {severity === 'high' && (
                        <Badge variant="danger">Action Required</Badge>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default Alerts;
