// Search Autocomplete: suggestions from Google, YouTube, DuckDuckGo and Amazon for many seeds, one item per suggestion.
import { Actor, log } from 'apify';
import { ProxyAgent, fetch } from 'undici';

import { InputError, amazonMarketplace, buildUrl, dedupeItems, expandSeed, normalizeInput, parseSuggestions, toItems } from './lib.js';

const EVENT = 'suggestion';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const RETRIES = 4;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** GET with retries and backoff on network errors, 429 and 5xx. Returns the body text. */
async function request(url, dispatcher) {
    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000) + Math.random() * 500);
        try {
            const res = await fetch(url, {
                dispatcher,
                headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/javascript, */*' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (res.status === 429 || res.status >= 500) {
                await res.body?.cancel();
                lastError = new Error(`HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                await res.body?.cancel();
                const err = new Error(`HTTP ${res.status}`);
                err.permanent = true;
                throw err;
            }
            return await res.text();
        } catch (err) {
            if (err.permanent) throw err;
            lastError = err;
        }
    }
    throw lastError;
}

/** Runs fn over items with a fixed number of workers; results keep the input order. */
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return results;
}

await Actor.init();

let input;
try {
    input = normalizeInput(await Actor.getInput());
} catch (err) {
    if (err instanceof InputError) await Actor.fail(`Invalid input: ${err.message}`);
    throw err;
}

const proxyConfiguration = input.proxyConfiguration ? await Actor.createProxyConfiguration(input.proxyConfiguration) : undefined;
const proxyUrl = await proxyConfiguration?.newUrl();
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

if (input.engines.includes('amazon') && amazonMarketplace(input.country).fallback) {
    log.warning(`Amazon has no marketplace for country ${input.country}; using amazon.com (US) for Amazon suggestions.`);
}

const chargingManager = Actor.getChargingManager();
const remainingBudget = () => {
    const n = chargingManager.calculateMaxEventChargeCountWithinLimit(EVENT);
    return Number.isFinite(n) ? n : Infinity;
};

const stats = { keywords: input.keywords.length, requests: 0, requestsFailed: 0, suggestions: 0, duplicatesSkipped: 0, perEngine: {} };
for (const e of input.engines) stats.perEngine[e] = 0;
const seen = new Set(); // across the whole run: (engine, suggestion)
let limitReached = false;

for (const [si, seed] of input.keywords.entries()) {
    if (remainingBudget() <= 0) {
        limitReached = true;
        break;
    }
    const tasks = [];
    for (const engine of input.engines) {
        for (const query of expandSeed(seed, input)) tasks.push({ engine, query });
    }

    const scrapedAt = new Date().toISOString();
    const responses = await mapLimit(tasks, CONCURRENCY, async ({ engine, query }) => {
        stats.requests++;
        try {
            const suggestions = parseSuggestions(engine, await request(buildUrl(engine, query, input), dispatcher));
            return toItems(suggestions, { seed, engine, query, language: input.language, country: input.country, scrapedAt });
        } catch (err) {
            stats.requestsFailed++;
            log.warning(`${engine} "${query}" failed after retries: ${err.message}`);
            return [];
        }
    });

    let items = responses.flat();
    if (input.deduplicate) {
        const before = items.length;
        items = dedupeItems(items, seen);
        stats.duplicatesSkipped += before - items.length;
    }
    // Never save more than the user's spending limit pays for.
    items = items.slice(0, remainingBudget());

    if (items.length > 0) {
        const charge = await Actor.pushData(items, EVENT);
        stats.suggestions += items.length;
        for (const item of items) stats.perEngine[item.engine]++;
        if (charge?.eventChargeLimitReached) limitReached = true;
    }
    log.info(`Keyword ${si + 1}/${input.keywords.length} "${seed}": ${items.length} suggestions saved.`);
    await Actor.setStatusMessage(`${si + 1}/${input.keywords.length} keywords done, ${stats.suggestions} suggestions`);
    if (limitReached) break;
}

await Actor.setValue('SUMMARY', { ...stats, limitReached });

if (limitReached) log.info('The spending limit for this run was reached; stopped early with the results saved so far.');
if (stats.requests > 0 && stats.requestsFailed === stats.requests) {
    await Actor.fail('None of the suggestion sources could be reached. Nothing was charged for results. Try again, or set a proxy in the input.');
}
const notes = [
    stats.requestsFailed ? `${stats.requestsFailed} of ${stats.requests} requests failed` : null,
    limitReached ? 'spending limit reached' : null,
].filter(Boolean);
await Actor.exit(`Done: ${stats.suggestions} suggestions for ${stats.keywords} keywords${notes.length ? ` (${notes.join(', ')})` : ''}.`);
