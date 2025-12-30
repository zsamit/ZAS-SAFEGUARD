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
        const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                // Load user profile from Firestore
                const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
                if (userDoc.exists()) {
                    setUserProfile(userDoc.data());
                }
            } else {
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
        await signOut();
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
