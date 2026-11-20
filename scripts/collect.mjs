// Thu thập bảng xếp hạng game hằng ngày từ App Store (RSS chính chủ Apple) và Google Play (scrape).
// Kết quả: data/daily/YYYY-MM-DD.json.gz (thứ hạng + chỉ số) và data/apps.json (thông tin app).
import gplay from 'google-play-scraper';
import {
  loadConfig, today, sleep, retry, pool, fetchJson, readJson, writeJson, writeSnapshot, readSnapshot, APPS_FILE,
} from './lib.mjs';

const cfg = await loadConfig();
const date = process.env.DATE || today();
const only = process.env.STORE; // "ios" | "android" | undefined (cả hai)

const snap = { date, ranks: { ios: {}, android: {} }, metrics: { ios: {}, android: {} }, errors: [] };
const apps = await readJson(APPS_FILE, { ios: {}, android: {} });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (msg) => { snap.errors.push(msg); console.warn('  !', msg); };

// ---------------------------------------------------------------- iOS
const IOS_FEED = { free: 'topfreeapplications', grossing: 'topgrossingapplications', paid: 'toppaidapplications' };
const IOS_GAMES_GENRE = 6014;

// Thống nhất tên thể loại giữa 2 store.
const GENRE_ALIAS = { 'Role-Playing': 'Role Playing', Roleplaying: 'Role Playing', Educational: 'Education' };
const normGenre = (g) => (g ? GENRE_ALIAS[g] ?? g : g);

// Thể loại con của Games trên App Store có genreId 7001–7019.
function iosSubGenre(r) {
  const ids = r.genreIds ?? [];
  const i = ids.findIndex((id) => /^70\d\d$/.test(String(id)));
  return i >= 0 ? normGenre(r.genres?.[i]) : undefined;
}

async function collectIos() {
  const countries = cfg.countries.filter((c) => !cfg.ios.exclude.includes(c.cc));
  for (const { cc } of countries) {
    snap.ranks.ios[cc] = {};
    const ids = new Set();
    for (const chart of cfg.charts) {
      const url = `https://itunes.apple.com/${cc}/rss/${IOS_FEED[chart]}/limit=${cfg.limit}/genre=${IOS_GAMES_GENRE}/json`;
      try {
        const j = await retry(() => fetchJson(url), { label: `ios ${cc} ${chart}` });
        let entries = j.feed?.entry ?? [];
        if (!Array.isArray(entries)) entries = [entries];
        snap.ranks.ios[cc][chart] = entries.map((e) => {
          const id = e.id.attributes['im:id'];
          ids.add(id);
          const prev = apps.ios[id] ?? {};
          apps.ios[id] = {
            ...prev,
            n: prev.n ?? e['im:name']?.label,
            d: prev.d ?? e['im:artist']?.label,
            i: prev.i ?? e['im:image']?.at(-1)?.label,
          };
          return id;
        });
      } catch (e) {
        fail(e.message);
      }
      await sleep(300);
    }

    // Lookup theo từng storefront: lấy số đánh giá (proxy cho lượt tải) + thể loại con.
    snap.metrics.ios[cc] = {};
    const list = [...ids];
    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100);
      const url = `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=${cc}&lang=en_us&entity=software`;
      try {
        const j = await retry(() => fetchJson(url), { label: `ios lookup ${cc}` });
        for (const r of j.results ?? []) {
          const id = String(r.trackId);
          snap.metrics.ios[cc][id] = r.userRatingCount ?? 0;
          const prev = apps.ios[id] ?? {};
          apps.ios[id] = {
            ...prev,
            n: cc === 'us' || !prev.n ? r.trackName : prev.n,
            d: r.artistName ?? prev.d,
            i: r.artworkUrl100 ?? prev.i,
            g: iosSubGenre(r) ?? prev.g ?? 'Games',
            rd: (r.releaseDate ?? '').slice(0, 10) || prev.rd,
          };
        }
      } catch (e) {
        fail(e.message);
      }
      await sleep(1500); // Apple giới hạn khoảng 20 request/phút cho Search/Lookup API
    }
    log(`ios ${cc}: ${cfg.charts.map((c) => `${c}=${snap.ranks.ios[cc][c]?.length ?? 0}`).join(' ')}`);
  }
}

// ---------------------------------------------------------------- Android
const GP_COLLECTION = {
  free: gplay.collection.TOP_FREE,
  grossing: gplay.collection.GROSSING,
  paid: gplay.collection.TOP_PAID,
};

async function collectAndroid() {
  const countries = cfg.countries.filter((c) => !cfg.android.exclude.includes(c.cc));
  const detailCandidates = new Map(); // appId -> country đầu tiên thấy (để fallback khi app khóa vùng)

  for (const { cc } of countries) {
    snap.ranks.android[cc] = {};
    for (const chart of cfg.charts) {
      try {
        const list = await retry(
          () => gplay.list({ collection: GP_COLLECTION[chart], category: gplay.category.GAME, country: cc, lang: 'en', num: cfg.limit }),
          { label: `android ${cc} ${chart}` },
        );
        snap.ranks.android[cc][chart] = list.map((a, idx) => {
          const prev = apps.android[a.appId] ?? {};
          apps.android[a.appId] = { ...prev, n: prev.n ?? a.title, d: a.developer ?? prev.d, i: a.icon ?? prev.i };
          if (idx < cfg.android.detailTopN && !detailCandidates.has(a.appId)) detailCandidates.set(a.appId, cc);
          return a.appId;
        });
      } catch (e) {
        fail(e.message);
      }
      await sleep(500);
    }
    log(`android ${cc}: ${cfg.charts.map((c) => `${c}=${snap.ranks.android[cc][c]?.length ?? 0}`).join(' ')}`);
  }

  // Chi tiết app: số lượt cài thực tế (maxInstalls ≈ realInstalls) + số rating + thể loại con.
  const targets = [...detailCandidates].slice(0, cfg.android.detailMax);
  log(`android details: ${targets.length} apps`);
  let ok = 0;
  await pool(targets, cfg.android.concurrency, async ([appId, cc]) => {
    let d;
    for (const country of cc === 'us' ? ['us'] : ['us', cc]) {
      try {
        d = await retry(() => gplay.app({ appId, lang: 'en', country }), { tries: 2, label: appId });
        break;
      } catch { /* thử country tiếp theo */ }
    }
    if (!d) return;
    ok++;
    snap.metrics.android[appId] = { inst: d.maxInstalls ?? d.minInstalls ?? null, rt: d.ratings ?? null };
    const prev = apps.android[appId] ?? {};
    apps.android[appId] = {
      ...prev,
      n: d.title ?? prev.n,
      d: d.developer ?? prev.d,
      i: d.icon ?? prev.i,
      g: normGenre(d.genre) ?? prev.g ?? 'Games',
      rd: d.released ? new Date(d.released).toISOString().slice(0, 10) : prev.rd,
    };
    await sleep(150);
  });
  log(`android details ok: ${ok}/${targets.length}`);
  if (ok < targets.length * 0.5) fail(`android details: chỉ lấy được ${ok}/${targets.length}`);
}

// ---------------------------------------------------------------- main
log(`collect ${date}`);
if (only !== 'android') await collectIos();
if (only !== 'ios') await collectAndroid();

if (only) {
  // Chạy riêng 1 store: giữ lại dữ liệu store kia nếu hôm nay đã thu thập.
  const other = only === 'ios' ? 'android' : 'ios';
  const existing = await readSnapshot(date).catch(() => null);
  if (existing) {
    snap.ranks[other] = existing.ranks[other];
    snap.metrics[other] = existing.metrics[other];
  }
}

const totalCharts = Object.values(snap.ranks).flatMap((s) => Object.values(s).flatMap((c) => Object.values(c))).length;
if (totalCharts === 0) {
  console.error('Không lấy được bảng xếp hạng nào, không ghi dữ liệu.');
  process.exit(1);
}
await writeSnapshot(snap);
await writeJson(APPS_FILE, apps);
log(`done: ${totalCharts} charts, ${snap.errors.length} lỗi`);
process.exit(0); // google-play-scraper có thể giữ socket mở
