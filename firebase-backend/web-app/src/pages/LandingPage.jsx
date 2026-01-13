import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import Logo from '../components/Logo';
import {
    Shield,
    Eye,
    Lock,
    Check,
    Heart,
    Fingerprint,
    Sparkles,
    Users,
    ScanLine,
    Globe
} from 'lucide-react';
import styles from './LandingPage.module.css';

const LandingPage = () => {
    const navigate = useNavigate();

    const handleSubscribe = (plan) => {
        navigate(`/app/checkout?plan=${plan}`);
    };

    return (
        <div className={styles.page}>
            {/* Navigation */}
            <nav className={styles.nav}>
                <Logo size="md" variant="white" linkTo="/" />
                <div className={styles.navLinks}>
                    <a href="#features" className={styles.navLink}>Features</a>
                    <a href="#pricing" className={styles.navLink}>Pricing</a>
                    <Button size="sm" onClick={() => navigate('/login')}>Dashboard</Button>
                </div>
            </nav>

            {/* Hero Section */}
            <section className={styles.hero}>
                <div className={styles.heroContent}>
                    <h1>
                        Protect Focus.<br />
                        Protect Family.<br />
                        Protect Yourself.
                    </h1>
                    <p>
                        ZAS Safeguard blocks harmful content, ads, trackers, and distractions — quietly and reliably.
                    </p>
                    <div className={styles.heroActions}>
                        <Button size="lg" onClick={() => navigate('/login')}>
                            Start Protection
                        </Button>
                        <Button variant="secondary" size="lg">
                            See How It Works
                        </Button>
                    </div>
                </div>
            </section>

            {/* Trust Strip */}
            <div className={styles.trustStrip}>
                <TrustItem icon={<Heart size={18} />} text="Built for families" />
                <TrustItem icon={<Fingerprint size={18} />} text="Privacy-first" />
                <TrustItem icon={<Eye size={18} />} text="No data selling" />
                <TrustItem icon={<Sparkles size={18} />} text="Apple-grade design" />
                <TrustItem icon={<Globe size={18} />} text="Used worldwide" />
            </div>

            {/* Features */}
            <section className={styles.features} id="features">
                <Feature
                    title="Adult Content Protection"
                    description="Always on by default. We filter harmful content at the network level to ensure family safety without compromise. No configuration needed — protection starts immediately."
                    icon={<Shield size={28} />}
                />
                <Feature
                    title="Ad & Tracker Blocking"
                    description="Browse faster and safer. We block invasive ads and invisible trackers that follow you around the web. Your data stays yours."
                    icon={<Eye size={28} />}
                    reversed
                />
                <Feature
                    title="Study & Focus Mode"
                    description="Lock distractions when it matters most. Schedule quiet hours or activate deep work sessions instantly. Perfect for students and professionals."
                    icon={<Lock size={28} />}
                />
                <Feature
                    title="Parent Control & Alerts"
                    description="Stay informed without being intrusive. Receive gentle notifications when blocked content is attempted. Configure thresholds that work for your family."
                    icon={<Users size={28} />}
                    reversed
                />
                <Feature
                    title="Malware & Link Scanner"
                    description="Scan any URL before clicking. We check against known threat databases and provide instant safety ratings. Protect yourself from phishing and malicious sites."
                    icon={<ScanLine size={28} />}
                />
            </section>

            {/* Pricing */}
            <section className={styles.pricing} id="pricing">
                <div className={styles.pricingHeader}>
                    <h2>Simple, Transparent Pricing</h2>
                    <p>Start with a 7-day free trial. Cancel anytime.</p>
                </div>

                <div className={styles.pricingCards}>
                    {/* Monthly */}
                    <Card className={styles.pricingCard}>
                        <h3>Pro Monthly</h3>
                        <div className={styles.price}>
                            $4.99<span>/month</span>
                        </div>
                        <p className={styles.pricingDesc}>
                            Flexible protection for everyone.
                        </p>
                        <Button
                            fullWidth
                            onClick={() => handleSubscribe('monthly')}
                        >
                            Start Monthly Plan
                        </Button>
                        <ul className={styles.featureList}>
                            <li><Check size={16} /> Adult content blocking (Always on)</li>
                            <li><Check size={16} /> Ad & Tracker blocking</li>
                            <li><Check size={16} /> Unlimited devices</li>
                            <li><Check size={16} /> Focus Mode</li>
                            <li><Check size={16} /> Priority support</li>
                            <li><Check size={16} /> Family sharing (up to 5)</li>
                        </ul>
                    </Card>

                    {/* Pro Yearly */}
                    <Card className={styles.pricingCard}>
                        <h3>Pro Yearly</h3>
                        <div className={styles.price}>
                            $59.99<span>/year</span>
                        </div>
                        <p className={styles.pricingDesc}>
                            Save 17% with annual billing.
                        </p>
                        <Button
                            fullWidth
                            onClick={() => handleSubscribe('yearly')}
                        >
                            Start Yearly Plan
                        </Button>
                        <ul className={styles.featureList}>
                            <li><Check size={16} /> Everything in Monthly</li>
                            <li><Check size={16} /> 2 months free</li>
                            <li><Check size={16} /> Priority support</li>
                            <li><Check size={16} /> Early access to new features</li>
                            <li><Check size={16} /> Family sharing (up to 5)</li>
                            <li><Check size={16} /> Advanced AI protection</li>
                        </ul>
                    </Card>
                </div>

                <p className={styles.pricingNote}>
                    Adult content blocking is always enabled by default and cannot be disabled.
                </p>
            </section>

            {/* Footer */}
            <footer className={styles.footer}>
                <div className={styles.footerContent}>
                    <div className={styles.footerBrand}>
                        <Logo size="sm" variant="white" />
                    </div>
                    <div className={styles.footerLinks}>
                        <a href="/privacy-policy">Privacy</a>
                        <a href="/terms-of-use">Terms</a>
                        <a href="mailto:info@zasgloballlc.com">Contact</a>
                    </div>
                </div>
                <p className={styles.copyright}>
                    © 2026 ZAS Safeguard. All rights reserved.
                </p>
            </footer>
        </div>
    );
};

const TrustItem = ({ icon, text }) => (
    <div className={styles.trustItem}>
        <span className={styles.trustIcon}>{icon}</span>
        <span>{text}</span>
    </div>
);

const Feature = ({ title, description, icon, reversed }) => (
    <div className={`${styles.feature} ${reversed ? styles.reversed : ''}`}>
        <div className={styles.featureText}>
            <div className={styles.featureIcon}>{icon}</div>
            <h2>{title}</h2>
            <p>{description}</p>
        </div>
        <div className={styles.featureMockup}>
            <div className={styles.mockupPlaceholder}>
                {icon}
                <span>{title}</span>
            </div>
        </div>
    </div>
);

export default LandingPage;
