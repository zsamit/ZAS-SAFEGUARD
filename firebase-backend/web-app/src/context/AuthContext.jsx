import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, onAuthStateChanged, signOut } from '../firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { sendMessageToExtension } from '../hooks/useExtension';

const AuthContext = createContext(null);

/**
 * Sync auth state to extension - sends LOGIN message with token and userId
 * This triggers device registration in the extension
 */
const syncAuthToExtension = async (firebaseUser) => {
    try {
        if (!firebaseUser) {
            console.log('[AuthContext] No user - sending LOGOUT to extension');
            sendMessageToExtension({ type: 'LOGOUT' });
            return;
        }

        // Get the ID token
        const token = await firebaseUser.getIdToken();

        console.log('[AuthContext] Sending LOGIN to extension for user:', firebaseUser.uid);
        const response = await sendMessageToExtension({
            type: 'LOGIN',
            token: token,
            userId: firebaseUser.uid,
            email: firebaseUser.email
        });

        if (response?.success) {
            console.log('[AuthContext] Extension auth sync successful');
        } else {
            console.log('[AuthContext] Extension auth sync - no response (extension may not be installed)');
        }
    } catch (error) {
        console.error('[AuthContext] Error syncing auth to extension:', error);
    }
};


export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        console.log('[AuthContext] Setting up auth listener');

        const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
            console.log('[AuthContext] Auth state changed:', firebaseUser ? `UID: ${firebaseUser.uid}` : 'No user');

            if (firebaseUser) {
                setUser(firebaseUser);
                // Load user profile from Firestore
                try {
                    console.log('[AuthContext] Fetching user profile from Firestore...');
                    const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
                    if (userDoc.exists()) {
                        console.log('[AuthContext] User profile loaded:', userDoc.data());
                        setUserProfile(userDoc.data());
                    } else {
                        console.warn('[AuthContext] No user profile found in Firestore');
                    }

                    // Sync auth to extension - triggers device registration
                    syncAuthToExtension(firebaseUser);

                } catch (error) {
                    console.error('[AuthContext] Error loading user profile:', error);
                }
            } else {
                console.log('[AuthContext] No user - clearing state');
                setUser(null);
                setUserProfile(null);
            }
            setLoading(false);
        });

        // L-02: Listen for token refreshes (Firebase auto-refreshes ~every 55 min)
        // Re-sync fresh token to extension on every refresh so it never goes stale
        const unsubscribeToken = auth.onIdTokenChanged(async (firebaseUser) => {
            if (firebaseUser) {
                try {
                    const freshToken = await firebaseUser.getIdToken();
                    console.log('[AuthContext] Token refreshed, re-syncing to extension');
                    sendMessageToExtension({
                        type: 'LOGIN',
                        token: freshToken,
                        userId: firebaseUser.uid,
                        email: firebaseUser.email
                    });
                } catch (e) {
                    console.warn('[AuthContext] Token refresh sync failed:', e.message);
                }
            }
        });

        return () => {
            unsubscribeAuth();
            unsubscribeToken();
        };
    }, []);

    // Real-time listener for user profile changes
    useEffect(() => {
        if (!user) return;

        const unsubscribe = onSnapshot(
            doc(db, 'users', user.uid),
            (doc) => {
                if (doc.exists()) {
                    setUserProfile(doc.data());
                }
            },
            (error) => {
                console.error('[AuthContext] Profile listener error:', error.message);
            }
        );

        return () => unsubscribe();
    }, [user]);

    const logout = async () => {
        try {
            await signOut();
            setUser(null);
            setUserProfile(null);
            window.location.href = '/';
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            userProfile,
            loading,
            logout,
            isAuthenticated: !!user
        }}>
            {children}
        </AuthContext.Provider>
    );
};
