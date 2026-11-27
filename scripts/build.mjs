// Đọc các snapshot hằng ngày, tính xu hướng và xuất JSON tĩnh + copy giao diện vào dist/ (để deploy GitHub Pages).
import { cp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, APPS_FILE, LISTINGS_FILE, ADNETS_FILE, TAPTAP_FILE, ADSPY_FILE, KEYWORDS_FILE, GENRES, chartKeys, loadConfig, listSnapshotDates, readSnapshot, readJson, writeJson, daysBetween,
} from './lib.mjs';

const cfg = await loadConfig();
const DIST = path.join(ROOT, 'dist');
const STORES = ['ios', 'android'];
const limitFor = (ck) => (ck.genre ? cfg.genres.limit : cfg.limit);
const globalTopFor = (ck) => (ck.genre ? 150 : 200);
const fileFor = (store, region, ck) => `${store}/${region}_${ck.chart}_${ck.genre?.key ?? 'all'}.json`;

const allDates = await listSnapshotDates();
if (!allDates.length) {
  console.error('Chưa có dữ liệu trong data/daily. Chạy "npm run collect" trước.');
  process.exit(1);
}
const lastDate = allDates.at(-1);
const dates = allDates.filter((d) => daysBetween(d, lastDate) < cfg.historyDays);
const snaps = await Promise.all(dates.map(readSnapshot));
const latest = snaps.at(-1);
const weight = Object.fromEntries(cfg.countries.map((c) => [c.cc, c.weight ?? 1]));

/** Snapshot gần nhất cách ngày mới nhất ít nhất n ngày. */
const ago = (n) => {
  for (let i = snaps.length - 2; i >= 0; i--) if (daysBetween(snaps[i].date, latest.date) >= n) return snaps[i];
  return null;
};
const s1 = ago(1);
const s7 = ago(7);
const i1 = snaps.indexOf(s1);
const i7 = snaps.indexOf(s7);
// Các snapshot trong 7 ngày trước (không gồm hôm nay) — dùng để xác định "mới vào top".
const recentIdx = snaps.map((s, i) => i).filter((i) => i < snaps.length - 1 && daysBetween(snaps[i].date, latest.date) <= 7);

function rankMap(snap, store, cc, key) {
  const ids = snap?.ranks?.[store]?.[cc]?.[key];
  return ids ? new Map(ids.map((id, i) => [id, i + 1])) : null;
}

const delta = (map, id, rank) => {
  if (!map) return { d: null, n: false };
  const prev = map.get(id);
  return prev == null ? { d: null, n: true } : { d: prev - rank, n: false };
};

// ---- chỉ số tăng trưởng (Android: lượt cài; iOS: số đánh giá)
function metric(snap, store, id, cc) {
  if (!snap) return null;
  if (store === 'android') return snap.metrics.android?.[id]?.inst ?? null;
  if (cc !== 'global') return snap.metrics.ios?.[cc]?.[id] ?? null;
  let sum = 0, any = false;
  for (const m of Object.values(snap.metrics.ios ?? {})) if (m[id] != null) { sum += m[id]; any = true; }
  return any ? sum : null;
}
const growthCache = new Map();
function growth(store, id, cc) {
  const k = `${store}|${id}|${cc}`;
  if (!growthCache.has(k)) {
    const now = metric(latest, store, id, cc);
    const g = (s) => { const v = metric(s, store, id, cc); return now != null && v != null ? now - v : null; };
    growthCache.set(k, { m: now, g1: g(s1), g7: g(s7) });
  }
  return growthCache.get(k);
}

// ---- xếp hạng toàn cầu: điểm = Σ trọng số quốc gia × (L + 1 − hạng) / L
function globalScores(snap, store, key, L) {
  const scores = new Map();
  const where = new Map();
  for (const [cc, charts] of Object.entries(snap?.ranks?.[store] ?? {})) {
    (charts[key] ?? []).forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + (weight[cc] ?? 1) * (L - i) / L);
      if (!where.has(id)) where.set(id, []);
      where.get(id).push([cc, i + 1]);
    });
  }
  const sorted = [...scores].sort((x, y) => y[1] - x[1]);
  return { sorted, pos: new Map(sorted.map(([id], i) => [id, i + 1])), where };
}

const usedApps = { ios: new Set(), android: new Set() };
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'site'), DIST, { recursive: true });
let nFiles = 0;
const emit = async (file, body) => { nFiles++; await writeJson(path.join(DIST, 'data', file), body); };

for (const store of STORES) {
  for (const ck of chartKeys(cfg, store)) {
    const L = limitFor(ck);

    // ---- theo quốc gia
    for (const cc of Object.keys(latest.ranks[store] ?? {})) {
      const ids = latest.ranks[store][cc]?.[ck.key];
      if (!ids?.length) continue;
      const maps = snaps.map((s) => rankMap(s, store, cc, ck.key));
      const m1 = i1 >= 0 ? maps[i1] : null;
      const m7 = i7 >= 0 ? maps[i7] : null;
      const recentMaps = recentIdx.map((i) => maps[i]).filter(Boolean);
      const rows = ids.map((id, i) => {
        const rank = i + 1;
        usedApps[store].add(id);
        const a = delta(m1, id, rank);
        const b = delta(m7, id, rank);
        return {
          id, rank,
          d1: a.d, d7: b.d, n7: b.n,
          isNew: recentMaps.length > 0 && recentMaps.every((m) => !m.has(id)),
          hist: maps.map((m) => m?.get(id) ?? null),
          ...growth(store, id, cc),
        };
      });
      await emit(fileFor(store, cc, ck), { store, region: cc, chart: ck.chart, genre: ck.genre?.key ?? 'all', limit: L, date: latest.date, dates, rows });
    }

    // ---- toàn cầu
    const TOP = globalTopFor(ck);
    const per = snaps.map((s) => globalScores(s, store, ck.key, L));
    const now = per.at(-1);
    if (!now.sorted.length) continue;
    const p1 = i1 >= 0 && per[i1].sorted.length ? per[i1].pos : null;
    const p7 = i7 >= 0 && per[i7].sorted.length ? per[i7].pos : null;
    const recentPos = recentIdx.map((i) => per[i].pos).filter((p) => p.size);
    const inTop = (pos, id) => (pos.get(id) ?? Infinity) <= TOP;
    const dlt = (p, id, rank) => (!p ? { d: null, n: false } : inTop(p, id) ? { d: p.get(id) - rank, n: false } : { d: null, n: true });
    const rows = now.sorted.slice(0, TOP).map(([id, score], i) => {
      const rank = i + 1;
      usedApps[store].add(id);
      const a = dlt(p1, id, rank);
      const b = dlt(p7, id, rank);
      return {
        id, rank,
        score: Math.round(score * 100) / 100,
        d1: a.d, d7: b.d, n7: b.n,
        isNew: recentPos.length > 0 && recentPos.every((p) => !inTop(p, id)),
        countries: now.where.get(id).sort((x, y) => x[1] - y[1]),
        hist: per.map((p) => { const r = p.pos.get(id); return r != null && r <= TOP ? r : null; }),
        ...growth(store, id, 'global'),
      };
    });
    await emit(fileFor(store, 'global', ck), { store, region: 'global', chart: ck.chart, genre: ck.genre?.key ?? 'all', limit: TOP, date: latest.date, dates, rows });
  }
}

// ---- thông tin app + ảnh store listing (mỗi app 1 file, chỉ tải khi mở chi tiết)
const apps = await readJson(APPS_FILE, { ios: {}, android: {} });
const listings = await readJson(LISTINGS_FILE, { ios: {}, android: {} });
const adnets = await readJson(ADNETS_FILE, {});
const adspy = await readJson(ADSPY_FILE, {});
const taptap = await readJson(TAPTAP_FILE, null);
const keywords = await readJson(KEYWORDS_FILE, null);
const appsOut = {};
for (const store of STORES) {
  appsOut[store] = {};
  for (const id of usedApps[store]) {
    const a = apps[store][id] ?? {};
    const l = listings[store]?.[id];
    const nets = a.dw && adnets[a.dw]?.nets?.length ? adnets[a.dw].nets : undefined;
    const gads = a.d && adspy[a.d]?.id ? { id: adspy[a.d].id, n: adspy[a.d].n, c: adspy[a.d].c } : undefined;
    appsOut[store][id] = { ...a, ...(l ? { ls: 1 } : {}), ...(nets ? { nets } : {}), ...(gads ? { gads } : {}) };
    if (l) await writeJson(path.join(DIST, 'data', 'listing', store, `${id}.json`), l);
  }
}
await writeJson(path.join(DIST, 'data', 'apps.json'), appsOut);
if (taptap) await writeJson(path.join(DIST, 'data', 'taptap.json'), taptap);
if (keywords) await writeJson(path.join(DIST, 'data', 'keywords.json'), keywords);
await writeJson(path.join(DIST, 'data', 'index.json'), {
  date: latest.date,
  generated: new Date().toISOString(),
  days: dates.length,
  firstDate: allDates[0],
  hasTapTap: Boolean(taptap),
  hasKeywords: Boolean(keywords),
  charts: cfg.charts,
  genres: Object.fromEntries(STORES.map((s) => [s, cfg.genres?.enabled ? GENRES[s].map(({ key, label }) => ({ key, label })) : []])),
  countries: cfg.countries.map(({ cc, name }) => ({ cc, name, stores: STORES.filter((s) => latest.ranks[s]?.[cc]) })),
  errors: latest.errors ?? [],
});
console.log(`build ${latest.date}: ${nFiles} bảng, ${dates.length} ngày lịch sử → dist/`);
