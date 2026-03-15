import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
    const location = useLocation();
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
                // Get redirect URL from sessionStorage (most reliable) or location state
                const storedRedirect = sessionStorage.getItem('redirectAfterLogin');
                const stateFrom = location.state?.from?.pathname
                    ? location.state.from.pathname + (location.state.from.search || '')
                    : null;
                const from = storedRedirect || stateFrom || '/app/dashboard';
                sessionStorage.removeItem('redirectAfterLogin');
                navigate(from, { replace: true });
            }
            setCheckingAuth(false);
        });

        return () => {
            clearTimeout(timeout);
            unsubscribe();
        };
    }, [navigate, location]);

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
            console.log('[Auth] Navigating to destination');
            // Get redirect URL from sessionStorage (most reliable) or location state
            const storedRedirect = sessionStorage.getItem('redirectAfterLogin');
            const stateFrom = location.state?.from?.pathname
                ? location.state.from.pathname + (location.state.from.search || '')
                : null;
            const from = storedRedirect || stateFrom || '/app/dashboard';
            sessionStorage.removeItem('redirectAfterLogin');
            navigate(from, { replace: true });
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
                case 'auth/invalid-credential':
                    setError('Incorrect email or password');
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
