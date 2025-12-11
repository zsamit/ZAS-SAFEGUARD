/**
 * ZAS Safeguard - Quotes System
 * Offline quotes for blocked pages with geo-based selection
 */

// ============================================
// ISLAMIC QUOTES (Soft reminders, no controversy)
// ============================================

const ISLAMIC_QUOTES = [
    // Patience & Self-Control
    { id: 'isl_001', text: 'Lower your gaze, protect your heart, and Allah will honor you with something far better.', source: 'Reminder', tags: ['self-control', 'purity'] },
    { id: 'isl_002', text: 'Indeed, with hardship comes ease. Be patient, Allah\'s plan is always better.', source: 'Quran 94:6', tags: ['patience', 'hope'] },
    { id: 'isl_003', text: 'The strong person is not the one who can wrestle, but the one who controls himself when angry.', source: 'Prophet Muhammad (PBUH)', tags: ['self-control', 'strength'] },
    { id: 'isl_004', text: 'And whoever puts their trust in Allah, He will be enough for them.', source: 'Quran 65:3', tags: ['tawakkul', 'trust'] },
    { id: 'isl_005', text: 'Take advantage of five before five: your youth before old age, your health before sickness, your wealth before poverty, your free time before you become preoccupied, and your life before death.', source: 'Prophet Muhammad ﷺ', tags: ['time', 'wisdom'] },
    { id: 'isl_006', text: 'Verily, Allah does not look at your appearance or wealth, but rather He looks at your hearts and actions.', source: 'Prophet Muhammad ﷺ', tags: ['sincerity', 'character'] },
    { id: 'isl_007', text: 'Be in this world as if you were a stranger or a traveler.', source: 'Prophet Muhammad ﷺ', tags: ['detachment', 'focus'] },
    { id: 'isl_008', text: 'Whoever seeks the pleasure of Allah though it displeases people, Allah will be pleased with him.', source: 'Hadith', tags: ['sincerity', 'courage'] },
    { id: 'isl_009', text: 'The best among you are those who have the best character.', source: 'Prophet Muhammad ﷺ', tags: ['character', 'excellence'] },
    { id: 'isl_010', text: 'When Allah loves a servant, He tests him.', source: 'Hadith', tags: ['trials', 'hope'] },

    // Avoiding Sin & Temptation
    { id: 'isl_011', text: 'Every son of Adam sins, and the best of sinners are those who repent.', source: 'Prophet Muhammad ﷺ', tags: ['repentance', 'hope'] },
    { id: 'isl_012', text: 'Leave what makes you doubt for what does not make you doubt.', source: 'Prophet Muhammad ﷺ', tags: ['doubt', 'clarity'] },
    { id: 'isl_013', text: 'A moment of patience in a moment of anger saves you a hundred moments of regret.', source: 'Ali ibn Abi Talib', tags: ['patience', 'anger'] },
    { id: 'isl_014', text: 'The eyes commit adultery, and their adultery is the lustful look.', source: 'Prophet Muhammad ﷺ', tags: ['gaze', 'purity'] },
    { id: 'isl_015', text: 'Whoever leaves something for the sake of Allah, Allah will replace it with something better.', source: 'Hadith', tags: ['sacrifice', 'reward'] },
    { id: 'isl_016', text: 'The heart that is attached to the mosques... will be shaded on the Day of Judgment.', source: 'Prophet Muhammad ﷺ', tags: ['prayer', 'devotion'] },
    { id: 'isl_017', text: 'Remember Allah in times of ease, and He will remember you in times of difficulty.', source: 'Prophet Muhammad ﷺ', tags: ['remembrance', 'gratitude'] },
    { id: 'isl_018', text: 'Modesty brings nothing but good.', source: 'Prophet Muhammad ﷺ', tags: ['modesty', 'character'] },
    { id: 'isl_019', text: 'The believer does not insult others, does not curse, is not vulgar, and is not shameless.', source: 'Prophet Muhammad ﷺ', tags: ['speech', 'character'] },
    { id: 'isl_020', text: 'Beware of jealousy, for it consumes good deeds like fire consumes wood.', source: 'Prophet Muhammad ﷺ', tags: ['jealousy', 'heart'] },

    // Hope & Tawakkul
    { id: 'isl_021', text: 'Do not lose hope, nor be sad. You will surely be victorious if you are true believers.', source: 'Quran 3:139', tags: ['hope', 'faith'] },
    { id: 'isl_022', text: 'Allah is with those who patiently persevere.', source: 'Quran 2:153', tags: ['patience', 'support'] },
    { id: 'isl_023', text: 'And He found you lost and guided you.', source: 'Quran 93:7', tags: ['guidance', 'gratitude'] },
    { id: 'isl_024', text: 'Perhaps you hate a thing and it is good for you; and perhaps you love a thing and it is bad for you.', source: 'Quran 2:216', tags: ['wisdom', 'trust'] },
    { id: 'isl_025', text: 'Call upon Me; I will respond to you.', source: 'Quran 40:60', tags: ['dua', 'hope'] },
    { id: 'isl_026', text: 'Allah does not burden a soul beyond that it can bear.', source: 'Quran 2:286', tags: ['trials', 'mercy'] },
    { id: 'isl_027', text: 'So verily, with hardship, there is relief.', source: 'Quran 94:5', tags: ['hardship', 'relief'] },
    { id: 'isl_028', text: 'My mercy embraces all things.', source: 'Quran 7:156', tags: ['mercy', 'hope'] },
    { id: 'isl_029', text: 'And whoever fears Allah, He will make for him a way out.', source: 'Quran 65:2', tags: ['taqwa', 'ease'] },
    { id: 'isl_030', text: 'Tie your camel, then put your trust in Allah.', source: 'Prophet Muhammad ﷺ', tags: ['action', 'tawakkul'] },

    // Knowledge & Growth
    { id: 'isl_031', text: 'Seeking knowledge is an obligation upon every Muslim.', source: 'Prophet Muhammad ﷺ', tags: ['knowledge', 'learning'] },
    { id: 'isl_032', text: 'Whoever treads a path in search of knowledge, Allah will make easy for him the path to Paradise.', source: 'Prophet Muhammad ﷺ', tags: ['knowledge', 'reward'] },
    { id: 'isl_033', text: 'Read! In the name of your Lord who created.', source: 'Quran 96:1', tags: ['reading', 'knowledge'] },
    { id: 'isl_034', text: 'The ink of the scholar is more sacred than the blood of the martyr.', source: 'Hadith', tags: ['knowledge', 'value'] },
    { id: 'isl_035', text: 'He who follows a path in quest of knowledge, Allah will make the path of Paradise easy for him.', source: 'Prophet Muhammad ﷺ', tags: ['study', 'paradise'] },

    // Daily Reminders
    { id: 'isl_036', text: 'Say Alhamdulillah. Gratitude increases blessings.', source: 'Reminder', tags: ['gratitude', 'blessings'] },
    { id: 'isl_037', text: 'Make dua. Your Lord is listening.', source: 'Reminder', tags: ['dua', 'prayer'] },
    { id: 'isl_038', text: 'Send salawat on the Prophet ﷺ. It brings peace to your heart.', source: 'Reminder', tags: ['salawat', 'peace'] },
    { id: 'isl_039', text: 'Read some Quran today. Even one verse brings barakah.', source: 'Reminder', tags: ['quran', 'barakah'] },
    { id: 'isl_040', text: 'Pray your salah on time. It is the pillar of your deen.', source: 'Reminder', tags: ['salah', 'priority'] },
];

// ============================================
// MOTIVATIONAL QUOTES (Productivity & Discipline)
// ============================================

const MOTIVATIONAL_QUOTES = [
    // Discipline & Focus
    { id: 'mot_001', text: 'Discipline is choosing what you want most over what you want now.', source: 'Abraham Lincoln', tags: ['discipline', 'focus'] },
    { id: 'mot_002', text: 'The only way to do great work is to love what you do.', source: 'Steve Jobs', tags: ['passion', 'work'] },
    { id: 'mot_003', text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', source: 'Winston Churchill', tags: ['perseverance', 'courage'] },
    { id: 'mot_004', text: 'You don\'t have to be great to start, but you have to start to be great.', source: 'Zig Ziglar', tags: ['action', 'beginning'] },
    { id: 'mot_005', text: 'The secret of getting ahead is getting started.', source: 'Mark Twain', tags: ['action', 'progress'] },
    { id: 'mot_006', text: 'Focus on being productive instead of busy.', source: 'Tim Ferriss', tags: ['productivity', 'focus'] },
    { id: 'mot_007', text: 'It\'s not about having time, it\'s about making time.', source: 'Unknown', tags: ['time', 'priorities'] },
    { id: 'mot_008', text: 'Small progress is still progress.', source: 'Unknown', tags: ['progress', 'patience'] },
    { id: 'mot_009', text: 'Your future is created by what you do today, not tomorrow.', source: 'Robert Kiyosaki', tags: ['action', 'future'] },
    { id: 'mot_010', text: 'Don\'t watch the clock; do what it does. Keep going.', source: 'Sam Levenson', tags: ['persistence', 'time'] },

    // Study & Learning
    { id: 'mot_011', text: 'The expert in anything was once a beginner.', source: 'Helen Hayes', tags: ['learning', 'growth'] },
    { id: 'mot_012', text: 'Education is the most powerful weapon you can use to change the world.', source: 'Nelson Mandela', tags: ['education', 'power'] },
    { id: 'mot_013', text: 'The more that you read, the more things you will know.', source: 'Dr. Seuss', tags: ['reading', 'knowledge'] },
    { id: 'mot_014', text: 'An investment in knowledge pays the best interest.', source: 'Benjamin Franklin', tags: ['knowledge', 'investment'] },
    { id: 'mot_015', text: 'Learning is not attained by chance, it must be sought with passion.', source: 'Abigail Adams', tags: ['learning', 'passion'] },
    { id: 'mot_016', text: 'The beautiful thing about learning is that no one can take it away from you.', source: 'B.B. King', tags: ['learning', 'value'] },
    { id: 'mot_017', text: 'Study while others are sleeping; work while others are loafing.', source: 'William Arthur Ward', tags: ['study', 'dedication'] },
    { id: 'mot_018', text: 'The capacity to learn is a gift; the ability to learn is a skill; the willingness to learn is a choice.', source: 'Brian Herbert', tags: ['learning', 'choice'] },
    { id: 'mot_019', text: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', source: 'Mahatma Gandhi', tags: ['learning', 'life'] },
    { id: 'mot_020', text: 'The only person you are destined to become is the person you decide to be.', source: 'Ralph Waldo Emerson', tags: ['destiny', 'choice'] },

    // Consistency & Habits
    { id: 'mot_021', text: 'We are what we repeatedly do. Excellence is not an act, but a habit.', source: 'Aristotle', tags: ['habits', 'excellence'] },
    { id: 'mot_022', text: 'Success is the sum of small efforts, repeated day in and day out.', source: 'Robert Collier', tags: ['consistency', 'success'] },
    { id: 'mot_023', text: 'The habit of persistence is the habit of victory.', source: 'Herbert Kaufman', tags: ['persistence', 'victory'] },
    { id: 'mot_024', text: 'Motivation gets you going, but discipline keeps you growing.', source: 'John C. Maxwell', tags: ['discipline', 'growth'] },
    { id: 'mot_025', text: 'A river cuts through rock not because of its power, but its persistence.', source: 'Jim Watkins', tags: ['persistence', 'patience'] },
    { id: 'mot_026', text: 'Success is walking from failure to failure with no loss of enthusiasm.', source: 'Winston Churchill', tags: ['failure', 'resilience'] },
    { id: 'mot_027', text: 'The only limit to our realization of tomorrow will be our doubts of today.', source: 'Franklin D. Roosevelt', tags: ['doubt', 'potential'] },
    { id: 'mot_028', text: 'Do something today that your future self will thank you for.', source: 'Sean Patrick Flanery', tags: ['future', 'action'] },
    { id: 'mot_029', text: 'Champions keep playing until they get it right.', source: 'Billie Jean King', tags: ['persistence', 'excellence'] },
    { id: 'mot_030', text: 'Fall seven times, stand up eight.', source: 'Japanese Proverb', tags: ['resilience', 'determination'] },

    // Self-Improvement
    { id: 'mot_031', text: 'Be the change you wish to see in the world.', source: 'Mahatma Gandhi', tags: ['change', 'action'] },
    { id: 'mot_032', text: 'The greatest glory is not in never falling, but in rising every time we fall.', source: 'Confucius', tags: ['resilience', 'glory'] },
    { id: 'mot_033', text: 'What you get by achieving your goals is not as important as what you become.', source: 'Zig Ziglar', tags: ['goals', 'growth'] },
    { id: 'mot_034', text: 'Believe you can and you\'re halfway there.', source: 'Theodore Roosevelt', tags: ['belief', 'confidence'] },
    { id: 'mot_035', text: 'The mind is everything. What you think you become.', source: 'Buddha', tags: ['mindset', 'thoughts'] },
    { id: 'mot_036', text: 'Don\'t let yesterday take up too much of today.', source: 'Will Rogers', tags: ['past', 'present'] },
    { id: 'mot_037', text: 'You miss 100% of the shots you don\'t take.', source: 'Wayne Gretzky', tags: ['action', 'risk'] },
    { id: 'mot_038', text: 'The best time to plant a tree was 20 years ago. The second best time is now.', source: 'Chinese Proverb', tags: ['action', 'timing'] },
    { id: 'mot_039', text: 'It does not matter how slowly you go as long as you do not stop.', source: 'Confucius', tags: ['persistence', 'progress'] },
    { id: 'mot_040', text: 'Your limitation—it\'s only your imagination.', source: 'Unknown', tags: ['limits', 'imagination'] },
];

// ============================================
// COUNTRY GROUPS
// ============================================

const MUSLIM_COUNTRIES = [
    'AF', // Afghanistan
    'DZ', // Algeria
    'BH', // Bahrain
    'BD', // Bangladesh
    'BN', // Brunei
    'EG', // Egypt
    'ID', // Indonesia
    'IR', // Iran
    'IQ', // Iraq
    'JO', // Jordan
    'KW', // Kuwait
    'LB', // Lebanon
    'LY', // Libya
    'MY', // Malaysia
    'MV', // Maldives
    'MR', // Mauritania
    'MA', // Morocco
    'OM', // Oman
    'PK', // Pakistan
    'PS', // Palestine
    'QA', // Qatar
    'SA', // Saudi Arabia
    'SN', // Senegal
    'SO', // Somalia
    'SD', // Sudan
    'SY', // Syria
    'TJ', // Tajikistan
    'TN', // Tunisia
    'TR', // Turkey
    'TM', // Turkmenistan
    'AE', // UAE
    'UZ', // Uzbekistan
    'YE', // Yemen
];

const WESTERN_COUNTRIES = [
    'US', // United States
    'CA', // Canada
    'GB', // United Kingdom
    'AU', // Australia
    'NZ', // New Zealand
    'IE', // Ireland
    'DE', // Germany
    'FR', // France
    'IT', // Italy
    'ES', // Spain
    'PT', // Portugal
    'NL', // Netherlands
    'BE', // Belgium
    'CH', // Switzerland
    'AT', // Austria
    'SE', // Sweden
    'NO', // Norway
    'DK', // Denmark
    'FI', // Finland
    'PL', // Poland
    'CZ', // Czech Republic
    'HU', // Hungary
    'GR', // Greece
    'RO', // Romania
    'SK', // Slovakia
    'SI', // Slovenia
    'HR', // Croatia
    'LU', // Luxembourg
];

const MIXED_COUNTRIES = [
    'IN', // India
    'KE', // Kenya
    'NG', // Nigeria
    'ZA', // South Africa
    'TZ', // Tanzania
    'UG', // Uganda
    'GH', // Ghana
    'ET', // Ethiopia
    'PH', // Philippines
    'SG', // Singapore
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get default quote type based on country code
 * @param {string} countryCode - ISO 2-letter country code
 * @returns {'islamic' | 'motivational'}
 */
function getDefaultQuoteTypeForCountry(countryCode) {
    const cc = (countryCode || '').toUpperCase();
    if (MUSLIM_COUNTRIES.includes(cc)) return 'islamic';
    if (WESTERN_COUNTRIES.includes(cc)) return 'motivational';
    if (MIXED_COUNTRIES.includes(cc)) return 'motivational';
    return 'motivational'; // Safe fallback
}

/**
 * Get a random quote based on options
 * @param {object} options
 * @param {string} options.quoteType - 'islamic' | 'motivational' | 'auto'
 * @param {string} options.countryCode - ISO country code (e.g., 'US', 'PK')
 * @returns {object} Quote object { id, text, source, tags }
 */
function getRandomQuote(options = {}) {
    const { quoteType = 'auto', countryCode = 'US' } = options;

    // Resolve final type
    let finalType = quoteType;
    if (quoteType === 'auto') {
        finalType = getDefaultQuoteTypeForCountry(countryCode);
    }

    // Choose quote array
    let quotes = finalType === 'islamic' ? ISLAMIC_QUOTES : MOTIVATIONAL_QUOTES;

    // Fallback if empty
    if (!quotes || quotes.length === 0) {
        quotes = MOTIVATIONAL_QUOTES;
    }

    // Return random quote
    const randomIndex = Math.floor(Math.random() * quotes.length);
    return quotes[randomIndex];
}

/**
 * Get quote by ID
 * @param {string} quoteId - Quote ID
 * @returns {object|null}
 */
function getQuoteById(quoteId) {
    const allQuotes = [...ISLAMIC_QUOTES, ...MOTIVATIONAL_QUOTES];
    return allQuotes.find(q => q.id === quoteId) || null;
}

/**
 * Get quotes by tag
 * @param {string} tag - Tag to filter by
 * @param {string} quoteType - 'islamic' | 'motivational' | 'all'
 * @returns {array}
 */
function getQuotesByTag(tag, quoteType = 'all') {
    let quotes;
    if (quoteType === 'islamic') {
        quotes = ISLAMIC_QUOTES;
    } else if (quoteType === 'motivational') {
        quotes = MOTIVATIONAL_QUOTES;
    } else {
        quotes = [...ISLAMIC_QUOTES, ...MOTIVATIONAL_QUOTES];
    }

    return quotes.filter(q => q.tags && q.tags.includes(tag));
}

// ============================================
// EXPORTS
// ============================================

// For ES Modules
if (typeof window !== 'undefined') {
    window.QuotesSystem = {
        ISLAMIC_QUOTES,
        MOTIVATIONAL_QUOTES,
        MUSLIM_COUNTRIES,
        WESTERN_COUNTRIES,
        MIXED_COUNTRIES,
        getDefaultQuoteTypeForCountry,
        getRandomQuote,
        getQuoteById,
        getQuotesByTag
    };
}

// For Node.js / Chrome Extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ISLAMIC_QUOTES,
        MOTIVATIONAL_QUOTES,
        MUSLIM_COUNTRIES,
        WESTERN_COUNTRIES,
        MIXED_COUNTRIES,
        getDefaultQuoteTypeForCountry,
        getRandomQuote,
        getQuoteById,
        getQuotesByTag
    };
}
