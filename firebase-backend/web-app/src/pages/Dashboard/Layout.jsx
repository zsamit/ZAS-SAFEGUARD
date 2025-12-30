import React from 'react';
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
import styles from './Layout.module.css';

const DashboardLayout = () => {
    const location = useLocation();

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
                        <div className={styles.avatar}>ZA</div>
                        <div className={styles.userInfo}>
                            <span className={styles.userName}>Zaheer Ahmad</span>
                            <span className={styles.userPlan}>Pro Plan</span>
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
