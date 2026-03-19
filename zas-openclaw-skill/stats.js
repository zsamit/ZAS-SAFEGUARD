/**
 * stats.js — Status, stats, devices, activity, account info
 * Reads from Firestore REST API using the user's ID token
 */

const { refreshTokenIfNeeded } = require('./auth');

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/zas-safeguard/databases/(default)/documents';
const QUERY_URL = 'https://firestore.googleapis.com/v1/projects/zas-safeguard/databases/(default)/documents:runQuery';

// ─── Firestore REST helpers ───────────────────────────────────────────────────

/** Convert a Firestore typed value to a plain JS value */
function fsValue(val) {
    if (!val) return null;
    if ('stringValue' in val) return val.stringValue;
    if ('integerValue' in val) return parseInt(val.integerValue);
    if ('doubleValue' in val) return val.doubleValue;
    if ('booleanValue' in val) return val.booleanValue;
    if ('nullValue' in val) return null;
    if ('timestampValue' in val) return new Date(val.timestampValue);
    if ('mapValue' in val) return fsDoc(val.mapValue.fields || {});
    if ('arrayValue' in val) return (val.arrayValue.values || []).map(fsValue);
    return null;
}

/** Convert a Firestore fields object to a plain JS object */
function fsDoc(fields) {
    const obj = {};
    for (const [k, v] of Object.entries(fields || {})) {
        obj[k] = fsValue(v);
    }
    return obj;
}

/** GET a single Firestore document */
async function firestoreGet(path, idToken) {
    const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`Firestore read failed (${res.status})`);
    const data = await res.json();
    return fsDoc(data.fields || {});
}

/** Human-readable relative time */
function timeAgo(date) {
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * zas:status — Overall protection status
 */
async function getStatus(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const user = await firestoreGet(`users/${auth.uid}`, auth.idToken);
        const sub = user.subscription || {};

        // Plan label
        const plan = sub.plan || 'free';
        const planLabel = { pro: 'Pro', essential: 'Essential' }[plan] || 'Free';
        const trialEnd = sub.trial_end ? new Date(sub.trial_end) : null;
        const trialDays = trialEnd ? Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000)) : 0;
        let planLine = `Plan: ${planLabel}`;
        if (trialDays > 0) planLine += ` (Trial — ${trialDays}d left)`;

        // Active features
        const session = user.activeStudySession;
        const focusActive = !!(session?.endTime && new Date(session.endTime) > new Date());
        const lockActive = !!user.internetLockActive;

        let focusLine = 'Off';
        if (focusActive && session.endTime) {
            const mins = Math.ceil((new Date(session.endTime) - Date.now()) / 60000);
            focusLine = mins >= 60 ? `On — ${Math.ceil(mins / 60)}h remaining` : `On — ${mins}m remaining`;
        }

        return reply(
            `ZAS Safeguard Status\n` +
            `─────────────────\n` +
            `${planLine}\n` +
            `Protection: Active\n` +
            `Focus Mode: ${focusLine}\n` +
            `Internet Lock: ${lockActive ? 'On' : 'Off'}\n\n` +
            `\`zas:stats\` for today's numbers  •  \`zas:devices\` for connected devices`
        );
    } catch (err) {
        return reply(`Failed to get status: ${err.message}`);
    }
}

/**
 * zas:stats — Today's blocked counts
 */
async function getStats(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const res = await fetch(QUERY_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${auth.idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: 'logs' }],
                    where: {
                        compositeFilter: {
                            op: 'AND',
                            filters: [
                                {
                                    fieldFilter: {
                                        field: { fieldPath: 'userId' },
                                        op: 'EQUAL',
                                        value: { stringValue: auth.uid }
                                    }
                                },
                                {
                                    fieldFilter: {
                                        field: { fieldPath: 'timestamp' },
                                        op: 'GREATER_THAN_OR_EQUAL',
                                        value: { timestampValue: todayStart.toISOString() }
                                    }
                                }
                            ]
                        }
                    },
                    orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
                    limit: 500
                }
            })
        });

        const data = await res.json();
        const logs = data.filter(d => d.document).map(d => fsDoc(d.document.fields || {}));

        let sitesBlocked = 0, adsBlocked = 0, trackersBlocked = 0;
        for (const log of logs) {
            const action = log.action || log.type || '';
            const count = typeof log.count === 'number' ? Math.min(log.count, 10000) : 1;
            if (action === 'ad_blocked') adsBlocked += count;
            else if (action === 'tracker_blocked') trackersBlocked += count;
            else sitesBlocked += count;
        }

        return reply(
            `Today's Stats\n` +
            `─────────────────\n` +
            `Sites blocked: ${sitesBlocked.toLocaleString()}\n` +
            `Ads removed: ${adsBlocked.toLocaleString()}\n` +
            `Trackers blocked: ${trackersBlocked.toLocaleString()}`
        );
    } catch (err) {
        return reply(`Failed to get stats: ${err.message}`);
    }
}

/**
 * zas:devices — List connected devices with online status
 */
async function getDevices(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const res = await fetch(`${FIRESTORE_BASE}/users/${auth.uid}/devices`, {
            headers: { 'Authorization': `Bearer ${auth.idToken}` }
        });

        const data = await res.json();
        const devices = (data.documents || []).map(d => fsDoc(d.fields || {}));

        if (devices.length === 0) {
            return reply(
                `No devices registered yet.\n` +
                `Install the ZAS Safeguard extension at zassafeguard.com to add a device.`
            );
        }

        const lines = devices.map(d => {
            const online = d.status === 'online';
            const dot = online ? '●' : '○';
            const when = d.lastSeen ? ` — Last seen ${timeAgo(d.lastSeen)}` : '';
            return `${dot} ${d.name || 'Unknown Device'}${online ? ' — Active now' : when}`;
        });

        const onlineCount = devices.filter(d => d.status === 'online').length;

        return reply(
            `Connected Devices (${onlineCount}/${devices.length} online)\n` +
            `─────────────────\n` +
            lines.join('\n')
        );
    } catch (err) {
        return reply(`Failed to get devices: ${err.message}`);
    }
}

/**
 * zas:activity [count] — Recent blocked sites
 */
async function getRecentActivity(count, context) {
    const { reply, storage } = context;
    const limit = Math.min(parseInt(count) || 10, 50);

    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const res = await fetch(QUERY_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${auth.idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: 'logs' }],
                    where: {
                        fieldFilter: {
                            field: { fieldPath: 'userId' },
                            op: 'EQUAL',
                            value: { stringValue: auth.uid }
                        }
                    },
                    orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
                    limit
                }
            })
        });

        const data = await res.json();
        const logs = data.filter(d => d.document).map(d => fsDoc(d.document.fields || {}));

        if (logs.length === 0) {
            return reply(`No recent activity. ZAS Safeguard is quietly keeping you safe.`);
        }

        const lines = logs.map(log => {
            const when = log.timestamp ? timeAgo(log.timestamp) : '?';
            const url = log.url || 'unknown';
            const domain = url.replace(/^https?:\/\//, '').split('/')[0] || url;
            const cat = (log.category || log.action || log.type || 'blocked')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            return `${when} — ${domain} — ${cat}`;
        });

        return reply(
            `Recent Activity (last ${logs.length})\n` +
            `─────────────────\n` +
            lines.join('\n')
        );
    } catch (err) {
        return reply(`Failed to get activity: ${err.message}`);
    }
}

/**
 * zas:account — Account info and subscription details
 */
async function getAccountInfo(context) {
    const { reply, storage } = context;
    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const user = await firestoreGet(`users/${auth.uid}`, auth.idToken);
        const sub = user.subscription || {};

        const plan = sub.plan || 'free';
        const planLabel = { pro: 'Pro', essential: 'Essential' }[plan] || 'Free';
        const status = sub.plan_status || 'inactive';
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

        const trialEnd = sub.trial_end ? new Date(sub.trial_end) : null;
        let trialLine = '';
        if (trialEnd) {
            const days = Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000));
            trialLine = `\nTrial: ${days > 0 ? `${days} days remaining` : 'Expired'}`;
        }

        const upgradePrompt = plan === 'free'
            ? `\nUpgrade to Pro at zassafeguard.com for Focus Mode, Internet Lock, and advanced stats.`
            : '';

        return reply(
            `ZAS Safeguard Account\n` +
            `─────────────────\n` +
            `Email: ${auth.email}\n` +
            `Plan: ${planLabel}\n` +
            `Status: ${statusLabel}` +
            trialLine +
            upgradePrompt
        );
    } catch (err) {
        return reply(`Failed to get account info: ${err.message}`);
    }
}

module.exports = { getStatus, getStats, getDevices, getRecentActivity, getAccountInfo };
