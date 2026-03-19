/**
 * index.js — ZAS Safeguard OpenClaw skill entry point
 * OpenClaw calls handleCommand(command, args, context) for every zas: message
 */

const { connectAccount, disconnectAccount, getStoredToken } = require('./auth');
const { startFocusMode, stopFocusMode, getFocusStatus, enableInternetLock, disableInternetLock, addToBlocklist, removeFromBlocklist } = require('./protection');
const { scanUrl } = require('./scanner');
const { getStatus, getStats, getDevices, getRecentActivity, getAccountInfo } = require('./stats');

async function handleCommand(command, args, context) {
    const { reply, storage } = context;

    // All commands except connect/disconnect require authentication
    if (command !== 'connect' && command !== 'disconnect') {
        const token = await getStoredToken(storage);
        if (!token) {
            return reply(
                `Connect your ZAS Safeguard account first.\n` +
                `\`zas:connect your@email.com yourpassword\``
            );
        }
    }

    switch (command) {
        case 'connect':    return connectAccount(args, context);
        case 'disconnect': return disconnectAccount(context);
        case 'focus':      return handleFocus(args, context);
        case 'lock':       return enableInternetLock(context);
        case 'unlock':     return disableInternetLock(context);
        case 'block':      return handleBlock(args, context);
        case 'scan':       return scanUrl(args[0], context);
        case 'status':     return getStatus(context);
        case 'stats':      return getStats(context);
        case 'devices':    return getDevices(context);
        case 'activity':   return getRecentActivity(args[0] || 10, context);
        case 'account':    return getAccountInfo(context);
        case 'help':       return showHelp(context);

        default:
            return reply(
                `Unknown command: \`zas:${command}\`\n\n` +
                `Available: focus, lock, unlock, block, scan, status, stats, devices, activity, account, connect\n` +
                `Type \`zas:help\` for details.`
            );
    }
}

async function handleFocus(args, context) {
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'start') {
        const duration = args[1] || '1h';
        return startFocusMode(duration, context);
    }
    if (sub === 'stop') return stopFocusMode(context);
    if (sub === 'status') return getFocusStatus(context);

    // If subcommand looks like a duration (30m, 1h, 2h…), treat as: focus start [duration]
    if (/^\d/.test(sub) || sub === 'midnight' || sub === 'tomorrow') {
        return startFocusMode(sub, context);
    }

    return context.reply(
        `Usage:\n` +
        `\`zas:focus start [30m|1h|2h|4h|midnight]\`\n` +
        `\`zas:focus stop\`\n` +
        `\`zas:focus status\``
    );
}

async function handleBlock(args, context) {
    const action = args[0]?.toLowerCase();
    const domain = args[1];

    if (!action || !domain) {
        return context.reply(
            `Usage:\n` +
            `\`zas:block add example.com\`\n` +
            `\`zas:block remove example.com\``
        );
    }
    if (action === 'add') return addToBlocklist(domain, context);
    if (action === 'remove') return removeFromBlocklist(domain, context);

    return context.reply(`Use \`zas:block add domain\` or \`zas:block remove domain\``);
}

async function showHelp(context) {
    return context.reply(
        `ZAS Safeguard Commands\n` +
        `─────────────────\n` +
        `zas:status          — Protection overview\n` +
        `zas:stats           — Today's blocked counts\n` +
        `zas:devices         — Connected devices\n` +
        `zas:activity [n]    — Last n blocked sites\n` +
        `zas:account         — Subscription info\n` +
        `─────────────────\n` +
        `zas:scan [url]      — Scan a URL for threats\n` +
        `─────────────────\n` +
        `zas:focus start [duration] — Start Focus Mode\n` +
        `zas:focus stop      — Stop Focus Mode\n` +
        `zas:focus status    — Time remaining\n` +
        `zas:lock            — Enable Internet Lock\n` +
        `zas:unlock          — Disable Internet Lock\n` +
        `zas:block add [domain]    — Block a domain\n` +
        `zas:block remove [domain] — Unblock a domain\n` +
        `─────────────────\n` +
        `zas:connect email password — Link your account\n` +
        `zas:disconnect      — Unlink account`
    );
}

module.exports = { handleCommand };
