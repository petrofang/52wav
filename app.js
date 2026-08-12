(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const STORAGE_KEY = '52wav.completed.v1';
  const VIEW_KEY = '52wav.view';
  const SORT_KEY = '52wav.sort';
  const PATCH_TARGET = 52;

  const el = (id) => document.getElementById(id);
  const els = {
    cards: el('cards'),
    tableWrap: el('table-wrap'),
    tableBody: el('table-body'),
    search: el('search'),
    sort: el('sort'),
    range: el('range-filter'),
    county: el('county-filter'),
    difficulty: el('difficulty-filter'),
    land: el('land-filter'),
    filters: el('filters'),
    filtersToggle: el('filters-toggle'),
    filterCount: el('filter-count'),
    reset: el('reset'),
    resultCount: el('result-count'),
    sourceNote: el('source-note'),
    headline: el('progress-headline'),
    sub: el('progress-sub'),
    bar: el('progress-bar'),
    track: el('progress-track'),
    statCurrent: el('stat-current'),
    statRetired: el('stat-retired'),
    statMiles: el('stat-miles'),
    printBtn: el('print-btn'),
    shareBtn: el('share-btn'),
    saveHint: el('save-hint'),
    printBody: el('print-body'),
    printTicked: el('print-ticked'),
  };

  const state = {
    peaks: [],
    meta: {},
    completed: new Set(),
    query: '',
    range: '',
    county: '',
    difficulty: '',
    land: '',
    status: 'all',
    list: 'current',
    sortKey: 'name',
    sortDir: 'asc',
    view: 'cards',
  };

  const escapeHtml = (str) =>
    String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Matches how the Over the Hill Hikers alphabetise: "The Horn" files under H.
  const sortName = (p) => p.name.replace(/^The\s+/i, '').toLowerCase();

  // --- progress tokens ------------------------------------------------------
  // Format: 1<fingerprint>-<bitmask>. The fingerprint pins the token to the id
  // assignment that produced it, so a future renumbering is detected instead of
  // silently restoring the wrong peaks.

  function fingerprint(peaks) {
    let h = 0x811c9dc5;
    peaks
      .map((p) => `${p.id}:${p.name}`)
      .sort()
      .join('|')
      .split('')
      .forEach((ch) => {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 0x01000193) >>> 0;
      });
    return (h >>> 0).toString(36).slice(0, 4);
  }

  function toBase64Url(bytes) {
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(token) {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  }

  function encodeProgress(ids) {
    const max = ids.length ? Math.max(...ids) : 1;
    const bytes = new Uint8Array(Math.ceil(max / 8));
    ids.forEach((id) => { bytes[(id - 1) >> 3] |= 1 << ((id - 1) & 7); });
    return `1${fingerprint(state.peaks)}-${toBase64Url(bytes)}`;
  }

  function decodeProgress(token) {
    const m = /^1([a-z0-9]{1,4})-([A-Za-z0-9_-]+)$/.exec(token);
    if (!m) throw new Error('unrecognised progress link');
    const bytes = fromBase64Url(m[2]);
    const ids = [];
    for (let i = 0; i < bytes.length * 8; i += 1) {
      if (bytes[i >> 3] & (1 << (i & 7))) ids.push(i + 1);
    }
    return { ids, stale: m[1] !== fingerprint(state.peaks) };
  }

  function loadCompleted() {
    const hash = /^#p=(.+)$/.exec(location.hash);
    if (hash) {
      try {
        const { ids, stale } = decodeProgress(decodeURIComponent(hash[1]));
        if (stale) {
          showHint(
            '<strong>Heads up:</strong> this link was made from an older version of the peak list, ' +
            'so a few ticks may have shifted. Worth a quick check against your own records.',
            'amber'
          );
        }
        return new Set(ids);
      } catch {
        showHint('That progress link could not be read, so your ticks were left as they were.', 'amber');
      }
    }
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch {
      return new Set();
    }
  }

  function saveCompleted() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.completed]));
    } catch { /* private mode; progress stays for this session only */ }
  }

  function showHint(html, tone = 'emerald') {
    els.saveHint.className = tone === 'amber'
      ? 'mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900'
      : 'mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900';
    els.saveHint.innerHTML = html;
  }

  // --- filtering and sorting ------------------------------------------------

  const DIFFICULTY_ORDER = { Easier: 1, Medium: 2, Harder: 3 };

  function sortValue(p, key) {
    switch (key) {
      case 'elevation_ft': return p.elevation_ft;
      case 'round_trip_mi': return p.route?.round_trip_mi ?? Infinity;
      case 'gain_ft': return p.route?.gain_ft ?? Infinity;
      case 'difficulty': return DIFFICULTY_ORDER[p.route?.difficulty] ?? 99;
      case 'view_rating': return p.view_rating ?? -1;
      case 'name': return sortName(p);
      case 'land': return String(p.land?.owner_type ?? '').toLowerCase();
      default: return String(p[key] ?? '').toLowerCase();
    }
  }

  function visiblePeaks() {
    const q = state.query.trim().toLowerCase();
    const rows = state.peaks.filter((p) => {
      if (state.list !== 'all' && p.status !== state.list) return false;
      if (state.range && p.range !== state.range) return false;
      if (state.county && p.county !== state.county) return false;
      if (state.difficulty && p.route?.difficulty !== state.difficulty) return false;
      if (state.land && p.land?.owner_type !== state.land) return false;
      const done = state.completed.has(p.id);
      if (state.status === 'todo' && done) return false;
      if (state.status === 'completed' && !done) return false;
      if (!q) return true;
      return [p.name, p.range, p.town, p.county, p.notes, p.route?.name, p.trailhead?.name, p.land?.manager]
        .some((f) => String(f || '').toLowerCase().includes(q));
    });

    const dir = state.sortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = sortValue(a, state.sortKey);
      const bv = sortValue(b, state.sortKey);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return sortName(a).localeCompare(sortName(b));
    });
  }

  // --- shared bits ----------------------------------------------------------

  const mapsSearch = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  const mapsDirections = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;

  const DIFFICULTY_STYLE = {
    Easier: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    Medium: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    Harder: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  };

  const LAND_LABEL = {
    Federal: 'National forest',
    State: 'State land',
    Private: 'Private land — tread lightly',
  };

  const estMark = (r) => (r.derived
    ? '<span class="ml-0.5 text-amber-600" title="Measured from OpenStreetMap trail data and USGS elevations, not a published guidebook figure">est.</span>'
    : '');

  const viewStar = (p) => (p.view_rating_imputed
    ? '<span class="text-amber-600" title="Not yet rated; showing the median score of the rated peaks">*</span>'
    : '');

  const badge = (text, cls, title = '') =>
    `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</span>`;

  function statusBadge(p) {
    if (p.status === 'delisted') {
      return badge(`Retired ${p.delisted_year}`, 'bg-stone-100 text-stone-600 ring-stone-500/20',
        `Removed from the official list in ${p.delisted_year}, but it still counts toward the patch`);
    }
    if (p.added_year >= 2020) {
      return badge(`New in ${p.added_year}`, 'bg-emerald-50 text-emerald-700 ring-emerald-600/20');
    }
    return '';
  }

  // --- card view ------------------------------------------------------------

  function statBlock(value, label, note = '') {
    return `
      <div class="flex-1 text-center">
        <div class="font-display text-lg font-semibold leading-tight text-stone-900">${value}${note}</div>
        <div class="text-[11px] uppercase tracking-wide text-stone-400">${label}</div>
      </div>`;
  }

  function card(p) {
    const done = state.completed.has(p.id);
    const r = p.route || {};

    return `
      <article class="flex flex-col overflow-hidden rounded-2xl border ${done ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200 bg-white'} shadow-sm transition hover:shadow-md">
        <div class="flex items-start gap-3 p-4 pb-3">
          <input type="checkbox" data-id="${p.id}" ${done ? 'checked' : ''}
            class="mt-1 h-5 w-5 flex-none cursor-pointer rounded-md border-stone-300 text-emerald-600 focus:ring-emerald-500"
            aria-label="Mark ${escapeHtml(p.name)} as climbed">
          <div class="min-w-0 flex-1">
            <h2 class="font-display text-lg font-semibold leading-snug text-stone-900">${escapeHtml(p.name)}</h2>
            <p class="mt-0.5 text-sm text-stone-500">${escapeHtml(p.town || '')} &middot; ${escapeHtml(p.range || '')}</p>
          </div>
          <div class="flex-none font-display text-lg font-semibold text-stone-900">
            ${p.elevation_ft.toLocaleString()}<span class="text-xs font-normal text-stone-400"> ft</span>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5 px-4 pb-3">
          ${statusBadge(p)}
          ${r.difficulty ? badge(r.difficulty, DIFFICULTY_STYLE[r.difficulty]) : ''}
        </div>

        <div class="mx-4 flex gap-2 rounded-xl bg-stone-50 px-3 py-3 ring-1 ring-inset ring-stone-200/70">
          ${statBlock(r.round_trip_mi ? r.round_trip_mi.toFixed(1) : '&mdash;', 'miles', r.round_trip_mi ? estMark(r) : '')}
          ${statBlock(r.gain_ft ? r.gain_ft.toLocaleString() : '&mdash;', 'ft up')}
          ${statBlock(p.view_rating ? `${p.view_rating}/10` : '&mdash;', 'view', viewStar(p))}
        </div>

        <div class="flex-1 px-4 pt-3">
          ${p.notes ? `<p class="text-sm leading-relaxed text-stone-600">${escapeHtml(p.notes)}</p>` : ''}
          ${r.name ? `<p class="mt-1.5 text-xs text-stone-400">via ${escapeHtml(r.name)}</p>` : ''}
        </div>

        <div class="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 px-4 py-3">
          <span class="truncate text-xs text-stone-400" title="${escapeHtml(p.land?.manager || '')}">${escapeHtml(LAND_LABEL[p.land?.owner_type] || '')}</span>
          <span class="flex flex-none gap-3 text-sm font-medium">
            ${p.trailhead ? `<a class="text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" title="Drive to ${escapeHtml(p.trailhead.address || p.trailhead.name)}" href="${mapsDirections(p.trailhead.lat, p.trailhead.lon)}">Drive there</a>` : ''}
            <a class="text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" href="${mapsSearch(p.summit.lat, p.summit.lon)}">Summit map</a>
          </span>
        </div>
      </article>`;
  }

  // --- table view -----------------------------------------------------------

  function tableRow(p) {
    const done = state.completed.has(p.id);
    const r = p.route || {};
    const num = (v) => (v ? v.toLocaleString() : '<span class="text-stone-300">&mdash;</span>');

    return `
      <tr class="${done ? 'bg-emerald-50/50' : ''} hover:bg-stone-50">
        <td class="px-3 py-2.5">
          <input type="checkbox" data-id="${p.id}" ${done ? 'checked' : ''}
            class="h-4 w-4 cursor-pointer rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
            aria-label="Mark ${escapeHtml(p.name)} as climbed">
        </td>
        <td class="px-3 py-2.5">
          <div class="font-medium ${done ? 'text-emerald-900' : 'text-stone-900'}">${escapeHtml(p.name)}</div>
          ${r.name ? `<div class="text-xs text-stone-400">via ${escapeHtml(r.name)}</div>` : ''}
        </td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${p.elevation_ft.toLocaleString()}</td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${r.round_trip_mi ? r.round_trip_mi.toFixed(1) + estMark(r) : '<span class="text-stone-300">&mdash;</span>'}</td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${num(r.gain_ft)}</td>
        <td class="px-3 py-2.5">${r.difficulty ? badge(r.difficulty, DIFFICULTY_STYLE[r.difficulty]) : ''}</td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${p.view_rating ? `${p.view_rating}/10${viewStar(p)}` : '<span class="text-stone-300">&mdash;</span>'}</td>
        <td class="px-3 py-2.5">
          <div class="whitespace-nowrap">${escapeHtml(p.town || '')}</div>
          <div class="text-xs text-stone-400">${escapeHtml(p.county || '')} County</div>
        </td>
        <td class="whitespace-nowrap px-3 py-2.5">${escapeHtml(p.range || '')}</td>
        <td class="px-3 py-2.5"><span class="text-xs text-stone-500" title="${escapeHtml(p.land?.manager || '')}">${escapeHtml(LAND_LABEL[p.land?.owner_type] || '')}</span></td>
        <td class="px-3 py-2.5">${statusBadge(p)}</td>
        <td class="whitespace-nowrap px-3 py-2.5 text-sm">
          ${p.trailhead ? `<a class="font-medium text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" href="${mapsDirections(p.trailhead.lat, p.trailhead.lon)}">Drive</a> ` : ''}
          <a class="font-medium text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" href="${mapsSearch(p.summit.lat, p.summit.lon)}">Map</a>
        </td>
      </tr>`;
  }

  function syncSortIndicators() {
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === state.sortKey;
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = active ? (state.sortDir === 'asc' ? '\u25B2' : '\u25BC') : '';
      th.setAttribute('aria-sort', active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }

  // --- print ----------------------------------------------------------------

  const dateRule = (w) => `<span style="display:inline-block; width:${w}pt; border-bottom:0.75pt solid #a8a29e;">&nbsp;</span>`;
  const DATE_FIELD = `${dateRule(12)}<span style="color:#a8a29e;">/</span>${dateRule(12)}<span style="color:#a8a29e;">/</span>${dateRule(20)}`;

  function printColumn(list) {
    return `
      <table style="width:100%; border-collapse:collapse; font-size:8.5pt;">
        <tr style="font-size:6.5pt; text-transform:uppercase; letter-spacing:.05em; color:#a8a29e;">
          <td style="width:11pt;"></td>
          <td style="width:58pt; padding:0 6pt 1.5pt 0;">Mo / Day / Year</td>
          <td style="padding-bottom:1.5pt;">Peak</td>
          <td style="width:30pt; padding-bottom:1.5pt; text-align:right;">Feet</td>
        </tr>
        ${list.map((p) => {
          const done = state.completed.has(p.id);
          return `
            <tr>
              <td style="width:11pt; padding:1.2pt 0; vertical-align:top;">
                <span style="display:inline-block; width:8pt; height:8pt; border:0.75pt solid #57534e; text-align:center; line-height:8pt; font-size:7pt;">${done ? '&#10003;' : ''}</span>
              </td>
              <td style="width:58pt; padding:1.2pt 6pt 1.2pt 0; vertical-align:top; white-space:nowrap;">${DATE_FIELD}</td>
              <td style="padding:1.2pt 3pt 1.2pt 0; line-height:1.12;">${escapeHtml(p.name)}</td>
              <td style="width:30pt; padding:1.2pt 0; text-align:right; vertical-align:top; color:#57534e;">${p.elevation_ft.toLocaleString()}</td>
            </tr>`;
        }).join('')}
      </table>`;
  }

  function printSection(title, list) {
    if (!list.length) return '';
    const sorted = list.slice().sort((a, b) => sortName(a).localeCompare(sortName(b)));
    const half = Math.ceil(sorted.length / 2);
    return `
      <div class="print-section">
        <h2 style="font-size:10.5pt; margin:7pt 0 2pt; border-bottom:0.75pt solid #d6d3d1; padding-bottom:1.5pt;">${title}</h2>
        <div style="display:flex; justify-content:space-between; align-items:stretch;">
          <div style="flex:0 0 46%; min-width:0;">${printColumn(sorted.slice(0, half))}</div>
          <div style="border-left:0.5pt solid #e7e5e4;" aria-hidden="true"></div>
          <div style="flex:0 0 46%; min-width:0;">${printColumn(sorted.slice(half))}</div>
        </div>
      </div>`;
  }

  function renderPrintSheet() {
    const current = state.peaks.filter((p) => p.status === 'current');
    const retired = state.peaks.filter((p) => p.status === 'delisted');
    els.printBody.innerHTML =
      printSection('The current 52', current) +
      printSection('Retired peaks — these still count toward your 52', retired);

    const ticked = state.peaks.filter((p) => state.completed.has(p.id)).length;
    els.printTicked.textContent = ticked ? `${Math.min(ticked, PATCH_TARGET)} of 52 already ticked.` : '';
  }

  // --- render ---------------------------------------------------------------

  function renderProgress() {
    const current = state.peaks.filter((p) => p.status === 'current');
    const currentDone = current.filter((p) => state.completed.has(p.id)).length;
    const retiredDone = state.peaks.filter((p) => p.status === 'delisted' && state.completed.has(p.id)).length;
    const total = Math.min(currentDone + retiredDone, PATCH_TARGET);

    const remaining = current.filter((p) => !state.completed.has(p.id));
    const milesLeft = [...new Map(
      remaining.filter((p) => p.route?.round_trip_mi).map((p) => [p.route.name || p.name, p.route.round_trip_mi])
    ).values()].reduce((sum, mi) => sum + mi, 0);

    let headline = 'Ready when you are';
    let sub = "Tick a peak once you've stood on top.";
    if (total > 0 && total < PATCH_TARGET) {
      headline = `${total} down, ${PATCH_TARGET - total} to go`;
      sub = total < 10 ? 'A fine start. Pick something nearby for the next one.'
        : total < 40 ? "You're well into it now."
          : 'The finish line is in sight — save a good one for last.';
    } else if (total >= PATCH_TARGET) {
      headline = 'All 52 — well done!';
      sub = 'Print the checklist and send it to the Over the Hill Hikers for your patch.';
    }

    els.headline.textContent = headline;
    els.sub.textContent = sub;
    els.bar.style.width = `${(total / PATCH_TARGET) * 100}%`;
    els.track.setAttribute('aria-valuenow', String(total));
    els.statCurrent.textContent = String(currentDone);
    els.statRetired.textContent = String(retiredDone);
    els.statMiles.textContent = milesLeft.toFixed(0);
  }

  function render() {
    const rows = visiblePeaks();
    const cardsView = state.view === 'cards';

    els.cards.classList.toggle('hidden', !cardsView);
    els.tableWrap.classList.toggle('hidden', cardsView);

    if (rows.length === 0) {
      const empty = `<p class="col-span-full rounded-2xl border border-dashed border-stone-300 bg-white/60 py-14 text-center text-stone-500">Nothing matches that. Try widening your filters.</p>`;
      els.cards.innerHTML = empty;
      els.tableBody.innerHTML = `<tr><td colspan="12" class="px-3 py-14 text-center text-stone-500">Nothing matches that. Try widening your filters.</td></tr>`;
    } else if (cardsView) {
      els.cards.innerHTML = rows.map(card).join('');
    } else {
      els.tableBody.innerHTML = rows.map(tableRow).join('');
    }

    els.resultCount.textContent = rows.length === state.peaks.length
      ? `Showing all ${rows.length} peaks`
      : `Showing ${rows.length} peak${rows.length === 1 ? '' : 's'}`;

    const active = [state.range, state.county, state.difficulty, state.land].filter(Boolean).length;
    els.filterCount.textContent = String(active);
    els.filterCount.classList.toggle('hidden', active === 0);

    syncSortIndicators();
    renderProgress();
    renderPrintSheet();
  }

  function setToggle(selector, attr, value) {
    document.querySelectorAll(selector).forEach((btn) => {
      const on = btn.dataset[attr] === value;
      btn.classList.toggle('bg-white', on);
      btn.classList.toggle('text-stone-900', on);
      btn.classList.toggle('shadow-sm', on);
      btn.classList.toggle('text-stone-500', !on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  function setView(view) {
    state.view = view;
    setToggle('.view-btn', 'view', view);
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }

  function buildRangeOptions() {
    const ranges = [...new Set(state.peaks.map((p) => p.range).filter(Boolean))].sort();
    els.range.innerHTML = '<option value="">Anywhere</option>' +
      ranges.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

    const counties = [...new Set(state.peaks.map((p) => p.county).filter(Boolean))].sort();
    els.county.innerHTML = '<option value="">All counties</option>' +
      counties.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)} County</option>`).join('');
  }

  const SORTABLE = ['name', 'elevation_ft', 'round_trip_mi', 'gain_ft', 'difficulty', 'view_rating', 'town', 'range', 'land', 'status'];

  function applySort(key, dir) {
    state.sortKey = key;
    state.sortDir = dir;
    const option = `${key}:${dir}`;
    els.sort.value = [...els.sort.options].some((o) => o.value === option) ? option : '';
    try { localStorage.setItem(SORT_KEY, option); } catch { /* ignore */ }
  }

  function wire() {
    els.search.addEventListener('input', (e) => { state.query = e.target.value; render(); });
    els.range.addEventListener('change', (e) => { state.range = e.target.value; render(); });
    els.county.addEventListener('change', (e) => { state.county = e.target.value; render(); });
    els.difficulty.addEventListener('change', (e) => { state.difficulty = e.target.value; render(); });
    els.land.addEventListener('change', (e) => { state.land = e.target.value; render(); });

    els.sort.addEventListener('change', (e) => {
      const [key, dir] = e.target.value.split(':');
      applySort(key, dir);
      render();
    });

    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const dir = state.sortKey === key
          ? (state.sortDir === 'asc' ? 'desc' : 'asc')
          : (['elevation_ft', 'view_rating'].includes(key) ? 'desc' : 'asc');
        applySort(key, dir);
        render();
      });
    });

    els.filtersToggle.addEventListener('click', () => {
      const nowHidden = els.filters.classList.toggle('hidden');
      els.filters.classList.toggle('grid', !nowHidden);
      els.filtersToggle.setAttribute('aria-expanded', String(!nowHidden));
    });

    document.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => { setView(btn.dataset.view); render(); });
    });

    document.querySelectorAll('.list-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.list = btn.dataset.list;
        setToggle('.list-btn', 'list', state.list);
        render();
      });
    });

    document.querySelectorAll('.status-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.status = btn.dataset.status;
        setToggle('.status-btn', 'status', state.status);
        render();
      });
    });

    const onToggleTick = (e) => {
      const box = e.target.closest('input[type="checkbox"][data-id]');
      if (!box) return;
      const id = Number(box.dataset.id);
      if (box.checked) state.completed.add(id); else state.completed.delete(id);
      saveCompleted();
      render();
    };
    els.cards.addEventListener('change', onToggleTick);
    els.tableBody.addEventListener('change', onToggleTick);

    // Browsers name a saved PDF after document.title, so give it a tidy filename.
    const pageTitle = document.title;
    const restoreTitle = () => { document.title = pageTitle; };
    window.addEventListener('afterprint', restoreTitle);

    els.printBtn.addEventListener('click', () => {
      document.title = '52-With-a-View-checklist';
      window.print();
      setTimeout(restoreTitle, 1000);
    });

    els.shareBtn.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#p=${encodeProgress([...state.completed])}`;
      history.replaceState(null, '', url);
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch { /* clipboard blocked; the address bar still holds the link */ }
      showHint(
        `${copied ? 'Link copied. ' : ''}Your progress now lives in the web address above &mdash; bookmark it or email it to yourself, ` +
        'and opening it on any device brings these ticks back. Nothing was sent anywhere.'
      );
    });

    els.reset.addEventListener('click', () => {
      if (!state.completed.size || !confirm('Clear every checkmark and start the list over?')) return;
      state.completed.clear();
      saveCompleted();
      history.replaceState(null, '', location.pathname);
      render();
    });
  }

  async function fetchPeaks() {
    const sources = [cfg.DATA_URL, cfg.FALLBACK_URL].filter(Boolean);
    let lastError;
    for (const url of sources) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const peaks = Array.isArray(body) ? body : body.peaks;
        if (!Array.isArray(peaks)) throw new Error('No peak array found');
        els.sourceNote.textContent =
          `${peaks.length} peaks loaded from ${url.includes('gist.githubusercontent.com') ? 'the public Gist' : 'this site'}` +
          `${body.list_revision ? `, list revision ${body.list_revision}` : ''}.`;
        return { peaks, meta: Array.isArray(body) ? {} : body };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('No data source configured');
  }

  (async function init() {
    try {
      const { peaks, meta } = await fetchPeaks();
      state.peaks = peaks;
      state.meta = meta;
      state.completed = loadCompleted();
      if (location.hash.startsWith('#p=')) saveCompleted();

      let saved = 'cards';
      try { saved = localStorage.getItem(VIEW_KEY) || 'cards'; } catch { /* ignore */ }

      let sort = 'name:asc';
      try { sort = localStorage.getItem(SORT_KEY) || 'name:asc'; } catch { /* ignore */ }
      const [sortKey, sortDir] = sort.split(':');

      buildRangeOptions();
      setView(saved === 'table' ? 'table' : 'cards');
      applySort(SORTABLE.includes(sortKey) ? sortKey : 'name', sortDir === 'desc' ? 'desc' : 'asc');
      setToggle('.list-btn', 'list', state.list);
      setToggle('.status-btn', 'status', state.status);
      wire();
      render();
    } catch (err) {
      els.cards.innerHTML =
        `<p class="col-span-full rounded-2xl border border-rose-200 bg-rose-50 py-14 text-center text-rose-700">
           Could not load the peak list: ${escapeHtml(err.message)}
         </p>`;
    }
  })();
})();
