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

export const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');

/**
 * Thể loại game. Key dùng chung giữa 2 store khi trùng nghĩa.
 * Bảng theo thể loại có key dạng "<chart>.<genre>", ví dụ "free.puzzle"; "free" là bảng tất cả game.
 */
export const GENRES = {
  ios: [
    ['action', 7001, 'Action'], ['adventure', 7002, 'Adventure'], ['casual', 7003, 'Casual'],
    ['board', 7004, 'Board'], ['card', 7005, 'Card'], ['casino', 7006, 'Casino'], ['family', 7009, 'Family'],
    ['music', 7011, 'Music'], ['puzzle', 7012, 'Puzzle'], ['racing', 7013, 'Racing'],
    ['rpg', 7014, 'Role Playing'], ['simulation', 7015, 'Simulation'], ['sports', 7016, 'Sports'],
    ['strategy', 7017, 'Strategy'], ['trivia', 7018, 'Trivia'], ['word', 7019, 'Word'],
  ].map(([key, id, label]) => ({ key, id, label })),
  android: [
    ['action', 'GAME_ACTION', 'Action'], ['adventure', 'GAME_ADVENTURE', 'Adventure'], ['arcade', 'GAME_ARCADE', 'Arcade'],
    ['board', 'GAME_BOARD', 'Board'], ['card', 'GAME_CARD', 'Card'], ['casino', 'GAME_CASINO', 'Casino'],
    ['casual', 'GAME_CASUAL', 'Casual'], ['educational', 'GAME_EDUCATIONAL', 'Educational'], ['music', 'GAME_MUSIC', 'Music'],
    ['puzzle', 'GAME_PUZZLE', 'Puzzle'], ['racing', 'GAME_RACING', 'Racing'], ['rpg', 'GAME_ROLE_PLAYING', 'Role Playing'],
    ['simulation', 'GAME_SIMULATION', 'Simulation'], ['sports', 'GAME_SPORTS', 'Sports'], ['strategy', 'GAME_STRATEGY', 'Strategy'],
    ['trivia', 'GAME_TRIVIA', 'Trivia'], ['word', 'GAME_WORD', 'Word'],
  ].map(([key, id, label]) => ({ key, id, label })),
};

/** Danh sách bảng cần thu thập cho 1 store: [{key, chart, genre|null}] */
export function chartKeys(cfg, store) {
  const out = [];
  for (const chart of cfg.charts) {
    out.push({ key: chart, chart, genre: null });
    if (cfg.genres?.enabled) for (const g of GENRES[store]) out.push({ key: `${chart}.${g.key}`, chart, genre: g });
  }
  return out;
}

// Snapshot v2: thứ hạng lưu dạng chỉ số vào bảng `ids` để file nhỏ hơn nhiều khi có bảng thể loại.
export async function writeSnapshot(snap) {
  await mkdir(DAILY_DIR, { recursive: true });
  const dict = new Map();
  const enc = (id) => { if (!dict.has(id)) dict.set(id, dict.size); return dict.get(id); };
  const ranks = {};
  for (const [store, countries] of Object.entries(snap.ranks)) {
    ranks[store] = {};
    for (const [cc, charts] of Object.entries(countries ?? {})) {
      ranks[store][cc] = {};
      for (const [k, ids] of Object.entries(charts)) ranks[store][cc][k] = ids.map(enc);
    }
  }
  // metrics: ios[cc] = [[idx, ratingCount], ...]; android = [[idx, installs, ratings], ...]
  const metrics = {
    ios: Object.fromEntries(Object.entries(snap.metrics.ios ?? {}).map(([cc, m]) => [cc, Object.entries(m).map(([id, c]) => [enc(id), c])])),
    android: Object.entries(snap.metrics.android ?? {}).map(([id, m]) => [enc(id), m.inst, m.rt]),
  };
  const out = { ...snap, v: 3, ids: [...dict.keys()], ranks, metrics };
  await writeFile(path.join(DAILY_DIR, `${snap.date}.json.gz`), gzipSync(JSON.stringify(out)));
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
  const snap = JSON.parse(gunzipSync(buf).toString('utf8'));
  // v1: id dạng chuỗi; v2: thứ hạng mã hoá theo `ids`; v3: thêm metrics mã hoá theo `ids`.
  if (snap.v >= 2) {
    for (const countries of Object.values(snap.ranks)) {
      for (const charts of Object.values(countries ?? {})) {
        for (const k of Object.keys(charts)) charts[k] = charts[k].map((i) => snap.ids[i]);
      }
    }
    const m = snap.metrics;
    if (snap.v >= 3) snap.metrics = {
      ios: Object.fromEntries(Object.entries(m.ios ?? {}).map(([cc, arr]) => [cc, Object.fromEntries(arr.map(([i, c]) => [snap.ids[i], c]))])),
      android: Object.fromEntries((m.android ?? []).map(([i, inst, rt]) => [snap.ids[i], { inst, rt }])),
    };
    delete snap.ids;
  }
  return snap;
}

export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
