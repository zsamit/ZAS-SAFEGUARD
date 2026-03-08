import React, { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    Smartphone,
    Shield,
    EyeOff,
    ScanLine,
    Bell,
    Settings,
    Users,
    LogOut,
    AlertTriangle,
    Sparkles
} from 'lucide-react';
import Logo from '../../components/Logo';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import OnboardingModal from './OnboardingModal';
import styles from './Layout.module.css';

const DashboardLayout = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();
    const [showOnboarding, setShowOnboarding] = useState(true);

    // Get display name and plan
    const displayName = userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User';
    const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    // Subscription state
    const subscription = userProfile?.subscription;
    const planStatus = subscription?.plan_status || subscription?.status || '';
    const plan = subscription?.plan || '';

    const isActive = ['trialing', 'active'].includes(planStatus) || plan === 'lifetime';
    const isExpired = !isActive && user && userProfile;

    const planName = plan === 'lifetime' ? 'Lifetime' :
        plan === 'pro' || planStatus === 'active' ? 'Pro Plan' :
            isExpired ? 'Expired' : 'Free Plan';

    // Check if user needs onboarding
    const needsOnboarding = showOnboarding && user && (
        !userProfile ||
        userProfile.protectionMode === undefined ||
        userProfile.protectionMode === null
    );

    // Only hide sidebar on checkout page — everything else stays visible
    const isCheckoutPage = location.pathname.includes('/checkout');
    const hideSidebar = isCheckoutPage;

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

            {/* Sidebar - Desktop (always visible except checkout) */}
            {!hideSidebar && (
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
                                <span className={`${styles.userPlan} ${isExpired ? styles.planExpired : ''}`}>
                                    {planName}
                                </span>
                            </div>
                        </div>
                    </div>
                </aside>
            )}

            {/* Main Content */}
            <main className={styles.main}>
                {/* Expired Trial Banner */}
                {isExpired && !isCheckoutPage && (
                    <div className={styles.expiredBanner}>
                        <div className={styles.expiredBannerContent}>
                            <div className={styles.expiredBannerIcon}>
                                <AlertTriangle size={20} />
                            </div>
                            <div className={styles.expiredBannerText}>
                                <span className={styles.expiredBannerTitle}>
                                    Your free trial has ended
                                </span>
                                <span className={styles.expiredBannerDesc}>
                                    Protection services are currently disabled. Subscribe to reactivate all features.
                                </span>
                            </div>
                            <Button
                                size="sm"
                                onClick={() => navigate('/app/checkout?plan=yearly')}
                                className={styles.expiredBannerBtn}
                            >
                                <Sparkles size={14} />
                                Upgrade Now
                            </Button>
                        </div>
                    </div>
                )}

                <div className={styles.content}>
                    <Outlet />
                </div>
            </main>

            {/* Mobile Bottom Nav (always visible except checkout) */}
            {!hideSidebar && (
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
            )}
        </div>
    );
};

export default DashboardLayout;
