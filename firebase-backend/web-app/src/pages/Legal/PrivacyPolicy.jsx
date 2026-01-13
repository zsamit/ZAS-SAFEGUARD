import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import styles from './LegalPage.module.css';

const PrivacyPolicy = () => {
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link to="/" className={styles.backLink}>
                    <ArrowLeft size={20} />
                    Back to Home
                </Link>
            </header>

            <main className={styles.content}>
                <h1>🛡️ Privacy Policy</h1>
                <p className={styles.lastUpdated}>Last Updated: January 4, 2026</p>

                <p>ZAS Global LLC ("we", "our", or "us") operates the ZAS Safeguard browser extension and associated web dashboard. This Privacy Policy explains how we collect, use, and protect your information.</p>

                <div className={styles.highlight}>
                    <strong>Our Commitment:</strong> We collect only the minimum data necessary to provide content blocking and cross-device sync functionality. We do not sell your data to third parties.
                </div>

                <section>
                    <h2>1. Information We Collect</h2>
                    <p><strong>Account Information:</strong></p>
                    <ul>
                        <li>Email address (for authentication)</li>
                        <li>Display name (optional)</li>
                        <li>Hashed master key (SHA-256, never stored in plain text)</li>
                    </ul>

                    <p><strong>Device Information:</strong></p>
                    <ul>
                        <li>Anonymous device identifier (randomly generated)</li>
                        <li>Device type (browser, OS - for display purposes)</li>
                        <li>Last active timestamp</li>
                    </ul>

                    <p><strong>Blocking Activity:</strong></p>
                    <ul>
                        <li>Domains added to your personal blocklist</li>
                        <li>Category preferences (which categories are blocked)</li>
                        <li>Blocked attempt logs (domain and timestamp only)</li>
                        <li>Study mode session history</li>
                    </ul>
                </section>

                <section>
                    <h2>2. Information We Do NOT Collect</h2>
                    <ul>
                        <li>Full browsing history</li>
                        <li>Page content or what you view</li>
                        <li>Personal files or downloads</li>
                        <li>Passwords (except hashed master key)</li>
                        <li>Financial information (handled by Stripe)</li>
                        <li>Location data</li>
                    </ul>
                </section>

                <section>
                    <h2>3. How We Use Your Information</h2>
                    <ul>
                        <li>Sync your blocklist across all your devices</li>
                        <li>Display activity logs in your dashboard</li>
                        <li>Verify master key for unlock requests</li>
                        <li>Send security alerts (tamper attempts)</li>
                        <li>Improve our service and fix bugs</li>
                    </ul>
                </section>

                <section>
                    <h2>4. Data Storage & Security</h2>
                    <p>Your data is stored securely in Google Firebase/Firestore with:</p>
                    <ul>
                        <li>Encryption at rest and in transit</li>
                        <li>Strict Firestore security rules (users can only access their own data)</li>
                        <li>Master keys stored as SHA-256 hashes only</li>
                        <li>Regular security audits</li>
                    </ul>
                </section>

                <section>
                    <h2>5. Third-Party Services</h2>
                    <p>We use the following third-party services:</p>
                    <ul>
                        <li><strong>Google Firebase:</strong> Authentication and database (<a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener noreferrer">Firebase Privacy Policy</a>)</li>
                        <li><strong>Stripe:</strong> Payment processing (<a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe Privacy Policy</a>)</li>
                    </ul>
                    <p>We do not share your personal data with any other third parties.</p>
                </section>

                <section>
                    <h2>6. Data Retention</h2>
                    <ul>
                        <li>Account data: Retained until you delete your account</li>
                        <li>Activity logs: Automatically deleted after 90 days</li>
                        <li>Study mode history: Retained for 1 year</li>
                    </ul>
                </section>

                <section>
                    <h2>7. Your Rights</h2>
                    <p>You have the right to:</p>
                    <ul>
                        <li>Access your data via the dashboard</li>
                        <li>Export your data (contact us)</li>
                        <li>Delete your account and all associated data</li>
                        <li>Opt out of non-essential communications</li>
                    </ul>
                </section>

                <section>
                    <h2>8. Children's Privacy</h2>
                    <p>ZAS Safeguard is designed to help protect children online. Child profiles are managed by parent accounts. We do not knowingly collect personal information directly from children under 13. All child data is controlled by the parent account holder.</p>
                </section>

                <section>
                    <h2>9. Changes to This Policy</h2>
                    <p>We may update this Privacy Policy from time to time. We will notify you of significant changes via email or in-app notification. Continued use of ZAS Safeguard after changes constitutes acceptance of the updated policy.</p>
                </section>

                <section className={styles.contactBox}>
                    <h2>10. Contact Us</h2>
                    <p>If you have questions about this Privacy Policy or your data, please contact us:</p>
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

export default PrivacyPolicy;
