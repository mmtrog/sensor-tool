const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat('vi-VN');
const cf = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const GLOBAL_TOP = 200;

const state = { store: 'ios', region: 'global', chart: 'free', view: 'top', genre: '', q: '' };
const sortState = { key: null, dir: 'asc' };
let index, apps, current, histChart;
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

  $('#tbl thead').innerHTML = `<tr>
    ${thSort('rank', '#', 'num')}
    ${thSort('d1', '1 ngày', 'num hide-sm')}
    ${thSort('d7', '7 ngày', 'num')}
    <th>Game</th>
    <th class="hide-sm">Thể loại</th>
    ${isGlobal ? '<th>Quốc gia lọt top</th>' : ''}
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
        <div class="t">${esc(a.n ?? r.id)}${r.isNew ? '<span class="badge">MỚI</span>' : ''}${hot ? '<span class="badge hot">HOT</span>' : ''}</div>
        <div class="d">${esc(a.d)}</div></div></div></td>
      <td class="hide-sm"><span class="genre-pill">${esc(a.g ?? '—')}</span></td>
      ${ccs}
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
    </div>
    ${isGlobal ? `<div class="ccs d-ccs">${r.countries.map(([cc, k]) => `<span class="cc ${k <= 10 ? 'top10' : ''}">${esc(countryName(cc))} <b>#${k}</b></span>`).join('')}</div>` : ''}`;

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
      ${l.hd ? `<a href="${esc(imgUrl(l.hd, store, true))}" target="_blank" rel="noopener"><img class="header-img" loading="lazy" src="${esc(imgUrl(l.hd, store, false))}" alt=""></a>` : ''}
      ${shotsHtml(l.s, store)}
      ${(l.h ?? []).map((h) => `<details class="old-set"><summary>Bộ ảnh cũ (từ ${esc(h.t)})</summary>${shotsHtml(h.s, store)}</details>`).join('')}`;
  } catch {
    box.innerHTML = '<h3>Ảnh store listing</h3><p class="hint">Không tải được ảnh.</p>';
  }
}

// ---------------------------------------------------------------- controls
function syncControls() {
  for (const k of ['store', 'chart', 'view']) {
    document.querySelectorAll(`#${k} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === state[k]));
  }
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
    if (id === 'view') { syncControls(); writeHash(); render(); } else load();
  });
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
  $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; writeHash(); render(); }, 150); });
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
