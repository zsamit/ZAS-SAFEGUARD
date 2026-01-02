import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, onAuthStateChanged, signOut } from '../firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

const AuthContext = createContext(null);

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

        return () => unsubscribeAuth();
    }, []);

    // Real-time listener for user profile changes
    useEffect(() => {
        if (!user) return;

        const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (doc) => {
            if (doc.exists()) {
                setUserProfile(doc.data());
            }
        });

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
