import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    Timestamp
} from 'firebase/firestore';

// Get start of today
const getTodayStart = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(today);
};

// Get start of this week
const getWeekStart = () => {
    const date = new Date();
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(date);
};

// Get start of this month
const getMonthStart = () => {
    const date = new Date();
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(date);
};

/**
 * Hook to get real-time dashboard stats
 */
export const useDashboardStats = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState({
        adsBlockedToday: 0,
        sitesBlockedToday: 0,
        activeDevices: 0,
        alertsCount: 0,
        loading: true
    });

    useEffect(() => {
        if (!user) {
            setStats(prev => ({ ...prev, loading: false }));
            return;
        }

        const todayStart = getTodayStart();

        // Query for blocked logs today (action = navigate_blocked or ad_blocked)
        const logsQuery = query(
            collection(db, 'logs'),
            where('userId', '==', user.uid),
            where('timestamp', '>=', todayStart)
        );

        // Query for devices
        const devicesQuery = query(
            collection(db, 'devices'),
            where('userId', '==', user.uid)
        );

        // Query for unread alerts
        const alertsQuery = query(
            collection(db, 'alerts'),
            where('userId', '==', user.uid),
            where('read', '==', false)
        );

        const unsubscribes = [];

        // Listen to logs with error handling
        unsubscribes.push(
            onSnapshot(
                logsQuery,
                (snapshot) => {
                    let adsBlocked = 0;
                    let sitesBlocked = 0;

                    snapshot.forEach(doc => {
                        const data = doc.data();
                        if (data.action === 'ad_blocked') {
                            adsBlocked++;
                        } else if (data.action === 'navigate_blocked') {
                            sitesBlocked++;
                        }
                    });

                    setStats(prev => ({
                        ...prev,
                        adsBlockedToday: adsBlocked,
                        sitesBlockedToday: sitesBlocked,
                        loading: false
                    }));
                },
                (error) => {
                    console.error('[useDashboardStats] Logs query error:', error.message);
                    setStats(prev => ({ ...prev, loading: false }));
                }
            )
        );

        // Listen to devices with error handling
        unsubscribes.push(
            onSnapshot(
                devicesQuery,
                (snapshot) => {
                    setStats(prev => ({
                        ...prev,
                        activeDevices: snapshot.size
                    }));
                },
                (error) => {
                    console.error('[useDashboardStats] Devices query error:', error.message);
                }
            )
        );

        // Listen to alerts with error handling
        unsubscribes.push(
            onSnapshot(
                alertsQuery,
                (snapshot) => {
                    setStats(prev => ({
                        ...prev,
                        alertsCount: snapshot.size
                    }));
                },
                (error) => {
                    console.error('[useDashboardStats] Alerts query error:', error.message);
                }
            )
        );

        return () => unsubscribes.forEach(unsub => unsub());
    }, [user]);

    return stats;
};

/**
 * Hook to get real-time devices list
 */
export const useDevices = () => {
    const { user } = useAuth();
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setDevices([]);
            setLoading(false);
            return;
        }

        const devicesQuery = query(
            collection(db, 'devices'),
            where('userId', '==', user.uid)
        );

        const unsubscribe = onSnapshot(devicesQuery, (snapshot) => {
            const devicesList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                // Convert Firestore Timestamp to readable format
                lastSeen: doc.data().lastSeen?.toDate() || null
            }));
            setDevices(devicesList);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    return { devices, loading };
};

/**
 * Hook to get real-time alerts
 */
export const useAlerts = (limitCount = 50) => {
    const { user } = useAuth();
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setAlerts([]);
            setLoading(false);
            return;
        }

        const alertsQuery = query(
            collection(db, 'alerts'),
            where('userId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );

        const unsubscribe = onSnapshot(
            alertsQuery,
            (snapshot) => {
                const alertsList = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    timestamp: doc.data().timestamp?.toDate() || null
                }));
                setAlerts(alertsList);
                setLoading(false);
            },
            (error) => {
                // Handle index errors gracefully
                console.error('[useAlerts] Query error:', error.message);
                setAlerts([]);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user, limitCount]);

    return { alerts, loading };
};

/**
 * Hook to get real-time activity logs
 */
export const useActivityLogs = (limitCount = 50) => {
    const { user } = useAuth();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setLogs([]);
            setLoading(false);
            return;
        }

        const logsQuery = query(
            collection(db, 'logs'),
            where('userId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );

        const unsubscribe = onSnapshot(
            logsQuery,
            (snapshot) => {
                const logsList = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    timestamp: doc.data().timestamp?.toDate() || null
                }));
                setLogs(logsList);
                setLoading(false);
            },
            (error) => {
                // Handle index errors gracefully
                console.error('[useActivityLogs] Query error:', error.message);
                setLogs([]);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user, limitCount]);

    return { logs, loading };
};

/**
 * Hook to get children profiles (for family mode)
 */
export const useChildren = () => {
    const { user } = useAuth();
    const [children, setChildren] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setChildren([]);
            setLoading(false);
            return;
        }

        const childrenQuery = query(
            collection(db, 'children'),
            where('parentId', '==', user.uid)
        );

        const unsubscribe = onSnapshot(childrenQuery, (snapshot) => {
            const childrenList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setChildren(childrenList);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    return { children, loading };
};

/**
 * Hook to get ad blocker stats
 */
export const useAdBlockerStats = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState({
        today: 0,
        week: 0,
        month: 0,
        loading: true
    });

    useEffect(() => {
        if (!user) {
            setStats(prev => ({ ...prev, loading: false }));
            return;
        }

        const todayStart = getTodayStart();
        const weekStart = getWeekStart();
        const monthStart = getMonthStart();

        // Query all ad_blocked logs for this month
        const logsQuery = query(
            collection(db, 'logs'),
            where('userId', '==', user.uid),
            where('action', '==', 'ad_blocked'),
            where('timestamp', '>=', monthStart)
        );

        const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
            let today = 0;
            let week = 0;
            let month = 0;

            snapshot.forEach(doc => {
                const data = doc.data();
                const timestamp = data.timestamp?.toDate();

                if (timestamp) {
                    month++;
                    if (timestamp >= weekStart.toDate()) {
                        week++;
                    }
                    if (timestamp >= todayStart.toDate()) {
                        today++;
                    }
                }
            });

            setStats({ today, week, month, loading: false });
        });

        return () => unsubscribe();
    }, [user]);

    return stats;
};

/**
 * Hook to get protection status
 */
export const useProtectionStatus = () => {
    const { user, userProfile } = useAuth();

    // Derive status from user profile
    const categories = userProfile?.settings?.categories || {};
    const hasAlerts = false; // Could be derived from alerts count

    // Check if all core protections are enabled
    const coreProtectionsEnabled =
        categories.porn?.enabled !== false && // Adult content is always on
        categories.gambling?.enabled !== false;

    const status = coreProtectionsEnabled ? 'protected' : 'attention';

    return {
        status,
        isProtected: status === 'protected',
        categories,
        loading: !userProfile
    };
};
