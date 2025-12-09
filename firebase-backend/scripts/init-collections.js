/**
 * ZAS Safeguard - Firestore Collections Initialization Script
 * 
 * This script initializes all required Firestore collections with:
 * - Default documents
 * - Seed data for blocklists
 * - Regional pricing configuration
 * - Owner ultra-strict profile template
 * 
 * Usage: node init-collections.js
 * 
 * Prerequisites:
 * - Set GOOGLE_APPLICATION_CREDENTIALS environment variable to service account path
 * - Or run with Firebase CLI: firebase emulators:exec "node scripts/init-collections.js"
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
}

const db = admin.firestore();

// Default adult/porn domains to seed (sample - expand for production)
const PORN_BLOCKLIST = [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com',
    'youporn.com', 'tube8.com', 'spankbang.com', 'xxxvideos.com', 'porn.com',
    'brazzers.com', 'bangbros.com', 'realitykings.com', 'naughtyamerica.com',
    'pornmd.com', 'beeg.com', 'porn300.com', 'eporner.com', 'tnaflix.com',
    'drtuber.com', 'porntrex.com', 'hqporner.com', 'pornone.com', 'txxx.com',
    'vporn.com', 'youjizz.com', 'porntube.com', 'xtube.com', 'empflix.com',
    'extremetube.com', 'sunporno.com', 'porndig.com', 'nudevista.com',
    // Add thousands more for production
];

const GAMBLING_BLOCKLIST = [
    'bet365.com', 'pokerstars.com', 'draftkings.com', 'fanduel.com',
    'betmgm.com', '888casino.com', 'williamhill.com', 'unibet.com',
    'betway.com', 'paddypower.com', 'bovada.lv', 'betfair.com',
];

const SOCIAL_MEDIA_BLOCKLIST = [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'snapchat.com', 'reddit.com', 'tumblr.com', 'pinterest.com',
];

const GAMING_BLOCKLIST = [
    'store.steampowered.com', 'epicgames.com', 'roblox.com', 'minecraft.net',
    'twitch.tv', 'discord.com', 'origin.com', 'gog.com',
];

// Regional pricing configuration (amounts in cents/smallest currency unit)
const REGIONAL_PRICING = {
    usa: { currency: 'USD', amount: 500, stripe_price_id: 'price_usa' },
    eu: { currency: 'EUR', amount: 500, stripe_price_id: 'price_eu' },
    afg: { currency: 'AFN', amount: 15000, stripe_price_id: 'price_afg' },
    pak: { currency: 'PKR', amount: 30000, stripe_price_id: 'price_pak' },
    ind: { currency: 'INR', amount: 5000, stripe_price_id: 'price_ind' },
    egy: { currency: 'EGP', amount: 3000, stripe_price_id: 'price_egy' },
    bgd: { currency: 'BDT', amount: 7000, stripe_price_id: 'price_bgd' },
};

// Block categories with metadata
const BLOCK_CATEGORIES = [
    { id: 'porn', name: 'Adult/Porn', icon: '🔞', locked: true, description: 'Adult websites and content' },
    { id: 'gambling', name: 'Gambling', icon: '🎰', locked: false, description: 'Gambling and betting sites' },
    { id: 'social_media', name: 'Social Media', icon: '📱', locked: false, description: 'Social networking platforms' },
    { id: 'gaming', name: 'Gaming', icon: '🎮', locked: false, description: 'Gaming platforms and stores' },
    { id: 'violence', name: 'Violence', icon: '⚠️', locked: false, description: 'Violent or graphic content' },
    { id: 'drugs', name: 'Drugs/Alcohol', icon: '💊', locked: false, description: 'Drug and alcohol related content' },
];

async function initializeCollections() {
    console.log('🚀 Starting ZAS Safeguard Firestore initialization...\n');

    try {
        // 1. Initialize global blocklists
        console.log('📋 Creating global blocklists...');
        await db.doc('blocklists/global').set({
            porn: PORN_BLOCKLIST,
            gambling: GAMBLING_BLOCKLIST,
            social_media: SOCIAL_MEDIA_BLOCKLIST,
            gaming: GAMING_BLOCKLIST,
            violence: [],
            drugs: [],
            last_updated: admin.firestore.FieldValue.serverTimestamp(),
            version: 1,
        });
        console.log('   ✅ Global blocklists created');

        // 2. Initialize block policies
        console.log('📋 Creating block policies...');
        const policiesBatch = db.batch();

        for (const category of BLOCK_CATEGORIES) {
            const policyRef = db.collection('block_policies').doc(category.id);
            policiesBatch.set(policyRef, {
                name: category.name,
                icon: category.icon,
                description: category.description,
                type: 'category',
                locked: category.locked,
                priority: category.id === 'porn' ? 100 : 50,
                enabled: true,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        await policiesBatch.commit();
        console.log('   ✅ Block policies created');

        // 3. Initialize regional pricing
        console.log('💰 Creating regional pricing...');
        const pricingBatch = db.batch();

        for (const [region, pricing] of Object.entries(REGIONAL_PRICING)) {
            const pricingRef = db.collection('region_pricing').doc(region);
            pricingBatch.set(pricingRef, {
                ...pricing,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        await pricingBatch.commit();
        console.log('   ✅ Regional pricing created');

        // 4. Create owner ultra-strict profile template
        console.log('🔒 Creating owner profile template...');
        await db.doc('templates/owner_ultra_strict').set({
            ultra_strict: true,
            unlock_timer_minutes: 30,
            blocked_categories: ['porn', 'gambling', 'violence', 'drugs'],
            allow_disable: false,
            allow_uninstall: false,
            require_cloud_unlock: true,
            master_key_min_length: 60,
            anti_temptation_messages: [
                "Take a deep breath. This urge will pass.",
                "Think about why you installed this protection.",
                "You are stronger than this moment.",
                "30 minutes isn't long - use it to reflect.",
                "Every time you resist, you become stronger.",
                "Your future self will thank you for waiting.",
                "This is a test of willpower - you can pass it.",
                "Remember your goals and the person you want to be.",
            ],
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('   ✅ Owner profile template created');

        // 5. Create system configuration
        console.log('⚙️ Creating system configuration...');
        await db.doc('config/system').set({
            version: '1.0.0',
            trial_days: 7,
            min_master_key_length: 60,
            unlock_cooldown_minutes: 30,
            max_devices_per_user: 10,
            max_children_per_family: 10,
            features: {
                ai_classification: true,
                risk_scoring: true,
                weekly_reports: true,
                real_time_sync: true,
            },
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('   ✅ System configuration created');

        // 6. Create placeholder collections (empty docs to establish structure)
        console.log('📁 Creating collection placeholders...');

        const placeholders = [
            { path: 'users/_placeholder', data: { _placeholder: true } },
            { path: 'devices/_placeholder', data: { _placeholder: true } },
            { path: 'owner_profiles/_placeholder', data: { _placeholder: true } },
            { path: 'family_profiles/_placeholder', data: { _placeholder: true } },
            { path: 'children/_placeholder', data: { _placeholder: true } },
            { path: 'override_requests/_placeholder', data: { _placeholder: true } },
            { path: 'logs/_placeholder', data: { _placeholder: true } },
            { path: 'subscriptions/_placeholder', data: { _placeholder: true } },
            { path: 'fraud_scores/_placeholder', data: { _placeholder: true } },
            { path: 'device_registry/_placeholder', data: { _placeholder: true } },
        ];

        const placeholderBatch = db.batch();
        for (const { path, data } of placeholders) {
            placeholderBatch.set(db.doc(path), data);
        }
        await placeholderBatch.commit();
        console.log('   ✅ Collection placeholders created');

        console.log('\n✨ Firestore initialization complete!\n');
        console.log('Collections created:');
        console.log('  - blocklists/global');
        console.log('  - block_policies/{categoryId}');
        console.log('  - region_pricing/{region}');
        console.log('  - templates/owner_ultra_strict');
        console.log('  - config/system');
        console.log('  - Plus placeholder docs for: users, devices, owner_profiles,');
        console.log('    family_profiles, children, override_requests, logs,');
        console.log('    subscriptions, fraud_scores, device_registry\n');

    } catch (error) {
        console.error('❌ Error during initialization:', error);
        process.exit(1);
    }
}

// Run initialization
initializeCollections()
    .then(() => {
        console.log('🎉 Setup complete! You can now deploy Cloud Functions.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
