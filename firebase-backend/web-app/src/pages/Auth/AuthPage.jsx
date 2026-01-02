import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithRedirect,
    getRedirectResult,
    onAuthStateChanged
} from 'firebase/auth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import Logo from '../../components/Logo';
import { Mail, Lock, Loader, AlertCircle } from 'lucide-react';
import styles from './AuthPage.module.css';

const AuthPage = () => {
    const navigate = useNavigate();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [checkingAuth, setCheckingAuth] = useState(true);

    // Check if already logged in
    useEffect(() => {
        // Set a timeout in case Firebase auth takes too long
        const timeout = setTimeout(() => {
            console.log('Auth check timeout - showing login form');
            setCheckingAuth(false);
        }, 1000);

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            clearTimeout(timeout);
            if (user) {
                // Already logged in, redirect to dashboard
                navigate('/app/dashboard', { replace: true });
            }
            setCheckingAuth(false);
        });

        return () => {
            clearTimeout(timeout);
            unsubscribe();
        };
    }, [navigate]);

    const handleEmailAuth = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        console.log('[Auth] Starting auth flow, isLogin:', isLogin);

        try {
            if (isLogin) {
                console.log('[Auth] Signing in with:', email);
                await signInWithEmailAndPassword(auth, email, password);
                console.log('[Auth] Sign in successful');
            } else {
                if (password !== confirmPassword) {
                    setError('Passwords do not match');
                    setLoading(false);
                    return;
                }
                if (password.length < 6) {
                    setError('Password must be at least 6 characters');
                    setLoading(false);
                    return;
                }
                console.log('[Auth] Creating account for:', email);
                await createUserWithEmailAndPassword(auth, email, password);
                console.log('[Auth] Account created successfully');
            }
            console.log('[Auth] Navigating to dashboard');
            navigate('/app/dashboard', { replace: true });
        } catch (err) {
            console.error('[Auth] Error:', err.code, err.message);
            switch (err.code) {
                case 'auth/user-not-found':
                    setError('No account found with this email');
                    break;
                case 'auth/wrong-password':
                    setError('Incorrect password');
                    break;
                case 'auth/email-already-in-use':
                    setError('Email already registered. Try logging in.');
                    break;
                case 'auth/invalid-email':
                    setError('Invalid email address');
                    break;
                case 'auth/weak-password':
                    setError('Password is too weak');
                    break;
                default:
                    setError(err.message || 'Authentication failed');
            }
        } finally {
            console.log('[Auth] Finished, clearing loading state');
            setLoading(false);
        }
    };

    const handleGoogleAuth = async () => {
        setError('');
        setLoading(true);
        try {
            const provider = new GoogleAuthProvider();
            // Use redirect instead of popup to avoid COOP blocking
            await signInWithRedirect(auth, provider);
            // User will be redirected to Google, then back to this page
            // The useEffect with onAuthStateChanged will handle the redirect result
        } catch (err) {
            console.error('Google auth error:', err);
            setError('Google sign-in failed. Try again.');
            setLoading(false);
        }
    };

    if (checkingAuth) {
        return (
            <div className={styles.page}>
                <div className={styles.loading}>
                    <Loader size={32} className={styles.spinner} />
                    <span>Checking authentication...</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <Logo size="lg" variant="dark" linkTo="/" />
                    <h1>{isLogin ? 'Welcome Back' : 'Create Account'}</h1>
                    <p>{isLogin ? 'Sign in to access your dashboard' : 'Start protecting your family today'}</p>
                </div>

                <Card className={styles.authCard}>
                    {error && (
                        <div className={styles.error}>
                            <AlertCircle size={16} />
                            <span>{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleEmailAuth} className={styles.form}>
                        <Input
                            type="email"
                            label="Email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            icon={Mail}
                            required
                        />
                        <Input
                            type="password"
                            label="Password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            icon={Lock}
                            required
                        />
                        {!isLogin && (
                            <Input
                                type="password"
                                label="Confirm Password"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                icon={Lock}
                                required
                            />
                        )}
                        <Button type="submit" fullWidth disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader size={16} className={styles.spinner} />
                                    {isLogin ? 'Signing in...' : 'Creating account...'}
                                </>
                            ) : (
                                isLogin ? 'Sign In' : 'Create Account'
                            )}
                        </Button>
                    </form>

                    <div className={styles.divider}>
                        <span>or</span>
                    </div>

                    <Button
                        variant="secondary"
                        fullWidth
                        onClick={handleGoogleAuth}
                        disabled={loading}
                        className={styles.googleBtn}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Continue with Google
                    </Button>
                </Card>

                <p className={styles.switchMode}>
                    {isLogin ? (
                        <>
                            Don't have an account?{' '}
                            <button onClick={() => { setIsLogin(false); setError(''); }}>
                                Sign up
                            </button>
                        </>
                    ) : (
                        <>
                            Already have an account?{' '}
                            <button onClick={() => { setIsLogin(true); setError(''); }}>
                                Sign in
                            </button>
                        </>
                    )}
                </p>
            </div>
        </div>
    );
};

export default AuthPage;
