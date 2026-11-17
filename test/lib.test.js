// Unit tests on saved responses in test/fixtures/ (captured 2026-11-13). No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import {
    ALPHABET,
    ENGINES,
    InputError,
    PREPOSITIONS,
    QUESTION_WORDS,
    amazonMarketplace,
    buildUrl,
    dedupeItems,
    expandSeed,
    normalizeInput,
    parseSuggestions,
    toItems,
} from '../src/lib.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('normalizeInput: defaults, trimming, duplicates removed', () => {
    const input = normalizeInput({ keywords: [' running   shoes ', 'Running shoes', '', 'air fryer'] });
    assert.deepEqual(input.keywords, ['running shoes', 'air fryer']);
    assert.deepEqual(input.engines, ENGINES);
    assert.equal(input.language, 'en');
    assert.equal(input.country, 'US');
    assert.equal(input.expandAlphabet, false);
    assert.equal(input.expandQuestions, false);
    assert.equal(input.expandPrepositions, false);
    assert.equal(input.deduplicate, true);
});

test('normalizeInput: engines and locale are normalized', () => {
    const input = normalizeInput({ keywords: 'a\nb', engines: ['Google', 'amazon', 'google'], language: 'DE', country: 'de', expandAlphabet: true });
    assert.deepEqual(input.keywords, ['a', 'b']);
    assert.deepEqual(input.engines, ['google', 'amazon']);
    assert.equal(input.language, 'de');
    assert.equal(input.country, 'DE');
    assert.equal(input.expandAlphabet, true);
    assert.deepEqual(normalizeInput({ keywords: ['a'], engines: [] }).engines, ENGINES);
});

test('normalizeInput: bad input gives a clear InputError', () => {
    assert.throws(() => normalizeInput(null), InputError);
    assert.throws(() => normalizeInput({}), /keywords/);
    assert.throws(() => normalizeInput({ keywords: [' '] }), /empty/);
    assert.throws(() => normalizeInput({ keywords: [5] }), InputError);
    assert.throws(() => normalizeInput({ keywords: ['a'], engines: ['bing'] }), /Unknown engine "bing"/);
    assert.throws(() => normalizeInput({ keywords: ['a'], country: 'USA' }), /country/);
    assert.throws(() => normalizeInput({ keywords: ['a'], language: 'english!' }), /language/);
    assert.throws(() => normalizeInput({ keywords: Array.from({ length: 1001 }, (_, i) => `k${i}`) }), /Too many/);
});

test('expandSeed', () => {
    assert.deepEqual(expandSeed('yoga mat'), ['yoga mat']);
    const alpha = expandSeed('yoga mat', { expandAlphabet: true });
    assert.equal(alpha.length, 1 + ALPHABET.length);
    assert.equal(alpha[1], 'yoga mat a');
    assert.equal(alpha.at(-1), 'yoga mat z');
    const q = expandSeed('yoga mat', { expandQuestions: true });
    assert.equal(q.length, 1 + QUESTION_WORDS.length);
    assert.equal(q[1], 'how yoga mat');
    const all = expandSeed('yoga mat', { expandAlphabet: true, expandQuestions: true, expandPrepositions: true });
    assert.equal(all.length, 1 + ALPHABET.length + QUESTION_WORDS.length + PREPOSITIONS.length);
    assert.equal(new Set(all).size, all.length);
    assert.ok(all.includes('yoga mat for '));
});

test('buildUrl: each engine', () => {
    const loc = { language: 'en', country: 'US' };
    const g = new URL(buildUrl('google', 'best running shoes', loc));
    assert.equal(g.hostname, 'suggestqueries.google.com');
    assert.equal(g.searchParams.get('q'), 'best running shoes');
    assert.equal(g.searchParams.get('hl'), 'en');
    assert.equal(g.searchParams.get('gl'), 'us');
    assert.equal(g.searchParams.get('ds'), null);
    assert.equal(new URL(buildUrl('youtube', 'x', loc)).searchParams.get('ds'), 'yt');

    const d = new URL(buildUrl('duckduckgo', 'a&b', { language: 'en', country: 'GB' }));
    assert.equal(d.hostname, 'duckduckgo.com');
    assert.equal(d.searchParams.get('q'), 'a&b');
    assert.equal(d.searchParams.get('kl'), 'uk-en');
    assert.equal(d.searchParams.get('type'), 'list');

    const a = new URL(buildUrl('amazon', 'laufschuhe', { language: 'de', country: 'DE' }));
    assert.equal(a.hostname, 'completion.amazon.de');
    assert.equal(a.searchParams.get('mid'), 'A1PA6795UKMFR9');
    assert.equal(a.searchParams.get('prefix'), 'laufschuhe');
    assert.equal(new URL(buildUrl('amazon', 'x', { language: 'pl', country: 'PL' })).hostname, 'completion.amazon.com');
    assert.throws(() => buildUrl('bing', 'x', loc), /Unknown engine/);
});

test('amazonMarketplace: known and fallback', () => {
    assert.deepEqual(amazonMarketplace('GB'), { host: 'completion.amazon.co.uk', marketplaceId: 'A1F83G8C2ARO7P', fallback: false });
    assert.equal(amazonMarketplace('PL').fallback, true);
    assert.equal(amazonMarketplace('PL').marketplaceId, 'ATVPDKIKX0DER');
});

test('parseSuggestions: Google', () => {
    const en = parseSuggestions('google', fixture('google_en.json'));
    assert.equal(en[0], 'best running shoes for men');
    assert.ok(en.length >= 8 && en.length <= 10);
    assert.ok(en.every((s) => s.startsWith('best running sho')));
    const de = parseSuggestions('google', fixture('google_de.json'));
    assert.equal(de[0], 'günstige flüge');
    assert.ok(de.includes('günstige flüge nach mallorca'));
});

test('parseSuggestions: YouTube and DuckDuckGo', () => {
    const yt = parseSuggestions('youtube', fixture('youtube_en.json'));
    assert.equal(yt[0], 'how to tie a tie');
    assert.ok(yt.length >= 8);
    const ddg = parseSuggestions('duckduckgo', fixture('duckduckgo_en.json'));
    assert.equal(ddg[0], 'best running shoes');
    assert.equal(ddg[1], 'best running shoes for men');
    assert.deepEqual(parseSuggestions('duckduckgo', fixture('duckduckgo_empty.json')), []);
});

test('parseSuggestions: Amazon', () => {
    const us = parseSuggestions('amazon', fixture('amazon_us.json'));
    assert.equal(us.length, 10);
    assert.equal(us[0], 'brooks mens running shoes');
    assert.equal(us[1], 'running shoes for men');
    assert.equal(parseSuggestions('amazon', fixture('amazon_de.json'))[0], 'laufschuhe herren');
    assert.deepEqual(parseSuggestions('amazon', fixture('amazon_empty.json')), []);
});

test('parseSuggestions: unreadable bodies throw, odd entries are dropped', () => {
    assert.throws(() => parseSuggestions('google', '<html>Sorry</html>'), /Unreadable google response/);
    assert.throws(() => parseSuggestions('google', '{"a":1}'), /Unreadable/);
    assert.throws(() => parseSuggestions('amazon', '["x",[]]'), /Unreadable amazon response/);
    assert.deepEqual(parseSuggestions('google', '["x",["a"," a ",null,"","b",7]]'), ['a', 'b']);
});

test('toItems and dedupeItems', () => {
    const ctx = { seed: 's', engine: 'google', query: 's a', language: 'en', country: 'US', scrapedAt: '2026-11-13T00:00:00.000Z' };
    const items = toItems(['one', 'two'], ctx);
    assert.deepEqual(items[1], { seed: 's', engine: 'google', query: 's a', suggestion: 'two', position: 2, language: 'en', country: 'US', scrapedAt: ctx.scrapedAt });
    const seen = new Set();
    assert.equal(dedupeItems(items, seen).length, 2);
    const more = [...toItems(['Two', 'three'], ctx), ...toItems(['two'], { ...ctx, engine: 'amazon' })];
    const kept = dedupeItems(more, seen);
    assert.deepEqual(kept.map((i) => `${i.engine}:${i.suggestion}`), ['google:three', 'amazon:two']);
});
