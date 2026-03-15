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
    Lock,
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

    // Get display name
    const displayName = userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User';
    const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    // Subscription state
    const subscription = userProfile?.subscription;
    const planStatus = subscription?.plan_status || subscription?.status || '';
    const plan = subscription?.plan || '';

    const isActive = ['trialing', 'active'].includes(planStatus) || plan === 'lifetime';
    const isTrial = planStatus === 'trialing';
    // UI-04: Don't show "Expired" for new users who haven't had a subscription yet
    const hasSubscription = !!subscription && (!!planStatus || !!plan);
    const isExpired = hasSubscription && !isActive && user && userProfile;
    const isPremium = isActive && !isTrial;

    const planName = plan === 'lifetime' ? 'Lifetime' :
        isPremium ? 'Premium' :
            isTrial ? 'Trial' :
                isExpired ? 'Expired' : 'Free';

    // Check if user needs onboarding
    const needsOnboarding = showOnboarding && user && (
        !userProfile ||
        userProfile.protectionMode === undefined ||
        userProfile.protectionMode === null
    );

    // Only hide sidebar on checkout page
    const isCheckoutPage = location.pathname.includes('/checkout');
    const hideSidebar = isCheckoutPage;

    // Navigation items with premium lock indicators
    // Mode A: Always accessible | Mode B: Locked when not entitled
    // Order: Overview → Alerts (most actionable) → Protection → Devices → Family → Tools
    const navItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/app/dashboard', mode: 'A' },
        { icon: Bell, label: 'Alerts', path: '/app/alerts', mode: 'B' },
        { icon: Shield, label: 'Protection', path: '/app/protection', mode: 'A' },
        { icon: Smartphone, label: 'Devices', path: '/app/devices', mode: 'B' },
        { icon: Users, label: 'Family', path: '/app/family', mode: 'B' },
        { icon: ScanLine, label: 'Link Scanner', path: '/app/scanner', mode: 'B' },
        { icon: EyeOff, label: 'Ad Blocker', path: '/app/adblock', mode: 'B' },
    ];

    const bottomNavItems = [
        { icon: Settings, label: 'Settings', path: '/app/settings', mode: 'A' },
    ];

    // UI-03: Firestore field is 'trial_end', not 'trialEnd'
    const trialEnd = subscription?.trial_end;
    const trialDaysLeft = isTrial && trialEnd
        ? Math.max(0, Math.ceil((
            (trialEnd.toDate ? trialEnd.toDate().getTime() : new Date(trialEnd).getTime()) - Date.now()
        ) / (1000 * 60 * 60 * 24)))
        : null;

    return (
        <div className={styles.layout}>
            {/* Onboarding Modal */}
            {needsOnboarding && (
                <OnboardingModal onComplete={() => setShowOnboarding(false)} />
            )}

            {/* Sidebar - Always visible (except checkout) */}
            {!hideSidebar && (
                <aside className={styles.sidebar}>
                    <div className={styles.sidebarHeader}>
                        <Logo size="sm" variant="white" linkTo="/" />
                    </div>

                    <nav className={styles.nav}>
                        <div className={styles.navSection}>
                            {navItems.map((item) => {
                                const isLocked = item.mode === 'B' && !isActive;
                                return (
                                    <NavLink
                                        key={item.path}
                                        to={item.path}
                                        className={({ isActive: isRouteActive }) =>
                                            `${styles.navItem} ${isRouteActive ? styles.active : ''} ${isLocked ? styles.navItemLocked : ''}`
                                        }
                                    >
                                        <item.icon size={18} />
                                        <span>{item.label}</span>
                                        {isLocked && <Lock size={14} className={styles.lockIndicator} />}
                                    </NavLink>
                                );
                            })}
                        </div>
                    </nav>

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
                {/* Trial Active Banner */}
                {isTrial && trialDaysLeft !== null && !isCheckoutPage && (
                    <div className={styles.trialBanner}>
                        <div className={styles.trialBannerContent}>
                            <Sparkles size={16} className={styles.trialIcon} />
                            <span>
                                Trial active — {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining.
                            </span>
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => navigate('/app/checkout?plan=yearly')}
                            >
                                Upgrade Now
                            </Button>
                        </div>
                    </div>
                )}

                {/* UI-11: Don't show expired banner on dashboard (Overview has its own) */}
                {isExpired && !isCheckoutPage && !location.pathname.includes('/dashboard') && (
                    <div className={styles.expiredBanner}>
                        <div className={styles.expiredBannerContent}>
                            <div className={styles.expiredBannerIcon}>
                                <AlertTriangle size={20} />
                            </div>
                            <div className={styles.expiredBannerText}>
                                <span className={styles.expiredBannerTitle}>
                                    Your premium access has expired
                                </span>
                                <span className={styles.expiredBannerDesc}>
                                    Adult blocking remains active. Upgrade to restore full AI Browser Security protection.
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
                    <Outlet context={{ isActive, isExpired, isTrial, isPremium, planName }} />
                </div>
            </main>

            {/* Mobile Bottom Nav */}
            {!hideSidebar && (
                <nav className={styles.mobileNav}>
                    {navItems.slice(0, 4).map((item) => {
                        const isLocked = item.mode === 'B' && !isActive;
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                className={({ isActive: isRouteActive }) =>
                                    `${styles.mobileNavItem} ${isRouteActive ? styles.active : ''}`
                                }
                            >
                                <item.icon size={20} />
                                <span>{item.label}</span>
                            </NavLink>
                        );
                    })}
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
