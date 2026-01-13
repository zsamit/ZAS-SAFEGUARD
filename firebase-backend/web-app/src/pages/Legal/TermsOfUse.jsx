import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import styles from './LegalPage.module.css';

const TermsOfUse = () => {
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link to="/" className={styles.backLink}>
                    <ArrowLeft size={20} />
                    Back to Home
                </Link>
            </header>

            <main className={styles.content}>
                <h1>📜 Terms of Service</h1>
                <p className={styles.lastUpdated}>Last Updated: January 4, 2026</p>

                <div className={styles.highlight}>
                    <strong>Summary:</strong> By using ZAS Safeguard, you agree to use it lawfully for personal protection. We provide the service "as is" and are not liable for any damages.
                </div>

                <section>
                    <h2>1. Acceptance of Terms</h2>
                    <p>By installing and using ZAS Safeguard ("the Extension"), you agree to be bound by these Terms of Service. If you do not agree, please uninstall the Extension immediately.</p>
                </section>

                <section>
                    <h2>2. Description of Service</h2>
                    <p>ZAS Safeguard is a browser extension that provides:</p>
                    <ul>
                        <li>Content blocking (adult, gambling, harmful sites)</li>
                        <li>Ad and tracker blocking</li>
                        <li>Malware and phishing URL scanning</li>
                        <li>Study/Focus mode</li>
                        <li>Parental monitoring features</li>
                        <li>Cross-device sync via cloud dashboard</li>
                    </ul>
                </section>

                <section>
                    <h2>3. User Responsibilities</h2>
                    <p>You agree to:</p>
                    <ul>
                        <li>Use the Extension lawfully and in compliance with all applicable laws</li>
                        <li>Not attempt to circumvent, disable, or tamper with the Extension's protection features</li>
                        <li>Keep your account credentials secure</li>
                        <li>Only use parental monitoring features for children under your legal guardianship</li>
                    </ul>
                </section>

                <section>
                    <h2>4. Age Requirements</h2>
                    <p>You must be at least 13 years old to use ZAS Safeguard. Users under 18 should have parental consent. Parent accounts may manage child profiles.</p>
                </section>

                <section>
                    <h2>5. Subscription and Payments</h2>
                    <ul>
                        <li>Free features are available without payment</li>
                        <li>Pro features require a paid subscription</li>
                        <li>Payments are processed securely by Stripe</li>
                        <li>Subscriptions auto-renew unless cancelled</li>
                        <li>Refunds are handled on a case-by-case basis</li>
                    </ul>
                </section>

                <section>
                    <h2>6. Intellectual Property</h2>
                    <p>ZAS Safeguard and all associated trademarks, logos, and content are owned by ZAS Global LLC. You may not copy, modify, or distribute the Extension without permission.</p>
                </section>

                <section>
                    <h2>7. Disclaimer of Warranties</h2>
                    <p>THE EXTENSION IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. We do not guarantee that:</p>
                    <ul>
                        <li>The Extension will block all harmful content</li>
                        <li>URL scanning will detect all threats</li>
                        <li>The service will be uninterrupted or error-free</li>
                    </ul>
                </section>

                <section>
                    <h2>8. Limitation of Liability</h2>
                    <p>ZAS Global LLC shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Extension, including but not limited to exposure to harmful content or data loss.</p>
                </section>

                <section>
                    <h2>9. Termination</h2>
                    <p>We may terminate or suspend your access at any time for violation of these Terms. You may stop using the Extension at any time by uninstalling it.</p>
                </section>

                <section>
                    <h2>10. Changes to Terms</h2>
                    <p>We may update these Terms from time to time. Continued use after changes constitutes acceptance of the new Terms.</p>
                </section>

                <section>
                    <h2>11. Governing Law</h2>
                    <p>These Terms are governed by the laws of the State of California, United States.</p>
                </section>

                <section className={styles.contactBox}>
                    <h2>12. Contact</h2>
                    <p>For questions about these Terms, contact us:</p>
                    <p>
                        <strong>ZAS Global LLC</strong><br />
                        Email: <a href="mailto:info@zasgloballlc.com">info@zasgloballlc.com</a><br />
                        Website: <a href="https://zasgloballlc.com">zasgloballlc.com</a>
                    </p>
                </section>
            </main>

            <footer className={styles.footer}>
                <p>© 2026 ZAS Safeguard. All rights reserved.</p>
            </footer>
        </div>
    );
};

export default TermsOfUse;
