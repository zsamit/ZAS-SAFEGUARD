import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useDevices } from '../../hooks/useFirestore';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Laptop, Smartphone, Tablet, Wifi, Activity, PauseCircle, Plus, Loader, CheckCircle } from 'lucide-react';
import LockedFeature from '../../components/LockedFeature';
import styles from './Devices.module.css';

const Devices = () => {
    const { isActive } = useOutletContext();
    if (!isActive) return <LockedFeature feature="dashboard_admin" customTitle="Device Management" customDescription="View and manage all your connected devices. Control internet access, monitor activity, and pause protection remotely from your dashboard." />;

    // Real devices from Firebase
    const { devices, loading } = useDevices();
    const { user } = useAuth();

    // Track action states per device
    const [actionStates, setActionStates] = useState({});

    // Format relative time
    const formatLastSeen = (date) => {
        if (!date) return 'Never';

        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Now';
        if (minutes < 60) return `${minutes} min ago`;
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        return `${days} day${days > 1 ? 's' : ''} ago`;
    };

    // Determine device status based on lastSeen
    const getDeviceStatus = (lastSeen) => {
        if (!lastSeen) return 'offline';
        const now = new Date();
        const diff = now - lastSeen;
        if (diff < 300000) return 'online'; // 5 minutes
        if (diff < 3600000) return 'sleeping'; // 1 hour
        return 'offline';
    };

    // Handle device actions
    const handleInternetLock = async (deviceId) => {
        const currentState = actionStates[deviceId]?.internetLock || false;
        setActionStates(prev => ({
            ...prev,
            [deviceId]: { ...prev[deviceId], internetLock: !currentState }
        }));

        // In production: update device document in Firestore
        if (user) {
            try {
                await updateDoc(doc(db, 'devices', deviceId), {
                    internetLocked: !currentState
                });
            } catch (error) {
                console.error('Error toggling internet lock:', error);
            }
        }

        alert(!currentState ? 'Internet locked on this device' : 'Internet unlocked on this device');
    };

    const handleViewActivity = (deviceId, deviceName) => {
        // Navigate to activity log filtered by device
        alert(`Viewing activity for ${deviceName}\n\nThis would show browsing history, blocked sites, and usage stats for this device.`);
    };

    const handlePauseProtection = async (deviceId) => {
        const currentState = actionStates[deviceId]?.paused || false;
        setActionStates(prev => ({
            ...prev,
            [deviceId]: { ...prev[deviceId], paused: !currentState }
        }));

        // In production: update device document
        if (user) {
            try {
                await updateDoc(doc(db, 'devices', deviceId), {
                    protectionPaused: !currentState
                });
            } catch (error) {
                console.error('Error toggling protection:', error);
            }
        }

        alert(!currentState ? 'Protection paused for 1 hour' : 'Protection resumed');
    };

    const handleAddDevice = () => {
        alert('To add a new device:\n\n1. Install ZAS Safeguard browser extension on the device\n2. Sign in with your account\n3. The device will appear here automatically\n\nSupported: Chrome, Firefox, Safari, Edge');
    };

    if (loading) {
        return (
            <div className={styles.page}>
                <div className={styles.loadingState}>
                    <Loader size={32} className={styles.spinner} />
                    <span>Loading devices...</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div>
                    <h1>Devices</h1>
                    <p>Manage protection on your connected devices.</p>
                </div>
                <Button onClick={handleAddDevice}>
                    <Plus size={18} />
                    Add Device
                </Button>
            </header>

            {devices.length === 0 ? (
                <Card className={styles.emptyState}>
                    <Smartphone size={48} />
                    <h3>No Devices Connected</h3>
                    <p>Install ZAS Safeguard on your devices to see them here.</p>
                    <Button onClick={handleAddDevice}>Add Your First Device</Button>
                </Card>
            ) : (
                <div className={styles.grid}>
                    {devices.map(device => (
                        <DeviceCard
                            key={device.id}
                            device={{
                                ...device,
                                status: getDeviceStatus(device.lastSeen),
                                lastSeenFormatted: formatLastSeen(device.lastSeen)
                            }}
                            actionState={actionStates[device.id] || {}}
                            onInternetLock={() => handleInternetLock(device.id)}
                            onViewActivity={() => handleViewActivity(device.id, device.name)}
                            onPause={() => handlePauseProtection(device.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const DeviceCard = ({ device, actionState, onInternetLock, onViewActivity, onPause }) => {
    const getIcon = () => {
        const type = device.type?.toLowerCase() || '';
        if (type.includes('mac') || type.includes('laptop') || type.includes('chrome')) {
            return <Laptop size={28} />;
        }
        if (type.includes('ipad') || type.includes('tablet')) {
            return <Tablet size={28} />;
        }
        return <Smartphone size={28} />;
    };

    const getOSName = () => {
        const type = device.type?.toLowerCase() || '';
        if (type.includes('mac')) return 'macOS';
        if (type.includes('ipad')) return 'iPadOS';
        if (type.includes('ios') || type.includes('iphone')) return 'iOS';
        if (type.includes('android')) return 'Android';
        if (type.includes('windows')) return 'Windows';
        if (type.includes('chrome')) return 'Chrome';
        return device.type || 'Unknown';
    };

    const getStatusVariant = () => {
        switch (device.status) {
            case 'online': return 'success';
            case 'sleeping': return 'warning';
            default: return 'neutral';
        }
    };

    return (
        <Card className={styles.deviceCard}>
            <div className={styles.deviceHeader}>
                <div className={styles.deviceIcon}>
                    {getIcon()}
                </div>
                <Badge variant={getStatusVariant()}>
                    {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
                </Badge>
            </div>

            <div className={styles.deviceInfo}>
                <h3>{device.name || device.type || 'Unknown Device'}</h3>
                <div className={styles.deviceMeta}>
                    <span>{getOSName()}</span>
                    <span className={styles.dot}>•</span>
                    <span>Last seen: {device.lastSeenFormatted}</span>
                </div>
            </div>

            <div className={styles.deviceActions}>
                <ActionButton
                    icon={actionState.internetLock ? <CheckCircle size={16} /> : <Wifi size={16} />}
                    label={actionState.internetLock ? "Locked" : "Internet Lock"}
                    active={actionState.internetLock}
                    onClick={onInternetLock}
                />
                <ActionButton
                    icon={<Activity size={16} />}
                    label="View Activity"
                    onClick={onViewActivity}
                />
                <ActionButton
                    icon={<PauseCircle size={16} />}
                    label={actionState.paused ? "Resume" : "Pause"}
                    active={actionState.paused}
                    onClick={onPause}
                />
            </div>
        </Card>
    );
};

const ActionButton = ({ icon, label, onClick, active }) => (
    <button
        className={`${styles.actionButton} ${active ? styles.active : ''}`}
        onClick={onClick}
    >
        {icon}
        <span>{label}</span>
    </button>
);

export default Devices;
