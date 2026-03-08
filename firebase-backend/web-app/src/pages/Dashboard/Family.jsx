import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { useChildren } from '../../hooks/useFirestore';
import { db } from '../../firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import {
    Users,
    Plus,
    Bell,
    Clock,
    Mail,
    Shield,
    Settings,
    ChevronRight,
    Loader,
    X,
    Trash2,
    Edit
} from 'lucide-react';
import LockedFeature from '../../components/LockedFeature';
import styles from './Family.module.css';

const Family = () => {
    const { isActive } = useOutletContext();
    if (!isActive) return <LockedFeature feature="dashboard_admin" customTitle="Family Controls — Beta Preview" customDescription="Manage and protect your family members' online activity. Add child profiles, monitor browsing, configure alerts, and set content restrictions across all connected devices. This feature is in Beta Preview." />;

    const { user, userProfile } = useAuth();
    const { children, loading } = useChildren();
    const isParent = userProfile?.mode === 'family';

    const [settings, setSettings] = useState({
        dailyDigest: true,
        instantAlerts: true,
        weeklyReport: true,
        quietHoursEnabled: false,
    });

    // Add child modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [newChildName, setNewChildName] = useState('');
    const [newChildAge, setNewChildAge] = useState('');
    const [saving, setSaving] = useState(false);

    const handleAddChild = async () => {
        if (!newChildName || !user) return;

        setSaving(true);
        try {
            await addDoc(collection(db, 'children'), {
                parentId: user.uid,
                name: newChildName,
                age: newChildAge ? parseInt(newChildAge) : null,
                createdAt: serverTimestamp(),
                deviceCount: 0,
                alertsCount: 0
            });
            setNewChildName('');
            setNewChildAge('');
            setShowAddModal(false);
        } catch (error) {
            console.error('Error adding child:', error);
            alert('Failed to add child profile');
        }
        setSaving(false);
    };

    const handleDeleteChild = async (childId, childName) => {
        if (!confirm(`Are you sure you want to remove ${childName}'s profile?`)) return;

        try {
            await deleteDoc(doc(db, 'children', childId));
        } catch (error) {
            console.error('Error deleting child:', error);
            alert('Failed to delete profile');
        }
    };

    const handleManageChild = (child) => {
        alert(`Managing ${child.name}'s settings\n\nHere you would configure:\n• Device access\n• Screen time limits\n• Content restrictions\n• Activity monitoring`);
    };

    const handleSwitchToFamily = async () => {
        if (!user) return;

        try {
            await updateDoc(doc(db, 'users', user.uid), {
                mode: 'family'
            });
            alert('Switched to Family Mode! Add child profiles to start monitoring.');
            window.location.reload();
        } catch (error) {
            console.error('Error switching mode:', error);
            alert('Failed to switch mode');
        }
    };

    if (loading) {
        return (
            <div className={styles.page}>
                <div className={styles.loadingState}>
                    <Loader size={32} className={styles.spinner} />
                    <span>Loading family settings...</span>
                </div>
            </div>
        );
    }

    if (!isParent) {
        return (
            <div className={styles.page}>
                <header className={styles.header}>
                    <h1>Family Controls <Badge variant="info">Beta Preview</Badge></h1>
                    <p>Monitor and protect your family's online activity.</p>
                </header>

                <Card className={styles.setupCard}>
                    <Users size={48} />
                    <h2>Set up Family Protection</h2>
                    <p>Enable family mode to monitor and protect family members across all devices.</p>
                    <Button onClick={handleSwitchToFamily}>
                        Switch to Family Mode
                    </Button>
                </Card>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div>
                    <h1>Family Controls <Badge variant="info">Beta Preview</Badge></h1>
                    <p>Monitor and protect your family's online activity.</p>
                </div>
                <Button onClick={() => setShowAddModal(true)}>
                    <Plus size={18} />
                    Add Child
                </Button>
            </header>

            {/* Child Profiles - REAL DATA */}
            <section className={styles.section}>
                <h3>Child Profiles</h3>
                {children.length === 0 ? (
                    <Card className={styles.emptyState}>
                        <Users size={48} />
                        <h3>No Child Profiles</h3>
                        <p>Add your first child to start monitoring their online activity.</p>
                        <Button onClick={() => setShowAddModal(true)}>Add Child</Button>
                    </Card>
                ) : (
                    <div className={styles.childGrid}>
                        {children.map(child => (
                            <ChildCard
                                key={child.id}
                                child={child}
                                onManage={() => handleManageChild(child)}
                                onDelete={() => handleDeleteChild(child.id, child.name)}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* Notification Settings */}
            <section className={styles.section}>
                <h3>Notification Settings</h3>
                <Card className={styles.settingsCard}>
                    <SettingItem
                        icon={<Mail size={18} />}
                        label="Daily Digest"
                        description="Receive a summary email each morning"
                        checked={settings.dailyDigest}
                        onChange={() => setSettings(s => ({ ...s, dailyDigest: !s.dailyDigest }))}
                    />
                    <div className={styles.divider} />
                    <SettingItem
                        icon={<Bell size={18} />}
                        label="Instant Alerts"
                        description="Get notified immediately for high-severity events"
                        checked={settings.instantAlerts}
                        onChange={() => setSettings(s => ({ ...s, instantAlerts: !s.instantAlerts }))}
                    />
                    <div className={styles.divider} />
                    <SettingItem
                        icon={<Clock size={18} />}
                        label="Weekly Report"
                        description="Comprehensive weekly protection summary"
                        checked={settings.weeklyReport}
                        onChange={() => setSettings(s => ({ ...s, weeklyReport: !s.weeklyReport }))}
                    />
                </Card>
            </section>

            {/* Quiet Hours */}
            <section className={styles.section}>
                <h3>Quiet Hours</h3>
                <Card className={styles.quietCard}>
                    <div className={styles.quietHeader}>
                        <div>
                            <h4>Enable Quiet Hours</h4>
                            <p>Pause non-critical notifications during specific times</p>
                        </div>
                        <Toggle
                            checked={settings.quietHoursEnabled}
                            onChange={() => setSettings(s => ({ ...s, quietHoursEnabled: !s.quietHoursEnabled }))}
                        />
                    </div>
                    {settings.quietHoursEnabled && (
                        <div className={styles.quietTimes}>
                            <div className={styles.timeInput}>
                                <label>Start</label>
                                <input type="time" defaultValue="22:00" />
                            </div>
                            <div className={styles.timeInput}>
                                <label>End</label>
                                <input type="time" defaultValue="07:00" />
                            </div>
                        </div>
                    )}
                </Card>
            </section>

            {/* Info */}
            <Card className={styles.infoCard}>
                <Shield size={20} />
                <p>
                    Family controls help you protect your children while respecting their privacy.
                    We only notify you about potential safety concerns, not every browsing action.
                </p>
            </Card>

            {/* Add Child Modal */}
            {showAddModal && (
                <div className={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
                    <Card className={styles.modal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3>Add Child Profile</h3>
                            <button className={styles.closeBtn} onClick={() => setShowAddModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <Input
                            label="Child's Name"
                            placeholder="e.g., Ahmed"
                            value={newChildName}
                            onChange={(e) => setNewChildName(e.target.value)}
                        />
                        <Input
                            label="Age (optional)"
                            placeholder="e.g., 12"
                            type="number"
                            value={newChildAge}
                            onChange={(e) => setNewChildAge(e.target.value)}
                        />
                        <div className={styles.modalActions}>
                            <Button variant="ghost" onClick={() => setShowAddModal(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddChild} disabled={!newChildName || saving}>
                                {saving ? <Loader size={16} className={styles.spinner} /> : null}
                                Add Child
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

const ChildCard = ({ child, onManage, onDelete }) => {
    const alertsToday = child.alertsCount || 0;
    const status = alertsToday > 0 ? 'attention' : 'protected';

    return (
        <Card className={styles.childCard}>
            <div className={styles.childHeader}>
                <div className={`${styles.avatar} ${status === 'attention' ? styles.attention : ''}`}>
                    {child.name?.charAt(0)?.toUpperCase() || 'C'}
                </div>
                <div className={styles.childHeaderActions}>
                    <Badge variant={status === 'protected' ? 'success' : 'warning'}>
                        {status === 'protected' ? 'Protected' : 'Attention'}
                    </Badge>
                    <button className={styles.deleteBtn} onClick={onDelete}>
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
            <div className={styles.childInfo}>
                <h4>{child.name || 'Child'}</h4>
                <span>{child.age ? `${child.age} years old` : 'Age not set'}</span>
            </div>
            <div className={styles.childStats}>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{child.deviceCount || 0}</span>
                    <span className={styles.statLabel}>Devices</span>
                </div>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{alertsToday}</span>
                    <span className={styles.statLabel}>Alerts Today</span>
                </div>
            </div>
            <Button variant="ghost" fullWidth className={styles.childAction} onClick={onManage}>
                <Settings size={16} />
                Manage
                <ChevronRight size={16} />
            </Button>
        </Card>
    );
};

const SettingItem = ({ icon, label, description, checked, onChange }) => (
    <div className={styles.settingItem}>
        <div className={styles.settingIcon}>{icon}</div>
        <div className={styles.settingContent}>
            <span className={styles.settingLabel}>{label}</span>
            <span className={styles.settingDesc}>{description}</span>
        </div>
        <Toggle checked={checked} onChange={onChange} />
    </div>
);

export default Family;
