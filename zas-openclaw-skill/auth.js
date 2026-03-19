/**
 * auth.js — ZAS Safeguard account connection and token management
 * Uses Firebase email/password sign-in for v1 (simple, no OAuth needed)
 */

const FIREBASE_API_KEY = 'AIzaSyCp48nYcR_QFoxfACqCP13ML7TeICiC6t0';
const SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const STORAGE_KEY = 'zas_auth';

/**
 * Connect a ZAS account using email + password.
 * Usage: zas:connect email@example.com yourpassword
 */
async function connectAccount(args, context) {
    const { reply, storage } = context;

    // Already connected?
    const existing = await storage.get(STORAGE_KEY);
    if (existing && args.length === 0) {
        return reply(
            `Already connected as ${existing.email}.\n` +
            `Type \`zas:status\` to see your protection, or \`zas:disconnect\` to remove this account.`
        );
    }

    const [email, password] = args;

    if (!email || !password) {
        return reply(
            `To connect your ZAS Safeguard account:\n` +
            `\`zas:connect your@email.com yourpassword\`\n\n` +
            `Your password is used once to get a secure token — it is not stored.`
        );
    }

    try {
        const res = await fetch(SIGN_IN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });

        const data = await res.json();

        if (!res.ok) {
            const msg = data.error?.message || 'Sign in failed';
            if (msg === 'EMAIL_NOT_FOUND' || msg === 'INVALID_PASSWORD' || msg === 'INVALID_LOGIN_CREDENTIALS') {
                return reply(`Wrong email or password. Check your ZAS Safeguard credentials and try again.`);
            }
            if (msg === 'USER_DISABLED') {
                return reply(`This account has been disabled. Contact support at info@zasgloballlc.com`);
            }
            if (msg === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
                return reply(`Too many failed attempts. Please wait a few minutes and try again.`);
            }
            return reply(`Sign in failed: ${msg}`);
        }

        const auth = {
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            uid: data.localId,
            email: data.email,
            // Expire 1 minute early to avoid edge-case failures
            expiresAt: Date.now() + (parseInt(data.expiresIn) * 1000) - 60000
        };

        await storage.set(STORAGE_KEY, auth);

        return reply(
            `Connected to ZAS Safeguard ✓\n` +
            `Account: ${auth.email}\n\n` +
            `Type \`zas:status\` to see your protection status.`
        );
    } catch (err) {
        return reply(`Connection failed: ${err.message}. Please try again.`);
    }
}

/**
 * Remove stored ZAS credentials from this agent.
 */
async function disconnectAccount(context) {
    const { reply, storage } = context;
    await storage.delete(STORAGE_KEY);
    return reply(
        `ZAS Safeguard account disconnected.\n` +
        `Your protection settings on your devices are unchanged.\n` +
        `Type \`zas:connect\` to reconnect.`
    );
}

/**
 * Get stored auth object (does NOT refresh).
 * Returns null if not connected.
 */
async function getStoredToken(storage) {
    return await storage.get(STORAGE_KEY);
}

/**
 * Get auth object, refreshing the ID token if it has expired.
 * Returns null if not connected or refresh fails (forces reconnect).
 */
async function refreshTokenIfNeeded(storage) {
    const auth = await storage.get(STORAGE_KEY);
    if (!auth) return null;

    // Still valid
    if (Date.now() < auth.expiresAt) return auth;

    // Needs refresh
    try {
        const res = await fetch(REFRESH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: auth.refreshToken })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Token refresh failed');

        const updated = {
            ...auth,
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (parseInt(data.expires_in) * 1000) - 60000
        };

        await storage.set(STORAGE_KEY, updated);
        return updated;
    } catch (err) {
        // Refresh failed — clear credentials, force reconnect
        await storage.delete(STORAGE_KEY);
        return null;
    }
}

module.exports = { connectAccount, disconnectAccount, getStoredToken, refreshTokenIfNeeded };
