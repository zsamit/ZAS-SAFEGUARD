// Firebase Configuration for ZAS Safeguard Web App
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase Configuration (same as existing public/app.js)
const firebaseConfig = {
    apiKey: "AIzaSyCp48nYcR_QFoxfACqCP13ML7TeICiC6t0",
    authDomain: "zas-safeguard.firebaseapp.com",
    projectId: "zas-safeguard",
    storageBucket: "zas-safeguard.firebasestorage.app",
    messagingSenderId: "559930411646",
    appId: "1:559930411646:web:0377d31d2b8b0d3500a62f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Auth helpers
export const signOut = () => firebaseSignOut(auth);

export { onAuthStateChanged };
export default app;
