import React, { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Smartphone,
    Shield,
    EyeOff,
    ScanLine,
    Bell,
    Settings,
    Users,
    LogOut
} from 'lucide-react';
import Logo from '../../components/Logo';
import { useAuth } from '../../context/AuthContext';
import OnboardingModal from './OnboardingModal';
import styles from './Layout.module.css';

const DashboardLayout = () => {
    const location = useLocation();
    const { user, userProfile } = useAuth();
    const [showOnboarding, setShowOnboarding] = useState(true);

    // Get display name and plan
    const displayName = userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User';
    const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const planName = userProfile?.subscription?.plan === 'lifetime' ? 'Lifetime' :
        userProfile?.subscription?.plan === 'pro' ? 'Pro Plan' :
            userProfile?.subscription?.status === 'active' ? 'Pro Plan' : 'Free Plan';

    // Check if user needs onboarding (logged in but no protectionMode set)
    // For new accounts, userProfile might not exist yet, so we check if profile exists AND mode is not set
    // OR if profile exists but protectionMode is undefined/null
    const needsOnboarding = showOnboarding && user && (
        !userProfile ||
        userProfile.protectionMode === undefined ||
        userProfile.protectionMode === null
    );

    const navItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/app/dashboard' },
        { icon: Smartphone, label: 'Devices', path: '/app/devices' },
        { icon: Shield, label: 'Protection', path: '/app/protection' },
        { icon: EyeOff, label: 'Ad Blocker', path: '/app/adblock' },
        { icon: ScanLine, label: 'Scanner', path: '/app/scanner' },
        { icon: Bell, label: 'Alerts', path: '/app/alerts' },
        { icon: Users, label: 'Family', path: '/app/family' },
    ];

    const bottomNavItems = [
        { icon: Settings, label: 'Settings', path: '/app/settings' },
    ];

    return (
        <div className={styles.layout}>
            {/* Onboarding Modal */}
            {needsOnboarding && (
                <OnboardingModal onComplete={() => setShowOnboarding(false)} />
            )}

            {/* Sidebar - Desktop */}
            <aside className={styles.sidebar}>
                {/* Logo */}
                <div className={styles.sidebarHeader}>
                    <Logo size="sm" variant="white" linkTo="/" />
                </div>

                {/* Navigation */}
                <nav className={styles.nav}>
                    <div className={styles.navSection}>
                        {navItems.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                className={({ isActive }) =>
                                    `${styles.navItem} ${isActive ? styles.active : ''}`
                                }
                            >
                                <item.icon size={18} />
                                <span>{item.label}</span>
                            </NavLink>
                        ))}
                    </div>
                </nav>

                {/* Bottom Section */}
                <div className={styles.sidebarFooter}>
                    {bottomNavItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) =>
                                `${styles.navItem} ${isActive ? styles.active : ''}`
                            }
                        >
                            <item.icon size={18} />
                            <span>{item.label}</span>
                        </NavLink>
                    ))}

                    {/* User Profile */}
                    <div className={styles.userProfile}>
                        <div className={styles.avatar}>{initials}</div>
                        <div className={styles.userInfo}>
                            <span className={styles.userName}>{displayName}</span>
                            <span className={styles.userPlan}>{planName}</span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className={styles.main}>
                <div className={styles.content}>
                    <Outlet />
                </div>
            </main>

            {/* Mobile Bottom Nav */}
            <nav className={styles.mobileNav}>
                {navItems.slice(0, 4).map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                            `${styles.mobileNavItem} ${isActive ? styles.active : ''}`
                        }
                    >
                        <item.icon size={20} />
                        <span>{item.label}</span>
                    </NavLink>
                ))}
                {/* Settings - always visible on mobile */}
                <NavLink
                    to="/app/settings"
                    className={({ isActive }) =>
                        `${styles.mobileNavItem} ${isActive ? styles.active : ''}`
                    }
                >
                    <Settings size={20} />
                    <span>Settings</span>
                </NavLink>
            </nav>
        </div>
    );
};

export default DashboardLayout;
