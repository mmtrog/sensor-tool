// Thu thập bảng xếp hạng game hằng ngày từ App Store (RSS chính chủ Apple) và Google Play (scrape),
// gồm bảng tất cả game + bảng theo từng thể loại, kèm ảnh store listing.
// Kết quả: data/daily/YYYY-MM-DD.json.gz (thứ hạng + chỉ số), data/apps.json (thông tin app),
//          data/listings.json (screenshot/video hiện tại + các bộ ảnh cũ).
import gplay from 'google-play-scraper';
import {
  loadConfig, today, sleep, retry, pool, fetchJson, readJson, writeJson, writeSnapshot, readSnapshot,
  chartKeys, APPS_FILE, LISTINGS_FILE,
} from './lib.mjs';

const cfg = await loadConfig();
const date = process.env.DATE || today();
const only = process.env.STORE; // "ios" | "android" | undefined (cả hai)
const LISTING_HISTORY = 5;

const snap = { date, ranks: { ios: {}, android: {} }, metrics: { ios: {}, android: {} }, errors: [] };
const apps = await readJson(APPS_FILE, { ios: {}, android: {} });
const listings = await readJson(LISTINGS_FILE, { ios: {}, android: {} });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (msg) => { snap.errors.push(msg); console.warn('  !', msg); };
const limitFor = (ck) => (ck.genre ? cfg.genres.limit : cfg.limit);

// Thống nhất tên thể loại giữa 2 store.
const GENRE_ALIAS = { 'Role-Playing': 'Role Playing', Roleplaying: 'Role Playing', Education: 'Educational' };
const normGenre = (g) => (g ? GENRE_ALIAS[g] ?? g : g);

/** Cập nhật ảnh listing; nếu bộ ảnh đổi thì đẩy bộ cũ vào lịch sử. */
function updateListing(store, id, data) {
  if (!data.s?.length) return;
  const prev = listings[store][id];
  if (!prev) {
    listings[store][id] = { ...data, t: date, h: [] };
    return;
  }
  const changed = prev.s.join('|') !== data.s.join('|');
  listings[store][id] = {
    ...prev,
    ...data,
    t: changed ? date : prev.t,
    h: changed ? [{ t: prev.t, s: prev.s }, ...(prev.h ?? [])].slice(0, LISTING_HISTORY) : prev.h ?? [],
  };
}

// ---------------------------------------------------------------- iOS
const IOS_FEED = { free: 'topfreeapplications', grossing: 'topgrossingapplications', paid: 'toppaidapplications' };
const IOS_GAMES = 6014;

// Thể loại con của Games trên App Store có genreId 7001–7019.
function iosSubGenre(r) {
  const ids = r.genreIds ?? [];
  const i = ids.findIndex((id) => /^70\d\d$/.test(String(id)));
  return i >= 0 ? normGenre(r.genres?.[i]) : undefined;
}

async function collectIos() {
  const countries = cfg.countries.filter((c) => !cfg.ios.exclude.includes(c.cc));
  const charts = chartKeys(cfg, 'ios');
  const listingDone = new Set(); // mỗi app chỉ lấy listing ở storefront đầu tiên (US trước) để tránh nhảy qua lại giữa các bản địa hoá

  for (const { cc } of countries) {
    snap.ranks.ios[cc] = {};
    const ids = new Set();
    for (const ck of charts) {
      const url = `https://itunes.apple.com/${cc}/rss/${IOS_FEED[ck.chart]}/limit=${limitFor(ck)}/genre=${ck.genre?.id ?? IOS_GAMES}/json`;
      try {
        const j = await retry(() => fetchJson(url), { label: `ios ${cc} ${ck.key}`, base: 3000 });
        let entries = j.feed?.entry ?? [];
        if (!Array.isArray(entries)) entries = [entries];
        snap.ranks.ios[cc][ck.key] = entries.map((e) => {
          const id = e.id.attributes['im:id'];
          ids.add(id);
          const prev = apps.ios[id] ?? {};
          apps.ios[id] = { ...prev, n: prev.n ?? e['im:name']?.label, d: prev.d ?? e['im:artist']?.label, i: prev.i ?? e['im:image']?.at(-1)?.label };
          return id;
        });
      } catch (e) {
        fail(e.message);
      }
      await sleep(200);
    }

    // Lookup theo từng storefront: số đánh giá (proxy cho lượt tải), thể loại con, screenshot.
    snap.metrics.ios[cc] = {};
    const list = [...ids];
    for (let i = 0; i < list.length; i += 150) {
      const batch = list.slice(i, i + 150);
      const url = `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=${cc}&lang=en_us&entity=software`;
      try {
        const j = await retry(() => fetchJson(url), { label: `ios lookup ${cc}`, base: 5000 });
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
          if (!listingDone.has(id)) {
            const shots = r.screenshotUrls?.length ? r.screenshotUrls : r.ipadScreenshotUrls ?? [];
            if (shots.length) {
              listingDone.add(id);
              updateListing('ios', id, { s: shots, cc, ver: r.version, vd: (r.currentVersionReleaseDate ?? '').slice(0, 10) });
            }
          }
        }
      } catch (e) {
        fail(e.message);
      }
      await sleep(2000); // Apple giới hạn khoảng 20 request/phút cho Lookup API
    }
    log(`ios ${cc}: ${Object.keys(snap.ranks.ios[cc]).length} bảng, ${list.length} app`);
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
  const charts = chartKeys(cfg, 'android');
  const detailCandidates = new Map(); // appId -> country đầu tiên thấy (để fallback khi app khóa vùng)

  for (const { cc } of countries) {
    snap.ranks.android[cc] = {};
    for (const ck of charts) {
      try {
        const list = await retry(
          () => gplay.list({
            collection: GP_COLLECTION[ck.chart], category: ck.genre?.id ?? gplay.category.GAME, country: cc, lang: 'en', num: limitFor(ck),
          }),
          { label: `android ${cc} ${ck.key}` },
        );
        const topN = ck.genre ? cfg.android.genreDetailTopN : cfg.android.detailTopN;
        snap.ranks.android[cc][ck.key] = list.map((a, idx) => {
          const prev = apps.android[a.appId] ?? {};
          apps.android[a.appId] = { ...prev, n: prev.n ?? a.title, d: a.developer ?? prev.d, i: a.icon ?? prev.i };
          if (idx < topN && !detailCandidates.has(a.appId)) detailCandidates.set(a.appId, cc);
          return a.appId;
        });
      } catch (e) {
        // Bảng rỗng (vd. Trivia Grossing ở vài nước) làm thư viện ném lỗi nội bộ — coi là bảng trống.
        if (/fantasy-land/.test(e.message)) snap.ranks.android[cc][ck.key] = [];
        else fail(e.message);
      }
      await sleep(250);
    }
    log(`android ${cc}: ${Object.keys(snap.ranks.android[cc]).length} bảng`);
  }

  // Chi tiết app: lượt cài thực tế (maxInstalls ≈ realInstalls), thể loại, screenshot/video.
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
    updateListing('android', appId, {
      s: d.screenshots ?? [],
      hd: d.headerImage ?? undefined,
      vid: d.video ?? undefined,
      sum: d.summary ?? undefined,
      ver: d.version ?? undefined,
      vd: d.updated ? new Date(d.updated).toISOString().slice(0, 10) : undefined,
    });
    await sleep(150);
  });
  log(`android details ok: ${ok}/${targets.length}`);
  if (ok < targets.length * 0.5) fail(`android details: chỉ lấy được ${ok}/${targets.length}`);
}

// ---------------------------------------------------------------- main
log(`collect ${date}`);
// 2 store khác host nên chạy song song để rút ngắn thời gian.
await Promise.all([
  only !== 'android' ? collectIos() : null,
  only !== 'ios' ? collectAndroid() : null,
]);

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
await writeJson(LISTINGS_FILE, listings, true); // xuống dòng theo app để git lưu diff nhỏ giữa các ngày
log(`done: ${totalCharts} bảng, ${snap.errors.length} lỗi`);
process.exit(0); // google-play-scraper có thể giữ socket mở
