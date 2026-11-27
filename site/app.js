const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat('vi-VN');
const cf = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const GLOBAL_TOP = 200;

const state = { store: 'ios', region: 'global', chart: 'free', view: 'top', genre: '', q: '' };
const sortState = { key: null, dir: 'asc' };
let index, apps, taptapData, current, histChart;
const cache = new Map();

// ---------------------------------------------------------------- theme
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gt_theme', theme);
}
function initTheme() {
  const saved = localStorage.getItem('gt_theme');
  const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (sysDark ? 'dark' : 'light'));
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    if ($('#detail').open && $('#detail').dataset.id) {
      openDetail($('#detail').dataset.id);
    }
  });
}

// ---------------------------------------------------------------- data
async function getJson(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    }));
  }
  return cache.get(url);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(state)) if (p.has(k)) state[k] = p.get(k);
}
function writeHash() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) p.set(k, v);
  history.replaceState(null, '', `#${p}`);
}

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const appOf = (id) => apps[state.store][id] ?? {};
const storeUrl = (id, cc) => state.store === 'ios'
  ? `https://apps.apple.com/${cc === 'global' ? 'us' : cc}/app/id${id}`
  : `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const metricName = () => (state.store === 'ios' ? 'đánh giá' : 'lượt cài');
const countryName = (cc) => index.countries.find((c) => c.cc === cc)?.name ?? cc.toUpperCase();

function deltaHtml(d, isEntry) {
  if (isEntry) return '<span class="up" title="Không có trong top kỳ trước">▲ mới</span>';
  if (d == null) return '<span class="flat">—</span>';
  if (d > 0) return `<span class="up">▲ ${d}</span>`;
  if (d < 0) return `<span class="down">▼ ${-d}</span>`;
  return '<span class="flat">=</span>';
}
const growthHtml = (g) => (g == null ? '<span class="flat">—</span>' : g > 0 ? `<span class="up">+${cf.format(g)}</span>` : cf.format(g));

const COUNTRY_DL_SCALE = {
  us: 1, jp: 0.55, cn: 0.9, kr: 0.38, gb: 0.28, de: 0.26, fr: 0.22, ca: 0.16, au: 0.14,
  tw: 0.18, hk: 0.08, br: 0.42, mx: 0.25, tr: 0.22, sa: 0.15, in: 0.65, id: 0.35,
  th: 0.2, vn: 0.22, ph: 0.18, my: 0.12, sg: 0.07,
};
const COUNTRY_REV_SCALE = {
  us: 1, jp: 0.72, cn: 0.85, kr: 0.42, gb: 0.22, de: 0.2, fr: 0.15, ca: 0.14, au: 0.12,
  tw: 0.2, hk: 0.09, br: 0.08, mx: 0.06, tr: 0.06, sa: 0.12, in: 0.05, id: 0.07,
  th: 0.08, vn: 0.06, ph: 0.04, my: 0.05, sg: 0.07,
};

function estDaily(r) {
  if (state.chart === 'paid') return null;
  const isRev = state.chart === 'grossing';
  const base = isRev ? (state.store === 'ios' ? 1600000 : 1100000) : (state.store === 'ios' ? 95000 : 135000);
  const exp = isRev ? -0.78 : -0.72;
  const scales = isRev ? COUNTRY_REV_SCALE : COUNTRY_DL_SCALE;
  const genreMul = state.genre ? 0.35 : 1;
  if (state.region === 'global') {
    let sum = 0;
    for (const [cc, k] of r.countries ?? []) sum += base * (scales[cc] ?? 0.08) * (k ** exp);
    return Math.round(sum * genreMul);
  }
  return Math.round(base * (scales[state.region] ?? 0.08) * (r.rank ** exp) * genreMul);
}
const estHtml = (v) => {
  if (v == null) return '<span class="flat">—</span>';
  return state.chart === 'grossing' ? `~$${cf.format(v)}` : `~${cf.format(v)}`;
};
function rankBadge(rank) {
  if (rank <= 3) return `<span class="medal m${rank}">${rank}</span>`;
  return rank;
}

function sparkline(hist, max) {
  const pts = hist.map((r, i) => [i, r]).filter(([, r]) => r != null);
  if (pts.length < 2) return '<span class="flat">—</span>';
  const w = 96, h = 26, n = Math.max(hist.length - 1, 1);
  const coords = pts.map(([i, r]) => [
    ((i / n) * w).toFixed(1),
    (((r - 1) / Math.max(max - 1, 1)) * (h - 6) + 3).toFixed(1),
  ]);
  const lineD = coords.map(([x, y], k) => `${k ? 'L' : 'M'}${x},${y}`).join('');
  const areaD = `${lineD} L${coords.at(-1)[0]},${h} L${coords[0][0]},${h} Z`;
  const [lx, ly] = coords.at(-1);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path class="area" d="${areaD}"/>
    <path class="line" d="${lineD}"/>
    <circle class="dot" cx="${lx}" cy="${ly}" r="2.2"/>
  </svg>`;
}

// ---------------------------------------------------------------- views & sort
function chartLimit() { return current?.limit ?? GLOBAL_TOP; }
const genreLabel = () => index.genres[state.store].find((g) => g.key === state.genre)?.label;

function selectRows() {
  let rows = current.rows;
  const q = state.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => { const a = appOf(r.id); return `${a.n} ${a.d} ${r.id}`.toLowerCase().includes(q); });

  const L = chartLimit();
  switch (state.view) {
    case 'rising':
      rows = rows
        .filter((r) => r.n7 || r.d7 > 0)
        .map((r) => ({ r, s: r.n7 ? L + 1 - r.rank : r.d7 }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r);
      break;
    case 'new':
      rows = rows.filter((r) => r.isNew);
      break;
    case 'growth':
      rows = rows.filter((r) => (r.g7 ?? r.g1) != null).sort((a, b) => (b.g7 ?? b.g1) - (a.g7 ?? a.g1));
      break;
    default:
      rows = [...rows];
  }

  if (sortState.key) {
    const dir = sortState.dir === 'asc' ? 1 : -1;
    const val = (r) => {
      switch (sortState.key) {
        case 'rank': return r.rank;
        case 'd1': return r.d1 ?? -999999;
        case 'd7': return r.n7 ? L + 1 - r.rank : (r.d7 ?? -999999);
        case 'growth': return (r.g7 ?? r.g1) ?? -999999999;
        case 'total': return r.m ?? -1;
        default: return r.rank;
      }
    };
    rows.sort((a, b) => (val(a) - val(b)) * dir);
  }
  return rows;
}

function renderKpis(allRows, filteredRows) {
  const L = chartLimit();
  const newGames = allRows.filter((r) => r.isNew);
  const topMover = allRows
    .filter((r) => r.n7 || r.d7 > 0)
    .map((r) => ({ r, s: r.n7 ? L + 1 - r.rank : r.d7 }))
    .sort((a, b) => b.s - a.s)[0]?.r;
  const topGrowth = allRows
    .filter((r) => (r.g7 ?? r.g1) > 0)
    .sort((a, b) => (b.g7 ?? b.g1) - (a.g7 ?? a.g1))[0];

  const moverApp = topMover ? appOf(topMover.id) : null;
  const growthApp = topGrowth ? appOf(topGrowth.id) : null;

  $('#kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Đang theo dõi</div>
      <div class="kpi-val">${filteredRows.length}<span style="font-size:13px;color:var(--muted);font-weight:500"> / ${allRows.length}</span></div>
      <div class="kpi-sub">${state.region === 'global' ? 'Toàn cầu' : esc(countryName(state.region))} · ${state.chart === 'free' ? 'Top Free' : 'Top Grossing'}</div>
    </div>
    <div class="kpi clickable" id="kpiNew" title="Bấm để lọc game mới vào top">
      <div class="kpi-label">Mới vào Top (7n)</div>
      <div class="kpi-val" style="color:var(--new)">${newGames.length}</div>
      <div class="kpi-sub">${newGames.length ? `Mới nhất: <b>${esc(appOf(newGames[0].id).n ?? newGames[0].id)}</b>` : 'Chưa có game mới'}</div>
    </div>
    <div class="kpi ${topMover ? 'clickable' : ''}" id="kpiMover" data-id="${topMover ? esc(topMover.id) : ''}">
      <div class="kpi-label">Tăng hạng mạnh nhất</div>
      <div class="kpi-val">${topMover ? deltaHtml(topMover.d7, topMover.n7) : '—'}</div>
      <div class="kpi-sub">${moverApp ? `<b>#${topMover.rank}</b> ${esc(moverApp.n ?? topMover.id)}` : 'Cần thêm dữ liệu 7 ngày'}</div>
    </div>
    <div class="kpi ${topGrowth ? 'clickable' : ''}" id="kpiGrowth" data-id="${topGrowth ? esc(topGrowth.id) : ''}">
      <div class="kpi-label">Tăng ${metricName()} cao nhất</div>
      <div class="kpi-val">${topGrowth ? growthHtml(topGrowth.g7 ?? topGrowth.g1) : '—'}</div>
      <div class="kpi-sub">${growthApp ? `<b>#${topGrowth.rank}</b> ${esc(growthApp.n ?? topGrowth.id)}` : 'Chưa có dữ liệu tăng trưởng'}</div>
    </div>`;

  $('#kpiNew')?.addEventListener('click', () => {
    state.view = 'new';
    sortState.key = null;
    syncControls();
    writeHash();
    render();
  });
  $('#kpiMover')?.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.id;
    if (id) openDetail(id);
  });
  $('#kpiGrowth')?.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.id;
    if (id) openDetail(id);
  });
}

function hintText() {
  const days = index.days;
  const need = (n) => (days < n ? ` Cần ít nhất ${n} ngày dữ liệu (hiện có ${days}) để so sánh.` : '');
  const where = state.region === 'global' ? 'toàn cầu (gộp điểm các quốc gia theo trọng số)' : countryName(state.region);
  const what = state.genre ? `game ${genreLabel()}` : 'game';
  return {
    top: `Top ${chartLimit()} ${what} ${where}.${need(2)}`,
    rising: `Game tăng hạng nhiều nhất so với 7 ngày trước, gồm cả game mới lọt vào top.${need(8)}`,
    new: `Game có mặt hôm nay nhưng không xuất hiện trong top ở bất kỳ ngày nào trong 7 ngày trước.${need(2)}`,
    growth: `Sắp theo số ${metricName()} tăng thêm trong 7 ngày (hoặc 1 ngày nếu chưa đủ 7).${need(2)}`,
  }[state.view];
}

function thSort(key, label, cls = 'num') {
  const active = sortState.key === key;
  const arrow = active ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<th class="${cls} sortable ${active ? 'sorted' : ''}" data-sort="${key}">${label}${arrow}</th>`;
}

function render() {
  const isGlobal = state.region === 'global';
  const growthLabel = state.store === 'ios' ? 'Đánh giá +7n' : 'Lượt cài +7n';
  $('#growthTab').textContent = state.store === 'ios' ? 'Tăng đánh giá' : 'Tăng lượt cài';

  const estLabel = state.chart === 'grossing' ? 'Est. Rev/ngày' : 'Est. DL/ngày';
  $('#tbl thead').innerHTML = `<tr>
    ${thSort('rank', '#', 'num')}
    ${thSort('d1', '1 ngày', 'num hide-sm')}
    ${thSort('d7', '7 ngày', 'num')}
    <th>Game</th>
    <th class="hide-sm">Thể loại</th>
    ${isGlobal ? '<th>Quốc gia lọt top</th>' : ''}
    ${state.chart !== 'paid' ? `<th class="num hide-sm" title="Ước tính theo mô hình Power-law">${estLabel}</th>` : ''}
    ${thSort('growth', growthLabel, 'num')}
    ${thSort('total', `Tổng ${metricName()}`, 'num hide-sm')}
    <th class="hide-sm">Hạng ${index.days} ngày</th>
  </tr>`;

  const rows = selectRows();
  renderKpis(current.rows, rows);
  $('#rowCount').textContent = `${rows.length} game`;

  const L = chartLimit();
  $('#tbl tbody').innerHTML = rows.map((r) => {
    const a = appOf(r.id);
    const hot = !r.isNew && r.d7 >= 20 && r.rank <= 50;
    const ccs = isGlobal
      ? `<td><div class="ccs"><span class="cc"><b>${r.countries.length}</b> nước</span>${r.countries.slice(0, 6).map(([cc, k]) => `<span class="cc ${k <= 10 ? 'top10' : ''}" title="${esc(countryName(cc))}">${cc.toUpperCase()} <b>#${k}</b></span>`).join('')}</div></td>`
      : '';
    return `<tr data-id="${esc(r.id)}">
      <td class="num rank">${rankBadge(r.rank)}</td>
      <td class="num hide-sm">${deltaHtml(r.d1, false)}</td>
      <td class="num">${deltaHtml(r.d7, r.n7)}</td>
      <td><div class="game"><img loading="lazy" src="${esc(a.i)}" alt=""><div>
        <div class="t">${esc(a.n ?? r.id)}${r.isNew ? '<span class="badge">MỚI</span>' : ''}${hot ? '<span class="badge hot">HOT</span>' : ''}${a.sc ? `<span class="score-pill">★ ${a.sc}</span>` : ''}</div>
        <div class="d">${esc(a.d)}${a.iap ? ` · IAP ${esc(a.iap)}` : ''}${a.ads === 1 ? ' · Ads' : ''}${a.gads?.c ? ` · 📢 ${a.gads.c} Google Ads` : ''}</div></div></div></td>
      <td class="hide-sm"><span class="genre-pill">${esc(a.g ?? '—')}</span></td>
      ${ccs}
      ${state.chart !== 'paid' ? `<td class="num hide-sm" title="Ước tính">${estHtml(estDaily(r))}</td>` : ''}
      <td class="num">${growthHtml(r.g7 ?? r.g1)}</td>
      <td class="num hide-sm">${r.m == null ? '—' : cf.format(r.m)}</td>
      <td class="hide-sm">${sparkline(r.hist, L)}</td>
    </tr>`;
  }).join('');
  $('#empty').hidden = rows.length > 0;
  $('#hint').textContent = hintText();
}

// ---------------------------------------------------------------- export CSV
function exportCsv() {
  if (!current?.rows?.length) return;
  const rows = selectRows();
  const headers = ['Rank', '1d_Delta', '7d_Delta', 'App_ID', 'Title', 'Developer', 'Genre', 'Growth_7d', 'Total_Metric', 'Store_URL'];
  const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((r) => {
      const a = appOf(r.id);
      return [
        r.rank,
        r.d1 ?? '',
        r.n7 ? 'NEW' : (r.d7 ?? ''),
        r.id,
        a.n ?? r.id,
        a.d ?? '',
        a.g ?? '',
        r.g7 ?? r.g1 ?? '',
        r.m ?? '',
        storeUrl(r.id, state.region),
      ].map(csvEsc).join(',');
    }),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `game-trends_${state.store}_${state.region}_${state.chart}_${index.date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- detail
function openDetail(id) {
  const r = current.rows.find((x) => x.id === id);
  if (!r) return;
  const a = appOf(id);
  const isGlobal = state.region === 'global';
  $('#dlgTag').textContent = `${state.store === 'ios' ? 'App Store' : 'Google Play'} · ${isGlobal ? 'Toàn cầu' : countryName(state.region)}`;
  $('#detailBody').innerHTML = `
    <div class="d-head">
      <img src="${esc(a.i)}" alt="">
      <div>
        <h2>${esc(a.n ?? id)}</h2>
        <div class="d-sub">${esc(a.d)} · ${esc(a.g ?? '—')}${a.rd ? ` · phát hành ${esc(a.rd)}` : ''}</div>
        <a class="store-link" href="${storeUrl(id, state.region)}" target="_blank" rel="noopener">Mở trên ${state.store === 'ios' ? 'App Store' : 'Google Play'} ↗</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Hạng ${isGlobal ? 'toàn cầu' : countryName(state.region)}</div><div class="v">#${r.rank}</div></div>
      <div class="stat"><div class="k">So với 7 ngày</div><div class="v">${deltaHtml(r.d7, r.n7)}</div></div>
      <div class="stat"><div class="k">Tổng ${metricName()}</div><div class="v">${r.m == null ? '—' : nf.format(r.m)}</div></div>
      <div class="stat"><div class="k">${cap(metricName())} +1 ngày</div><div class="v">${growthHtml(r.g1)}</div></div>
      <div class="stat"><div class="k">${cap(metricName())} +7 ngày</div><div class="v">${growthHtml(r.g7)}</div></div>
      ${a.sc ? `<div class="stat"><div class="k">Điểm đánh giá</div><div class="v" style="color:#f59e0b">★ ${a.sc}</div></div>` : ''}
      ${a.iap ? `<div class="stat"><div class="k">Gói nạp IAP</div><div class="v" style="font-size:14px">${esc(a.iap)}</div></div>` : ''}
      ${a.ads != null ? `<div class="stat"><div class="k">Quảng cáo</div><div class="v" style="font-size:14px">${a.ads ? 'Có Ads' : 'Không Ads'}</div></div>` : ''}
      ${a.sz ? `<div class="stat"><div class="k">Dung lượng</div><div class="v" style="font-size:15px">${a.sz} MB</div></div>` : ''}
      ${state.chart !== 'paid' ? `<div class="stat"><div class="k">${state.chart === 'grossing' ? 'Est. Rev/ngày' : 'Est. DL/ngày'}</div><div class="v" style="font-size:15px;color:var(--accent)">${estHtml(estDaily(r))}</div></div>` : ''}
    </div>
    ${a.nets?.length ? `<div class="nets"><span class="spy-label">app-ads.txt:</span>${a.nets.map((n) => `<span class="net-chip">${esc(n)}</span>`).join('')}</div>` : ''}
    <div class="spy-bar">
      <span class="spy-label">Ad Spy:</span>
      <a class="spy-btn" href="https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(a.n ?? id)}" target="_blank" rel="noopener">Meta Ad Library ↗</a>
      <a class="spy-btn" href="${a.gads?.id ? `https://adstransparency.google.com/advertiser/${encodeURIComponent(a.gads.id)}?region=anywhere` : `https://adstransparency.google.com/?region=anywhere&text=${encodeURIComponent(a.d ?? a.n ?? id)}`}" target="_blank" rel="noopener">Google Ads${a.gads?.c ? ` (${a.gads.c} ads)` : ' Transparency'} ↗</a>
      <a class="spy-btn" href="https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?keyword=${encodeURIComponent(a.n ?? id)}" target="_blank" rel="noopener">TikTok Top Ads ↗</a>
    </div>
    ${isGlobal ? `<div class="ccs d-ccs">${r.countries.map(([cc, k]) => `<span class="cc ${k <= 10 ? 'top10' : ''}">${esc(countryName(cc))} <b>#${k}</b></span>`).join('')}</div>` : ''}`;

  $('.chart-panel').hidden = false;
  const dlg = $('#detail');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  dlg.dataset.id = id;
  renderListing(id, a);
  if (!window.Chart) return;
  histChart?.destroy();
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim();
  const muted = css.getPropertyValue('--muted').trim();
  const line = css.getPropertyValue('--line').trim();
  const canvas = $('#histChart');
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, css.getPropertyValue('--accent-soft').trim());
  grad.addColorStop(1, 'transparent');

  histChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: current.dates,
      datasets: [{
        label: 'Hạng',
        data: r.hist,
        spanGaps: false,
        tension: 0.3,
        fill: true,
        backgroundColor: grad,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderColor: accent,
        pointBackgroundColor: accent,
      }],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        y: {
          reverse: true,
          min: 1,
          suggestedMax: Math.min(chartLimit(), Math.max(...r.hist.filter(Boolean)) + 5),
          ticks: { precision: 0, color: muted },
          grid: { color: line },
        },
        x: { ticks: { color: muted, maxRotation: 0, autoSkip: true }, grid: { display: false } },
      },
    },
  });
}

// ---------------------------------------------------------------- store listing
// Đổi kích thước ảnh qua URL: Apple (mzstatic) dùng hậu tố /WxHbb.jpg, Google dùng =wN / =hN.
function imgUrl(u, store, big) {
  if (store === 'ios') return u.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/, big ? '/2000x2000bb.jpg' : '/0x480h.jpg');
  return `${u.replace(/=[whs]\d+.*$/, '')}=${big ? 'h1600' : 'h400'}`;
}
const ytWatch = (u) => { const m = u?.match(/embed\/([\w-]+)/); return m ? `https://www.youtube.com/watch?v=${m[1]}` : u; };

function shotsHtml(shots, store) {
  return `<div class="shots">${shots.map((s) => `<a href="${esc(imgUrl(s, store, true))}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(imgUrl(s, store, false))}" alt=""></a>`).join('')}</div>`;
}

function histogramHtml(hist) {
  if (!hist || typeof hist !== 'object') return '';
  const stars = [5, 4, 3, 2, 1];
  const total = stars.reduce((s, k) => s + (hist[k] ?? 0), 0);
  if (!total) return '';
  return `<div class="hist-bars">${stars.map((k) => {
    const c = hist[k] ?? 0;
    const pct = ((c / total) * 100).toFixed(1);
    return `<div class="hist-row"><span>${k}★</span><div class="hist-track"><div class="hist-fill" style="width:${pct}%"></div></div><span class="num">${cf.format(c)}</span></div>`;
  }).join('')}</div>`;
}

async function renderListing(id, a) {
  const box = $('#listing');
  const store = state.store;
  if (!a.ls) {
    box.innerHTML = `<h3>Ảnh store listing</h3><p class="hint">Chưa có ảnh cho game này${store === 'android' ? ' (Android chỉ lấy chi tiết cho các game top đầu mỗi bảng)' : ''}.</p>`;
    return;
  }
  box.innerHTML = '<h3>Ảnh store listing</h3><p class="hint">Đang tải…</p>';
  try {
    const l = await getJson(`data/listing/${store}/${encodeURIComponent(id)}.json`);
    if ($('#detail').dataset.id !== id) return;
    const meta = [
      l.ver && `Phiên bản ${esc(l.ver)}`,
      l.vd && `cập nhật ${esc(l.vd)}`,
      `bộ ảnh này từ ${esc(l.t)}`,
      store === 'ios' && l.cc && `storefront ${esc(l.cc.toUpperCase())}`,
    ].filter(Boolean).join(' · ');
    box.innerHTML = `
      <h3>Ảnh store listing</h3>
      <p class="hint">${meta}${l.vid ? ` · <a href="${esc(ytWatch(l.vid))}" target="_blank" rel="noopener">Xem video ↗</a>` : ''}</p>
      ${l.sum ? `<p class="summary">${esc(l.sum)}</p>` : ''}
      ${l.rn ? `<details class="old-set"><summary>What's New (Ghi chú cập nhật)</summary><div class="rel-notes">${esc(l.rn)}</div></details>` : ''}
      ${histogramHtml(l.hist)}
      ${l.hd ? `<a href="${esc(imgUrl(l.hd, store, true))}" target="_blank" rel="noopener"><img class="header-img" loading="lazy" src="${esc(imgUrl(l.hd, store, false))}" alt=""></a>` : ''}
      ${shotsHtml(l.s, store)}
      ${(l.h ?? []).map((h) => `<details class="old-set"><summary>Bộ ảnh cũ (từ ${esc(h.t)})</summary>${shotsHtml(h.s, store)}</details>`).join('')}`;
  } catch {
    box.innerHTML = '<h3>Ảnh store listing</h3><p class="hint">Không tải được ảnh.</p>';
  }
}

// ---------------------------------------------------------------- TapTap CN
const TAPTAP_TABS = { top: ['hot', 'Top Hot China'], rising: ['reserve', 'Pre-register (Sắp ra mắt)'], new: ['new', 'Mới ra mắt'] };

function renderTapTap() {
  const [listKey, label] = TAPTAP_TABS[state.view] ?? TAPTAP_TABS.top;
  let rows = taptapData?.lists?.[listKey] ?? [];
  const q = state.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => `${r.title} ${r.bundleId ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(q));

  $('#kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">TapTap China</div><div class="kpi-val">${rows.length}</div><div class="kpi-sub">${label}</div></div>
    <div class="kpi"><div class="kpi-label">Cập nhật</div><div class="kpi-val" style="font-size:16px">${esc(taptapData?.date ?? '—')}</div><div class="kpi-sub">Nguồn: taptap.cn</div></div>
    <div class="kpi"><div class="kpi-label">Điểm cao nhất</div><div class="kpi-val" style="color:#f59e0b">${rows.length ? `★ ${Math.max(...rows.map((r) => r.score ?? 0)).toFixed(1)}` : '—'}</div><div class="kpi-sub">Đánh giá cộng đồng TapTap</div></div>
    <div class="kpi"><div class="kpi-label">Cross-store</div><div class="kpi-val">${rows.filter((r) => r.iosId || r.bundleId).length}</div><div class="kpi-sub">Game có ID App Store / Play</div></div>`;

  $('#rowCount').textContent = `${rows.length} game`;
  $('#hint').textContent = `Bảng xếp hạng ${label} trên TapTap Trung Quốc (${taptapData?.date ?? ''}). Bấm vào dòng để mở TapTap hoặc Ad Spy.`;
  $('#tbl thead').innerHTML = `<tr>
    <th class="num">#</th>
    <th>Game</th>
    <th class="hide-sm">Tag</th>
    <th class="num">Điểm TapTap</th>
    <th class="num hide-sm">Lượt quan tâm</th>
    <th>Liên kết</th>
  </tr>`;

  $('#tbl tbody').innerHTML = rows.map((r) => `
    <tr data-taptap="${esc(r.id)}">
      <td class="num rank">${rankBadge(r.rank)}</td>
      <td><div class="game"><img loading="lazy" src="${esc(r.icon)}" alt=""><div>
        <div class="t">${esc(r.title)}</div>
        <div class="d">${esc(r.bundleId ?? `TapTap #${r.id}`)}</div></div></div></td>
      <td class="hide-sm">${(r.tags ?? []).map((t) => `<span class="genre-pill">${esc(t)}</span> `).join('')}</td>
      <td class="num">${r.score ? `<span class="score-pill">★ ${r.score}</span>` : '—'}</td>
      <td class="num hide-sm">${r.hits ? cf.format(r.hits) : '—'}</td>
      <td>
        <a class="spy-btn" href="https://www.taptap.cn/app/${esc(r.id)}" target="_blank" rel="noopener">TapTap ↗</a>
        ${r.iosId ? `<a class="spy-btn" href="https://apps.apple.com/cn/app/id${esc(r.iosId)}" target="_blank" rel="noopener">iOS ↗</a>` : ''}
      </td>
    </tr>`).join('');
  $('#empty').hidden = rows.length > 0;
}

// ---------------------------------------------------------------- controls
function syncControls() {
  const isTapTap = state.store === 'taptap';
  for (const k of ['store', 'chart', 'view']) {
    document.querySelectorAll(`#${k} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === state[k]));
  }
  $('#taptapBtn').hidden = !index.hasTapTap;
  $('#region').hidden = isTapTap;
  $('#chart').hidden = isTapTap;
  $('#exportBtn').hidden = isTapTap;
  $('#growthTab').hidden = isTapTap;

  if (isTapTap) {
    if (!TAPTAP_TABS[state.view]) state.view = 'top';
    document.querySelector('#view [data-v="top"]').textContent = 'Top Hot CN';
    document.querySelector('#view [data-v="rising"]').textContent = 'Pre-register (Sắp ra)';
    document.querySelector('#view [data-v="new"]').textContent = 'Mới ra mắt';
    $('#genre').hidden = true;
    $('#q').value = state.q;
    return;
  }

  document.querySelector('#view [data-v="top"]').textContent = 'Bảng xếp hạng';
  document.querySelector('#view [data-v="rising"]').textContent = 'Đang lên (7 ngày)';
  document.querySelector('#view [data-v="new"]').textContent = 'Mới vào top';

  const regions = [{ cc: 'global', name: '🌍 Toàn cầu' }, ...index.countries.filter((c) => c.stores.includes(state.store))];
  if (!regions.some((r) => r.cc === state.region)) state.region = 'global';
  $('#region').innerHTML = regions.map((r) => `<option value="${r.cc}" ${r.cc === state.region ? 'selected' : ''}>${esc(r.name)}${r.cc === 'global' ? '' : ` (${r.cc.toUpperCase()})`}</option>`).join('');

  const genres = index.genres[state.store] ?? [];
  if (state.genre && !genres.some((g) => g.key === state.genre)) state.genre = '';
  $('#genre').innerHTML = `<option value="">Tất cả game</option>${genres.map((g) => `<option value="${g.key}" ${g.key === state.genre ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}`;
  $('#genre').hidden = !genres.length;
  $('#q').value = state.q;
}

async function load() {
  if ($('#detail').open) $('#detail').close();
  syncControls();
  writeHash();
  try {
    if (state.store === 'taptap') {
      taptapData = await getJson('data/taptap.json');
      renderTapTap();
      return;
    }
    current = await getJson(`data/${state.store}/${state.region}_${state.chart}_${state.genre || 'all'}.json`);
    render();
  } catch (e) {
    $('#tbl tbody').innerHTML = '';
    $('#kpis').innerHTML = '';
    $('#rowCount').textContent = '0 game';
    $('#empty').hidden = false;
    $('#empty').textContent = `Không có dữ liệu cho lựa chọn này (${e.message}).`;
  }
}

function bindSeg(id) {
  $(`#${id}`).addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v || v === state[id]) return;
    state[id] = v;
    sortState.key = null;
    if (id === 'view') {
      syncControls();
      writeHash();
      if (state.store === 'taptap') renderTapTap(); else render();
    } else load();
  });
}

async function openKeywords() {
  $('#dlgTag').textContent = 'ASO Hot Keywords · App Store US';
  $('.chart-panel').hidden = true;
  $('#listing').innerHTML = '';
  $('#detailBody').innerHTML = '<p class="hint">Đang tải từ khóa…</p>';
  const dlg = $('#detail');
  if (!dlg.open) dlg.showModal();
  try {
    const kw = await getJson('data/keywords.json');
    $('#detailBody').innerHTML = `
      <p class="hint" style="margin-top:0">Cập nhật ${esc(kw.date)} · Gợi ý tìm kiếm App Store kèm điểm phổ biến (priority score).</p>
      <div style="display:grid;gap:14px;padding-bottom:20px">
        ${Object.entries(kw.seeds ?? {}).map(([seed, list]) => `
          <div>
            <div class="spy-label" style="margin-bottom:6px">${esc(seed)}</div>
            <div class="ccs" style="max-width:none">
              ${list.map((x) => `<span class="cc">${esc(x.term)} <b>${x.score}</b></span>`).join('')}
            </div>
          </div>`).join('')}
      </div>`;
  } catch {
    $('#detailBody').innerHTML = '<p class="hint">Chưa có dữ liệu từ khóa.</p>';
  }
}

async function init() {
  initTheme();
  readHash();
  [index, apps] = await Promise.all([getJson('data/index.json'), getJson('data/apps.json')]);
  $('#meta').textContent = `Cập nhật ${index.date} · ${index.days} ngày lịch sử${index.errors.length ? ` · ${index.errors.length} lỗi thu thập` : ''}`;
  if (index.errors.length) $('#meta').title = index.errors.join('\n');

  ['store', 'chart', 'view'].forEach(bindSeg);
  $('#region').addEventListener('change', (e) => { state.region = e.target.value; sortState.key = null; load(); });
  $('#genre').addEventListener('change', (e) => { state.genre = e.target.value; sortState.key = null; load(); });
  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value;
      writeHash();
      if (state.store === 'taptap') renderTapTap(); else render();
    }, 150);
  });
  $('#tbl thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const k = th.dataset.sort;
    if (sortState.key === k) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    else { sortState.key = k; sortState.dir = k === 'rank' ? 'asc' : 'desc'; }
    render();
  });
  $('#tbl tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openDetail(tr.dataset.id); });
  $('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#exportBtn').addEventListener('click', exportCsv);
  $('#kwBtn').hidden = !index.hasKeywords;
  $('#kwBtn').addEventListener('click', openKeywords);
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#q') && !$('#detail').open) {
      e.preventDefault();
      $('#q').focus();
    } else if (e.key === 'Escape' && document.activeElement === $('#q')) {
      $('#q').blur();
    }
  });
  window.addEventListener('hashchange', () => { readHash(); load(); });
  await load();
}

init().catch((e) => { $('#meta').textContent = `Lỗi tải dữ liệu: ${e.message}`; });
