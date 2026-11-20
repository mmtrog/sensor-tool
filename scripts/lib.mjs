import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DAILY_DIR = path.join(DATA_DIR, 'daily');
export const APPS_FILE = path.join(DATA_DIR, 'apps.json');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const today = () => new Date().toISOString().slice(0, 10);

export async function loadConfig() {
  return JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
}

/** Retry an async fn with exponential backoff. */
export async function retry(fn, { tries = 3, base = 1500, label = '' } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      if (i < tries - 1) await sleep(base * 2 ** i);
    }
  }
  throw new Error(`${label} failed after ${tries} tries: ${err?.message}`);
}

/** Run tasks with limited concurrency; never throws, returns results in order. */
export async function pool(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await worker(items[i], i);
      } catch (e) {
        out[i] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return out;
}

export async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (game-trends-tool)', Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, obj, pretty = false) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj, null, pretty ? 1 : 0));
}

export async function writeSnapshot(snap) {
  await mkdir(DAILY_DIR, { recursive: true });
  await writeFile(path.join(DAILY_DIR, `${snap.date}.json.gz`), gzipSync(JSON.stringify(snap)));
}

export async function listSnapshotDates() {
  const files = await readdir(DAILY_DIR).catch(() => []);
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

export async function readSnapshot(date) {
  const buf = await readFile(path.join(DAILY_DIR, `${date}.json.gz`));
  return JSON.parse(gunzipSync(buf).toString('utf8'));
}

export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
