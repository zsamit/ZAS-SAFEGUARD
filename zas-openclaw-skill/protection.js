/**
 * protection.js — Focus Mode, Internet Lock, custom blocklist
 * Writes to Firestore fields the extension polls every ~10 seconds
 */

const { refreshTokenIfNeeded } = require('./auth');

const FUNCTIONS_BASE = 'https://us-central1-zas-safeguard.cloudfunctions.net';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/zas-safeguard/databases/(default)/documents';

// ─── Firestore write helpers ──────────────────────────────────────────────────

/** Convert a plain JS value to Firestore REST typed format */
function toFs(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
        return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    }
    if (typeof val === 'string') return { stringValue: val };
    if (Array.isArray(val)) return { arrayValue: { values: val.map(toFs) } };
    if (typeof val === 'object') {
        return {
            mapValue: {
                fields: Object.fromEntries(Object.entries(val).map(([k, v]) => [k, toFs(v)]))
            }
        };
    }
    return { stringValue: String(val) };
}

/**
 * PATCH specific fields on a Firestore document.
 * Only the listed fields are overwritten — others are untouched.
 */
async function firestorePatch(docPath, fields, idToken) {
    const maskParams = Object.keys(fields)
        .map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
        .join('&');

    const res = await fetch(`${FIRESTORE_BASE}/${docPath}?${maskParams}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Firestore write failed (${res.status})`);
    }
    return res.json();
}

/** Read raw Firestore fields for a document */
async function firestoreGetRaw(path, idToken) {
    const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (res.status === 404) return { fields: {} };
    if (!res.ok) throw new Error(`Firestore read failed (${res.status})`);
    return res.json();
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

function parseDuration(str) {
    if (!str) return 60 * 60 * 1000; // default 1h
    const s = String(str).toLowerCase().trim();

    if (s === 'midnight') {
        const mid = new Date(); mid.setHours(24, 0, 0, 0); return mid - Date.now();
    }
    if (s === 'tomorrow') {
        const tom = new Date(); tom.setDate(tom.getDate() + 1); tom.setHours(24, 0, 0, 0); return tom - Date.now();
    }

    const m = s.match(/^(\d+)m$/);  if (m) return parseInt(m[1]) * 60 * 1000;
    const h = s.match(/^(\d+)h$/);  if (h) return parseInt(h[1]) * 60 * 60 * 1000;
    if (s === '30') return 30 * 60 * 1000;
    if (s === '1' || s === '1h') return 60 * 60 * 1000;
    if (s === '2' || s === '2h') return 2 * 60 * 60 * 1000;
    if (s === '4' || s === '4h') return 4 * 60 * 60 * 1000;

    return 60 * 60 * 1000; // fallback 1h
}

function formatDuration(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} minutes`;
    const hrs = Math.round(mins / 60);
    return hrs === 1 ? '1 hour' : `${hrs} hours`;
}

// ─── Focus Mode ───────────────────────────────────────────────────────────────

const FOCUS_CATEGORIES = ['social_media', 'gaming', 'youtube', 'reddit'];

/**
 * zas:focus start [duration] — Start Focus Mode
 */
async function startFocusMode(duration, context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const ms = parseDuration(duration);
        const now = new Date();
        const endTime = new Date(now.getTime() + ms);

        const session = {
            startTime: now.toISOString(),
            endTime: endTime.toISOString(),
            blockCategories: FOCUS_CATEGORIES,
            duration: Math.round(ms / 60000)
        };

        await firestorePatch(`users/${auth.uid}`, {
            activeStudySession: toFs(session),
            studyMode: toFs(true),
            studyBlockCategories: toFs(FOCUS_CATEGORIES)
        }, auth.idToken);

        const endStr = endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return reply(
            `Focus Mode started ✓\n` +
            `Duration: ${formatDuration(ms)}\n` +
            `Ends at: ${endStr}\n` +
            `Blocking: Social media, gaming, YouTube, Reddit\n\n` +
            `Your devices will apply this within 10 seconds.\n` +
            `Type \`zas:focus stop\` to end early.`
        );
    } catch (err) {
        return reply(`Failed to start Focus Mode: ${err.message}`);
    }
}

/**
 * zas:focus stop — Stop Focus Mode
 */
async function stopFocusMode(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        await firestorePatch(`users/${auth.uid}`, {
            studyMode: toFs(false),
            activeStudySession: toFs(null)
        }, auth.idToken);

        return reply(
            `Focus Mode stopped ✓\n` +
            `All sites are accessible again.\n` +
            `Changes apply to your devices within 10 seconds.`
        );
    } catch (err) {
        return reply(`Failed to stop Focus Mode: ${err.message}`);
    }
}

/**
 * zas:focus status — Check if Focus Mode is active and time remaining
 */
async function getFocusStatus(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const doc = await firestoreGetRaw(`users/${auth.uid}`, auth.idToken);
        const fields = doc.fields || {};
        const sessionFields = fields.activeStudySession?.mapValue?.fields;
        const studyMode = fields.studyMode?.booleanValue;

        if (!sessionFields || !studyMode) {
            return reply(`Focus Mode is Off.\nType \`zas:focus start\` to begin a session.`);
        }

        const endTime = sessionFields.endTime?.stringValue
            ? new Date(sessionFields.endTime.stringValue)
            : null;

        if (!endTime || endTime < new Date()) {
            return reply(`Focus Mode session has ended.\nType \`zas:focus start\` to start a new one.`);
        }

        const minsLeft = Math.ceil((endTime - Date.now()) / 60000);
        const timeStr = minsLeft >= 60
            ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
            : `${minsLeft} minutes`;

        const cats = (sessionFields.blockCategories?.arrayValue?.values || [])
            .map(v => v.stringValue)
            .map(s => s.replace(/_/g, ' '))
            .join(', ');

        return reply(
            `Focus Mode: On\n` +
            `Time remaining: ${timeStr}\n` +
            `Blocking: ${cats || 'social media, gaming, YouTube, Reddit'}`
        );
    } catch (err) {
        return reply(`Failed to get Focus Mode status: ${err.message}`);
    }
}

// ─── Internet Lock ────────────────────────────────────────────────────────────

/**
 * zas:lock — Block everything except essential sites
 */
async function enableInternetLock(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        await firestorePatch(`users/${auth.uid}`, {
            internetLockActive: toFs(true)
        }, auth.idToken);

        return reply(
            `Internet Lock enabled ✓\n` +
            `Only essential sites are accessible on your connected devices.\n` +
            `Changes apply within 10 seconds.\n\n` +
            `Type \`zas:unlock\` to restore normal access.`
        );
    } catch (err) {
        return reply(`Failed to enable Internet Lock: ${err.message}`);
    }
}

/**
 * zas:unlock — Restore normal internet access
 */
async function disableInternetLock(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        await firestorePatch(`users/${auth.uid}`, {
            internetLockActive: toFs(false)
        }, auth.idToken);

        return reply(
            `Internet Lock disabled ✓\n` +
            `Normal browsing resumed on all connected devices.\n` +
            `Changes apply within 10 seconds.`
        );
    } catch (err) {
        return reply(`Failed to disable Internet Lock: ${err.message}`);
    }
}

// ─── Custom blocklist ─────────────────────────────────────────────────────────

/**
 * zas:block add [domain] — Add to personal blocklist
 */
async function addToBlocklist(domain, context) {
    const { reply, storage } = context;
    const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const res = await fetch(`${FUNCTIONS_BASE}/updateCustomBlocklist`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.idToken}`
            },
            body: JSON.stringify({ userId: auth.uid, action: 'add', domain: cleanDomain })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return reply(`Failed to block ${cleanDomain}: ${err.error || err.message || 'Unknown error'}`);
        }

        return reply(
            `${cleanDomain} added to your blocklist ✓\n` +
            `It will be blocked on all your devices immediately.`
        );
    } catch (err) {
        return reply(`Failed to add to blocklist: ${err.message}`);
    }
}

/**
 * zas:block remove [domain] — Remove from personal blocklist
 */
async function removeFromBlocklist(domain, context) {
    const { reply, storage } = context;
    const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const res = await fetch(`${FUNCTIONS_BASE}/updateCustomBlocklist`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.idToken}`
            },
            body: JSON.stringify({ userId: auth.uid, action: 'remove', domain: cleanDomain })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return reply(`Failed to unblock ${cleanDomain}: ${err.error || err.message || 'Unknown error'}`);
        }

        return reply(`${cleanDomain} removed from your blocklist ✓`);
    } catch (err) {
        return reply(`Failed to remove from blocklist: ${err.message}`);
    }
}

module.exports = {
    startFocusMode, stopFocusMode, getFocusStatus,
    enableInternetLock, disableInternetLock,
    addToBlocklist, removeFromBlocklist
};
