/**
 * scanner.js — URL threat scanning
 * Calls the live /checkUrlReputation Cloud Function
 */

const { refreshTokenIfNeeded } = require('./auth');

const FUNCTIONS_BASE = 'https://us-central1-zas-safeguard.cloudfunctions.net';

/**
 * zas:scan [url] — Scan a URL for malware, phishing, adult content
 */
async function scanUrl(url, context) {
    const { reply, storage } = context;

    if (!url) {
        return reply(
            `Provide a URL to scan.\n` +
            `Example: \`zas:scan https://example.com\``
        );
    }

    // Normalize — add https:// if missing
    let target = url.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
        target = 'https://' + target;
    }

    // Validate format
    let parsed;
    try {
        parsed = new URL(target);
    } catch {
        return reply(`"${url}" doesn't look like a valid URL. Try: \`zas:scan https://example.com\``);
    }

    const domain = parsed.hostname;

    try {
        const auth = await refreshTokenIfNeeded(storage);
        if (!auth) return reply(`Session expired. Reconnect with \`zas:connect email password\``);

        const res = await fetch(`${FUNCTIONS_BASE}/checkUrlReputation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.idToken}`
            },
            body: JSON.stringify({ url: target, userId: auth.uid })
        });

        const data = await res.json();

        if (!res.ok) {
            return reply(`Scan failed for ${domain}: ${data.error || data.message || 'Unknown error'}`);
        }

        const scoreStr = data.score != null ? `\nRisk score: ${data.score}/100` : '';
        const catStr = data.category
            ? `\nCategory: ${data.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`
            : '';

        // Safe
        if (data.safe === true && !data.suspicious) {
            return reply(
                `✓ Safe — ${domain}\n` +
                `No threats detected.` +
                catStr +
                scoreStr
            );
        }

        // Suspicious
        if (data.suspicious) {
            return reply(
                `⚠ Suspicious — ${domain}\n` +
                `This site shows suspicious patterns. Proceed with caution.` +
                catStr +
                scoreStr
            );
        }

        // Dangerous
        const catLabel = (data.category || 'threat')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());

        return reply(
            `✗ Dangerous — ${domain}\n` +
            `This site has been identified as: ${catLabel}\n` +
            `Do not visit this site.` +
            scoreStr
        );
    } catch (err) {
        return reply(`Scan failed: ${err.message}`);
    }
}

module.exports = { scanUrl };
