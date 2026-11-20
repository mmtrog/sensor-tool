// Đọc các snapshot hằng ngày, tính xu hướng và xuất JSON tĩnh + copy giao diện vào dist/ (để deploy GitHub Pages).
import { cp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, APPS_FILE, loadConfig, listSnapshotDates, readSnapshot, readJson, writeJson, daysBetween,
} from './lib.mjs';

const cfg = await loadConfig();
const DIST = path.join(ROOT, 'dist');
const L = cfg.limit;
const GLOBAL_TOP = 200;
const STORES = ['ios', 'android'];

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
// Các snapshot trong 7 ngày trước (không gồm hôm nay) — dùng để xác định "mới vào top".
const recent = snaps.slice(0, -1).filter((s) => daysBetween(s.date, latest.date) <= 7);

const rankCache = new Map();
function rankMap(snap, store, cc, chart) {
  if (!snap) return null;
  const key = `${snap.date}|${store}|${cc}|${chart}`;
  if (!rankCache.has(key)) {
    const ids = snap.ranks?.[store]?.[cc]?.[chart];
    rankCache.set(key, ids ? new Map(ids.map((id, i) => [id, i + 1])) : null);
  }
  return rankCache.get(key);
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
function growth(store, id, cc) {
  const now = metric(latest, store, id, cc);
  const g = (s) => { const v = metric(s, store, id, cc); return now != null && v != null ? now - v : null; };
  return { m: now, g1: g(s1), g7: g(s7) };
}

const usedApps = { ios: new Set(), android: new Set() };
const out = [];

// ---- bảng xếp hạng theo quốc gia
for (const store of STORES) {
  for (const cc of Object.keys(latest.ranks[store] ?? {})) {
    for (const chart of cfg.charts) {
      const ids = latest.ranks[store][cc]?.[chart];
      if (!ids?.length) continue;
      const m1 = rankMap(s1, store, cc, chart);
      const m7 = rankMap(s7, store, cc, chart);
      const recentMaps = recent.map((s) => rankMap(s, store, cc, chart)).filter(Boolean);
      const histMaps = snaps.map((s) => rankMap(s, store, cc, chart));
      const rows = ids.map((id, i) => {
        const rank = i + 1;
        usedApps[store].add(id);
        const a = delta(m1, id, rank);
        const b = delta(m7, id, rank);
        return {
          id, rank,
          d1: a.d, d7: b.d, n7: b.n,
          isNew: recentMaps.length > 0 && recentMaps.every((m) => !m.has(id)),
          hist: histMaps.map((m) => m?.get(id) ?? null),
          ...growth(store, id, cc),
        };
      });
      out.push({ file: `${store}/${cc}_${chart}.json`, body: { store, region: cc, chart, date: latest.date, dates, rows } });
    }
  }
}

// ---- xếp hạng toàn cầu: điểm = Σ trọng số quốc gia × (L + 1 − hạng) / L
function globalScores(snap, store, chart) {
  const scores = new Map();
  const where = new Map();
  for (const [cc, charts] of Object.entries(snap?.ranks?.[store] ?? {})) {
    (charts[chart] ?? []).forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + (weight[cc] ?? 1) * (L - i) / L);
      if (!where.has(id)) where.set(id, []);
      where.get(id).push([cc, i + 1]);
    });
  }
  const sorted = [...scores].sort((x, y) => y[1] - x[1]);
  const pos = new Map(sorted.map(([id], i) => [id, i + 1]));
  return { sorted, pos, where };
}

for (const store of STORES) {
  for (const chart of cfg.charts) {
    const per = snaps.map((s) => globalScores(s, store, chart));
    const now = per.at(-1);
    if (!now.sorted.length) continue;
    const idx = (s) => (s ? snaps.indexOf(s) : -1);
    const p1 = idx(s1) >= 0 ? per[idx(s1)].pos : null;
    const p7 = idx(s7) >= 0 ? per[idx(s7)].pos : null;
    const recentPos = recent.map((s) => per[snaps.indexOf(s)].pos);
    const inTop = (pos, id) => (pos.get(id) ?? Infinity) <= GLOBAL_TOP;
    const rows = now.sorted.slice(0, GLOBAL_TOP).map(([id, score], i) => {
      const rank = i + 1;
      usedApps[store].add(id);
      const a = p1 ? (inTop(p1, id) ? { d: p1.get(id) - rank, n: false } : { d: null, n: true }) : { d: null, n: false };
      const b = p7 ? (inTop(p7, id) ? { d: p7.get(id) - rank, n: false } : { d: null, n: true }) : { d: null, n: false };
      return {
        id, rank,
        score: Math.round(score * 100) / 100,
        d1: a.d, d7: b.d, n7: b.n,
        isNew: recentPos.length > 0 && recentPos.every((p) => !inTop(p, id)),
        countries: now.where.get(id).sort((x, y) => x[1] - y[1]),
        hist: per.map((p) => { const r = p.pos.get(id); return r != null && r <= GLOBAL_TOP ? r : null; }),
        ...growth(store, id, 'global'),
      };
    });
    out.push({ file: `${store}/global_${chart}.json`, body: { store, region: 'global', chart, date: latest.date, dates, rows } });
  }
}

// ---- ghi ra dist/
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'site'), DIST, { recursive: true });
for (const o of out) await writeJson(path.join(DIST, 'data', o.file), o.body);

const apps = await readJson(APPS_FILE, { ios: {}, android: {} });
const appsOut = {};
for (const store of STORES) {
  appsOut[store] = {};
  for (const id of usedApps[store]) appsOut[store][id] = apps[store][id] ?? {};
}
await writeJson(path.join(DIST, 'data', 'apps.json'), appsOut);
await writeJson(path.join(DIST, 'data', 'index.json'), {
  date: latest.date,
  generated: new Date().toISOString(),
  days: dates.length,
  firstDate: allDates[0],
  charts: cfg.charts,
  limit: L,
  countries: cfg.countries.map(({ cc, name }) => ({
    cc, name,
    stores: STORES.filter((s) => latest.ranks[s]?.[cc]),
  })),
  errors: latest.errors ?? [],
});
console.log(`build ${latest.date}: ${out.length} bảng, ${dates.length} ngày lịch sử → dist/`);
