/**
 * ZAS Safeguard - Filter List Parser
 * Parses AdBlock Plus / EasyList syntax into Chrome DNR rules
 * 
 * Supported syntax:
 * - ||domain.com^ (block domain)
 * - @@||domain.com^ (exception/allowlist)
 * - /regex/ (regex patterns)
 * - ##.selector (cosmetic hiding)
 * - domain.com##.selector (domain-specific cosmetic)
 * - $third-party, $script, $image, etc. (options)
 */

// Rule ID counter - starts at 100000 to avoid conflicts with static rules
let ruleIdCounter = 100000;

/**
 * Parse a filter list text into Chrome DNR rules
 * @param {string} filterText - Raw filter list text
 * @param {number} maxRules - Maximum rules to generate (Chrome limit)
 * @returns {{ networkRules: Array, cosmeticRules: Array, stats: Object }}
 */
function parseFilterList(filterText, maxRules = 25000) {
    const lines = filterText.split('\n');
    const networkRules = [];
    const cosmeticRules = [];
    const stats = {
        totalLines: lines.length,
        comments: 0,
        networkRules: 0,
        cosmeticRules: 0,
        exceptions: 0,
        skipped: 0,
        errors: 0
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();

        // Skip empty lines and comments
        if (!line || line.startsWith('!') || line.startsWith('[')) {
            stats.comments++;
            continue;
        }

        // Check rule limit
        if (networkRules.length >= maxRules) {
            stats.skipped++;
            continue;
        }

        try {
            // Cosmetic rules (## or #@#)
            if (line.includes('##') || line.includes('#@#')) {
                const cosmeticRule = parseCosmeticRule(line);
                if (cosmeticRule) {
                    cosmeticRules.push(cosmeticRule);
                    stats.cosmeticRules++;
                }
                continue;
            }

            // Exception rules (@@)
            if (line.startsWith('@@')) {
                const rule = parseNetworkRule(line.substring(2), true);
                if (rule) {
                    networkRules.push(rule);
                    stats.exceptions++;
                }
                continue;
            }

            // Regular network rules
            const rule = parseNetworkRule(line, false);
            if (rule) {
                networkRules.push(rule);
                stats.networkRules++;
            }
        } catch (e) {
            stats.errors++;
        }
    }

    return { networkRules, cosmeticRules, stats };
}

/**
 * Parse a network blocking rule
 * @param {string} rule - The rule text (without @@ prefix)
 * @param {boolean} isException - Whether this is an exception rule
 * @returns {Object|null} Chrome DNR rule or null if invalid
 */
function parseNetworkRule(rule, isException) {
    // Extract options (everything after $)
    let pattern = rule;
    let options = {};

    const dollarIndex = rule.lastIndexOf('$');
    if (dollarIndex !== -1 && dollarIndex > 0) {
        pattern = rule.substring(0, dollarIndex);
        options = parseOptions(rule.substring(dollarIndex + 1));
    }

    // Skip unsupported patterns
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
        // Regex patterns - limited support in DNR
        return null;
    }

    // Parse the pattern
    const dnrRule = {
        id: ruleIdCounter++,
        priority: isException ? 2 : 1,
        action: {
            type: isException ? 'allow' : 'block'
        },
        condition: {}
    };

    // Handle ||domain^ pattern (most common)
    if (pattern.startsWith('||')) {
        pattern = pattern.substring(2);
        // Remove trailing ^ or |
        pattern = pattern.replace(/[\^|]+$/, '');

        // Extract domain
        const slashIndex = pattern.indexOf('/');
        if (slashIndex === -1) {
            // Pure domain block
            dnrRule.condition.urlFilter = `||${pattern}`;
        } else {
            // Domain + path
            dnrRule.condition.urlFilter = `||${pattern}`;
        }
    } else if (pattern.startsWith('|')) {
        // Starts with | means anchor to start
        pattern = pattern.substring(1).replace(/[\^|]+$/, '');
        dnrRule.condition.urlFilter = `|${pattern}`;
    } else {
        // General pattern
        pattern = pattern.replace(/[\^|]+$/, '');
        if (!pattern || pattern.length < 3) return null;
        dnrRule.condition.urlFilter = pattern;
    }

    // Apply resource type filters
    if (options.resourceTypes && options.resourceTypes.length > 0) {
        dnrRule.condition.resourceTypes = options.resourceTypes;
    }

    // Apply domain restrictions
    if (options.domains && options.domains.length > 0) {
        dnrRule.condition.initiatorDomains = options.domains;
    }
    if (options.excludedDomains && options.excludedDomains.length > 0) {
        dnrRule.condition.excludedInitiatorDomains = options.excludedDomains;
    }

    // Third-party option
    if (options.thirdParty === true) {
        dnrRule.condition.domainType = 'thirdParty';
    } else if (options.thirdParty === false) {
        dnrRule.condition.domainType = 'firstParty';
    }

    return dnrRule;
}

/**
 * Parse rule options ($option1,option2,...)
 */
function parseOptions(optionsStr) {
    const options = {
        resourceTypes: [],
        domains: [],
        excludedDomains: [],
        thirdParty: null
    };

    const parts = optionsStr.split(',');

    // Resource type mapping
    const typeMap = {
        'script': 'script',
        'image': 'image',
        'stylesheet': 'stylesheet',
        'css': 'stylesheet',
        'object': 'object',
        'xmlhttprequest': 'xmlhttprequest',
        'xhr': 'xmlhttprequest',
        'subdocument': 'sub_frame',
        'frame': 'sub_frame',
        'ping': 'ping',
        'beacon': 'ping',
        'font': 'font',
        'media': 'media',
        'websocket': 'websocket',
        'other': 'other'
    };

    for (const part of parts) {
        const opt = part.trim().toLowerCase();

        // Third-party
        if (opt === 'third-party' || opt === '3p') {
            options.thirdParty = true;
        } else if (opt === '~third-party' || opt === '~3p' || opt === 'first-party' || opt === '1p') {
            options.thirdParty = false;
        }

        // Resource types
        else if (typeMap[opt]) {
            options.resourceTypes.push(typeMap[opt]);
        } else if (opt.startsWith('~') && typeMap[opt.substring(1)]) {
            // Negated type - skip for now (complex logic)
        }

        // Domain restrictions
        else if (opt.startsWith('domain=')) {
            const domains = opt.substring(7).split('|');
            for (const d of domains) {
                if (d.startsWith('~')) {
                    options.excludedDomains.push(d.substring(1));
                } else {
                    options.domains.push(d);
                }
            }
        }
    }

    return options;
}

/**
 * Parse cosmetic (element hiding) rule
 * @param {string} rule - The cosmetic rule
 * @returns {Object|null} Cosmetic rule object or null
 */
function parseCosmeticRule(rule) {
    // Exception cosmetic rules (#@#)
    const isException = rule.includes('#@#');
    const separator = isException ? '#@#' : '##';
    const parts = rule.split(separator);

    if (parts.length !== 2) return null;

    const domains = parts[0] ? parts[0].split(',').filter(d => d) : [];
    const selector = parts[1].trim();

    if (!selector) return null;

    // Skip procedural cosmetic filters (AdGuard extended syntax)
    if (selector.includes(':has(') || selector.includes(':has-text(') ||
        selector.includes(':xpath(') || selector.includes(':matches-css(')) {
        return null;
    }

    return {
        domains: domains.length > 0 ? domains : ['*'],
        selector,
        isException
    };
}

/**
 * Reset rule ID counter (useful for testing)
 */
function resetRuleIdCounter(start = 100000) {
    ruleIdCounter = start;
}

/**
 * Get current rule ID counter value
 */
function getRuleIdCounter() {
    return ruleIdCounter;
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseFilterList,
        parseNetworkRule,
        parseCosmeticRule,
        resetRuleIdCounter,
        getRuleIdCounter
    };
}

// Also expose globally for service worker
if (typeof self !== 'undefined') {
    self.FilterListParser = {
        parseFilterList,
        parseNetworkRule,
        parseCosmeticRule,
        resetRuleIdCounter,
        getRuleIdCounter
    };
}
