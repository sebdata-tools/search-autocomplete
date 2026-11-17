// Live smoke test: runs the Actor locally with a given input and prints a summary of what it saved.
// Usage (from the Actor folder): node test/run_local.mjs '<input json>'   or   node test/run_local.mjs @file.json
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2] ?? '{"keywords":["running shoes"]}';
const input = JSON.parse(arg.startsWith('@') ? fs.readFileSync(arg.slice(1), 'utf8') : arg);

const storage = path.join(root, 'storage');
fs.rmSync(storage, { recursive: true, force: true });
const kv = path.join(storage, 'key_value_stores', 'default');
fs.mkdirSync(kv, { recursive: true });
fs.writeFileSync(path.join(kv, 'INPUT.json'), JSON.stringify(input));

const t0 = Date.now();
const run = spawnSync(process.execPath, ['src/main.js'], { cwd: root, stdio: 'inherit', env: { ...process.env, APIFY_LOCAL_STORAGE_DIR: storage } });
const seconds = ((Date.now() - t0) / 1000).toFixed(1);

const dsDir = path.join(storage, 'datasets', 'default');
const files = fs.existsSync(dsDir) ? fs.readdirSync(dsDir).filter((f) => /^\d+\.json$/.test(f)).sort() : [];
const items = files.map((f) => JSON.parse(fs.readFileSync(path.join(dsDir, f), 'utf8')));
const summaryFile = path.join(kv, 'SUMMARY.json');
console.log('\n=== exit code', run.status, '| seconds', seconds, '| items', items.length,
    '| per engine', JSON.stringify(Object.fromEntries(['google','youtube','duckduckgo','amazon'].map((e) => [e, items.filter((i) => i.engine === e).length]))),
    '| distinct engine+suggestion', new Set(items.map((i) => i.engine + '|' + i.suggestion.toLowerCase())).size);
if (fs.existsSync(summaryFile)) console.log('SUMMARY', fs.readFileSync(summaryFile, 'utf8'));
for (const it of items.slice(0, Number(process.argv[3] ?? 5))) console.log(JSON.stringify(it));
fs.writeFileSync(path.join(storage, 'items.json'), JSON.stringify(items, null, 1));
process.exit(run.status ?? 1);
