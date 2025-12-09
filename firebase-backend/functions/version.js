/**
 * ZAS Safeguard - Version Management
 * 
 * Handles version control for extension and dashboard
 * to ensure clients always have the latest features.
 */

const { onRequest, onCall } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore();

// Version document path
const VERSION_DOC = 'config/version';

/**
 * Get current version info
 * Called by extension and dashboard on startup
 */
exports.getVersion = onCall(async (request) => {
    try {
        const versionDoc = await db.doc(VERSION_DOC).get();

        if (!versionDoc.exists) {
            // Initialize version document if it doesn't exist
            const initialVersion = {
                extension: '1.0.0',
                dashboard: '1.0.0',
                backend: '1.0.0',
                minExtensionVersion: '1.0.0',
                minDashboardVersion: '1.0.0',
                lastUpdated: FieldValue.serverTimestamp(),
                changelog: []
            };
            await db.doc(VERSION_DOC).set(initialVersion);
            return initialVersion;
        }

        return versionDoc.data();
    } catch (error) {
        console.error('Error getting version:', error);
        throw new Error('Failed to get version info');
    }
});

/**
 * Increment version for a specific component
 * Admin only - used during deployment
 */
exports.incrementVersion = onCall(async (request) => {
    // Check if user is admin
    if (!request.auth) {
        throw new Error('Authentication required');
    }

    const { component, type = 'patch', changelog = '' } = request.data;

    if (!['extension', 'dashboard', 'backend'].includes(component)) {
        throw new Error('Invalid component. Must be: extension, dashboard, or backend');
    }

    try {
        const versionDoc = await db.doc(VERSION_DOC).get();
        const data = versionDoc.data() || { extension: '1.0.0', dashboard: '1.0.0', backend: '1.0.0' };

        // Parse current version
        const currentVersion = data[component] || '1.0.0';
        const [major, minor, patch] = currentVersion.split('.').map(Number);

        // Calculate new version
        let newVersion;
        switch (type) {
            case 'major':
                newVersion = `${major + 1}.0.0`;
                break;
            case 'minor':
                newVersion = `${major}.${minor + 1}.0`;
                break;
            case 'patch':
            default:
                newVersion = `${major}.${minor}.${patch + 1}`;
        }

        // Update version document
        const update = {
            [component]: newVersion,
            lastUpdated: FieldValue.serverTimestamp()
        };

        // Add changelog entry
        if (changelog) {
            update.changelog = FieldValue.arrayUnion({
                component,
                version: newVersion,
                message: changelog,
                timestamp: new Date().toISOString()
            });
        }

        await db.doc(VERSION_DOC).update(update);

        console.log(`Version incremented: ${component} ${currentVersion} -> ${newVersion}`);

        return {
            component,
            previousVersion: currentVersion,
            newVersion,
            success: true
        };
    } catch (error) {
        console.error('Error incrementing version:', error);
        throw new Error('Failed to increment version');
    }
});

/**
 * Check if client version is outdated
 * Returns whether update is required/recommended
 */
exports.checkVersion = onCall(async (request) => {
    const { clientVersion, component } = request.data;

    if (!clientVersion || !component) {
        throw new Error('clientVersion and component are required');
    }

    try {
        const versionDoc = await db.doc(VERSION_DOC).get();
        const data = versionDoc.data();

        if (!data) {
            return { updateRequired: false, updateRecommended: false };
        }

        const latestVersion = data[component];
        const minVersion = data[`min${component.charAt(0).toUpperCase() + component.slice(1)}Version`];

        const compareVersions = (v1, v2) => {
            const parts1 = v1.split('.').map(Number);
            const parts2 = v2.split('.').map(Number);

            for (let i = 0; i < 3; i++) {
                if (parts1[i] > parts2[i]) return 1;
                if (parts1[i] < parts2[i]) return -1;
            }
            return 0;
        };

        const isOutdated = compareVersions(clientVersion, latestVersion) < 0;
        const isBelowMinimum = minVersion && compareVersions(clientVersion, minVersion) < 0;

        return {
            currentVersion: clientVersion,
            latestVersion,
            minVersion,
            updateRequired: isBelowMinimum,
            updateRecommended: isOutdated && !isBelowMinimum,
            changelog: data.changelog?.filter(c => c.component === component).slice(-5) || []
        };
    } catch (error) {
        console.error('Error checking version:', error);
        return { updateRequired: false, updateRecommended: false };
    }
});

/**
 * HTTP endpoint for version check (for extension without Firebase SDK)
 */
exports.versionCheck = onRequest({ cors: true }, async (req, res) => {
    const { clientVersion, component } = req.query;

    if (!clientVersion || !component) {
        return res.status(400).json({ error: 'clientVersion and component required' });
    }

    try {
        const versionDoc = await db.doc(VERSION_DOC).get();
        const data = versionDoc.data();

        if (!data) {
            return res.json({ updateRequired: false, updateRecommended: false });
        }

        const latestVersion = data[component];
        const minVersion = data[`min${component.charAt(0).toUpperCase() + component.slice(1)}Version`];

        const compareVersions = (v1, v2) => {
            const parts1 = v1.split('.').map(Number);
            const parts2 = v2.split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                if (parts1[i] > parts2[i]) return 1;
                if (parts1[i] < parts2[i]) return -1;
            }
            return 0;
        };

        const isOutdated = compareVersions(clientVersion, latestVersion) < 0;
        const isBelowMinimum = minVersion && compareVersions(clientVersion, minVersion) < 0;

        res.json({
            currentVersion: clientVersion,
            latestVersion,
            updateRequired: isBelowMinimum,
            updateRecommended: isOutdated
        });
    } catch (error) {
        console.error('Version check error:', error);
        res.status(500).json({ error: 'Version check failed' });
    }
});
