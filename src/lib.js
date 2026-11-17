// Pure functions: input checks, query expansion, request URLs and response parsing for each engine.
// No network and no Apify SDK here, so everything in this file is unit-tested on saved fixtures.

export const ENGINES = ['google', 'youtube', 'duckduckgo', 'amazon'];
export const MAX_KEYWORDS = 1000;

export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const QUESTION_WORDS = ['how', 'what', 'why', 'when', 'where', 'which', 'who', 'can', 'is', 'are', 'does', 'will'];
export const PREPOSITIONS = ['for', 'with', 'without', 'vs', 'near', 'like', 'to', 'and', 'or'];

// Amazon marketplaces: country -> [completion host, marketplace id].
export const AMAZON_MARKETPLACES = {
    US: ['completion.amazon.com', 'ATVPDKIKX0DER'],
    CA: ['completion.amazon.ca', 'A2EUQ1WTGCTBG2'],
    MX: ['completion.amazon.com.mx', 'A1AM78C64UM0Y8'],
    BR: ['completion.amazon.com.br', 'A2Q3Y263D00KWC'],
    GB: ['completion.amazon.co.uk', 'A1F83G8C2ARO7P'],
    DE: ['completion.amazon.de', 'A1PA6795UKMFR9'],
    FR: ['completion.amazon.fr', 'A13V1IB3VIYZZH'],
    IT: ['completion.amazon.it', 'APJ6JRA9NG5V4'],
    ES: ['completion.amazon.es', 'A1RKKUPIHCS9HS'],
    NL: ['completion.amazon.nl', 'A1805IZSGTT6HS'],
    // India is served from the European completion host (completion.amazon.in answered 502, 2026-11-13).
    IN: ['completion.amazon.co.uk', 'A21TJRUUN4KGV'],
    JP: ['completion.amazon.co.jp', 'A1VC38T7YXB528'],
    AU: ['completion.amazon.com.au', 'A39IBJ37TRP1C6'],
};

export class InputError extends Error {}

/** Validates the raw Actor input and fills defaults. Throws InputError with a message a user can act on. */
export function normalizeInput(raw) {
    const input = raw ?? {};
    let { keywords } = input;
    if (typeof keywords === 'string') keywords = keywords.split(/\r?\n/);
    if (!Array.isArray(keywords)) {
        throw new InputError('Input field "keywords" is required: a list of seed keywords, e.g. ["running shoes", "air fryer"].');
    }
    const seen = new Set();
    const cleaned = [];
    for (const k of keywords) {
        if (typeof k !== 'string') throw new InputError('Every entry of "keywords" must be a text string.');
        const t = k.trim().replace(/\s+/g, ' ');
        if (!t || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        cleaned.push(t);
    }
    if (cleaned.length === 0) throw new InputError('Input field "keywords" is empty: give at least one seed keyword.');
    if (cleaned.length > MAX_KEYWORDS) throw new InputError(`Too many keywords: ${cleaned.length}. The limit is ${MAX_KEYWORDS} per run.`);

    let engines = input.engines ?? ENGINES;
    if (!Array.isArray(engines) || engines.length === 0) engines = ENGINES;
    engines = [...new Set(engines.map((e) => String(e).trim().toLowerCase()))];
    const unknown = engines.filter((e) => !ENGINES.includes(e));
    if (unknown.length) throw new InputError(`Unknown engine "${unknown[0]}". Choose from: ${ENGINES.join(', ')}.`);

    const language = String(input.language ?? 'en').trim().toLowerCase();
    const country = String(input.country ?? 'US').trim().toUpperCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(language)) {
        throw new InputError(`"language" must be a language code such as "en", "de" or "pt-br" (got "${language}").`);
    }
    if (!/^[A-Z]{2}$/.test(country)) {
        throw new InputError(`"country" must be a two-letter country code such as "US", "GB" or "DE" (got "${country}").`);
    }

    return {
        keywords: cleaned,
        engines,
        language,
        country,
        expandAlphabet: input.expandAlphabet === true,
        expandQuestions: input.expandQuestions === true,
        expandPrepositions: input.expandPrepositions === true,
        deduplicate: input.deduplicate !== false,
        proxyConfiguration: input.proxyConfiguration ?? null,
    };
}

/** The queries to send for one seed: the seed itself first, then each expansion. No duplicates. */
export function expandSeed(seed, { expandAlphabet = false, expandQuestions = false, expandPrepositions = false } = {}) {
    const queries = [seed];
    if (expandAlphabet) for (const letter of ALPHABET) queries.push(`${seed} ${letter}`);
    if (expandQuestions) for (const word of QUESTION_WORDS) queries.push(`${word} ${seed}`);
    if (expandPrepositions) for (const word of PREPOSITIONS) queries.push(`${seed} ${word} `);
    return [...new Set(queries)];
}

/** Amazon marketplace for a country; falls back to the US one. */
export function amazonMarketplace(country) {
    const known = AMAZON_MARKETPLACES[country];
    const [host, marketplaceId] = known ?? AMAZON_MARKETPLACES.US;
    return { host, marketplaceId, fallback: !known };
}

/** The request URL for one engine and one query. */
export function buildUrl(engine, query, { language, country }) {
    const lang = language.split('-')[0];
    switch (engine) {
        case 'google':
        case 'youtube': {
            const params = new URLSearchParams({ client: 'firefox', q: query, hl: language, gl: country.toLowerCase(), ie: 'utf-8', oe: 'utf-8' });
            if (engine === 'youtube') params.set('ds', 'yt');
            return `https://suggestqueries.google.com/complete/search?${params}`;
        }
        case 'duckduckgo': {
            const region = country === 'GB' ? 'uk' : country.toLowerCase();
            const params = new URLSearchParams({ q: query, type: 'list', kl: `${region}-${lang}` });
            return `https://duckduckgo.com/ac/?${params}`;
        }
        case 'amazon': {
            const { host, marketplaceId } = amazonMarketplace(country);
            const params = new URLSearchParams({ mid: marketplaceId, alias: 'aps', prefix: query, limit: '11' });
            return `https://${host}/api/2017/suggestions?${params}`;
        }
        default:
            throw new Error(`Unknown engine: ${engine}`);
    }
}

const cleanList = (list) => {
    const out = [];
    const seen = new Set();
    for (const v of list) {
        if (typeof v !== 'string') continue;
        const t = v.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
};

/** Parses one engine's response body into a list of suggestion strings, in the engine's order. Throws on an unreadable body. */
export function parseSuggestions(engine, body) {
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        throw new Error(`Unreadable ${engine} response`);
    }
    if (engine === 'amazon') {
        if (!data || !Array.isArray(data.suggestions)) throw new Error('Unreadable amazon response');
        return cleanList(data.suggestions.map((s) => s?.value));
    }
    // Google, YouTube and DuckDuckGo share the OpenSearch shape: ["query", ["suggestion", ...], ...]
    if (!Array.isArray(data) || !Array.isArray(data[1])) throw new Error(`Unreadable ${engine} response`);
    return cleanList(data[1]);
}

/** Dataset items for one response. */
export function toItems(suggestions, { seed, engine, query, language, country, scrapedAt }) {
    return suggestions.map((suggestion, i) => ({ seed, engine, query, suggestion, position: i + 1, language, country, scrapedAt }));
}

/** Drops items whose (engine, suggestion) was already seen; `seen` is updated. Case-insensitive. */
export function dedupeItems(items, seen) {
    const out = [];
    for (const item of items) {
        const key = `${item.engine}\u0000${item.suggestion.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
