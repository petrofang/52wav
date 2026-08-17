(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const STORAGE_KEY = '52wav.completed.v1';
  const VIEW_KEY = '52wav.view';
  const SORT_KEY = '52wav.sort';
  const WEATHER_CACHE_KEY = '52wav.weather.v1';
  const PATCH_TARGET = 52;
  const WEATHER_SUCCESS_TTL_MS = 30 * 60 * 1000;
  const WEATHER_FAILURE_TTL_MS = 5 * 60 * 1000;
  const WEATHER_RATE_MS = 220;

  const weatherInflight = Object.create(null);
  let weatherGate = Promise.resolve();

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
  };

  const state = {
    peaks: [],
    meta: {},
    completed: new Set(),
    expandedCards: new Set(),
    weather: {},
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

  // Sort on the distinctive part of the name: "Mt. Avalon" files under A, "The Horn"
  // under H. Half the list is "Mt. something", which otherwise clumps under M.
  const sortName = (p) => p.name.replace(/^(Mt\.|Mount|The)\s+/i, '').toLowerCase();

  // The official list mixes "Mtn." and "Mountain", and spells combined entries out in
  // full. Tidy both for display only, so the published dataset keeps the names exactly
  // as the Over the Hill Hikers write them.
  const displayName = (p) => p.name
    .replace(/^(\S+) Mountain and (\S+) Mountain$/, '$1 & $2 Mtns.')
    .replace(/^North (\S+) and South \1$/, 'North & South $1')
    .replace(/\bMountain\b/g, 'Mtn.');

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

  function loadWeatherCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || '{}');
      const now = Date.now();
      const out = {};
      Object.entries(raw).forEach(([id, rec]) => {
        if (!rec || typeof rec !== 'object') return;
        if (!Number.isFinite(rec.expiresAt) || rec.expiresAt <= now) return;
        out[id] = {
          icon: typeof rec.icon === 'string' ? rec.icon : '—',
          temp: Number.isFinite(rec.temp) ? rec.temp : null,
          unavailable: Boolean(rec.unavailable),
          expiresAt: rec.expiresAt,
        };
      });
      return out;
    } catch {
      return {};
    }
  }

  function saveWeatherCache() {
    try {
      const now = Date.now();
      const keep = {};
      Object.entries(state.weather).forEach(([id, rec]) => {
        if (!rec || !Number.isFinite(rec.expiresAt) || rec.expiresAt <= now) return;
        keep[id] = {
          icon: rec.icon,
          temp: Number.isFinite(rec.temp) ? rec.temp : null,
          unavailable: Boolean(rec.unavailable),
          expiresAt: rec.expiresAt,
        };
      });
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(keep));
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }

  function cacheWeather(key, rec, ttlMs) {
    const value = {
      icon: rec?.icon || '—',
      temp: Number.isFinite(rec?.temp) ? rec.temp : null,
      unavailable: Boolean(rec?.unavailable),
      expiresAt: Date.now() + ttlMs,
    };
    state.weather[key] = value;
    saveWeatherCache();
    return value;
  }

  function queueWeatherRequest(task) {
    const run = weatherGate.then(task, task);
    weatherGate = run.then(
      () => new Promise((resolve) => setTimeout(resolve, WEATHER_RATE_MS)),
      () => new Promise((resolve) => setTimeout(resolve, WEATHER_RATE_MS))
    );
    return run;
  }

  // --- filtering and sorting ------------------------------------------------

  const DIFFICULTY_ORDER = { Easier: 1, Medium: 2, Harder: 3 };

  function recommendedRoute(p) {
    const routes = Array.isArray(p.routes) && p.routes.length
      ? p.routes
      : Array.isArray(p.alt_routes) && p.route
        ? [p.route, ...p.alt_routes]
        : p.route
          ? [p.route]
          : [];

    if (!routes.length) return null;
    const recommended = routes.find((route) => route && route.recommended === true);
    return recommended || routes[0];
  }

  function sortValue(p, key) {
    const route = recommendedRoute(p);
    switch (key) {
      case 'elevation_ft': return p.elevation_ft;
      case 'round_trip_mi': return route?.round_trip_mi ?? Infinity;
      case 'gain_ft': return route?.gain_ft ?? Infinity;
      case 'difficulty': return DIFFICULTY_ORDER[route?.difficulty] ?? 99;
      case 'view_rating': return p.view_rating ?? -1;
      case 'name': return sortName(p);
      case 'land': return String(p.land?.owner_type ?? '').toLowerCase();
      default: return String(p[key] ?? '').toLowerCase();
    }
  }

  function visiblePeaks() {
    const q = state.query.trim().toLowerCase();
    const rows = state.peaks.filter((p) => {
      const route = recommendedRoute(p);
      if (state.list !== 'all' && p.status !== state.list) return false;
      if (state.range && p.range !== state.range) return false;
      if (state.county && p.county !== state.county) return false;
      if (state.difficulty && route?.difficulty !== state.difficulty) return false;
      if (state.land && p.land?.owner_type !== state.land) return false;
      const done = state.completed.has(p.id);
      if (state.status === 'todo' && done) return false;
      if (state.status === 'completed' && !done) return false;
      if (!q) return true;
      return [p.name, p.range, p.town, p.county, p.notes, route?.name, p.trailhead?.name, p.land?.manager, displayName(p)]
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
  const googleEarthView = (lat, lon) => {
    const la = Number(lat).toFixed(8);
    const lo = Number(lon).toFixed(8);
    return `https://earth.google.com/web/@${la},${lo},900a,2200d,35y,0h,84t,0r`;
  };
  const satellitePreviewImage = (lat, lon) => {
    const la = Number(lat);
    const lo = Number(lon);
    const latHalfSpan = 0.008;
    const lonHalfSpan = (latHalfSpan * (16 / 9)) / Math.max(0.2, Math.cos((la * Math.PI) / 180));
    const minLon = (lo - lonHalfSpan).toFixed(6);
    const minLat = (la - latHalfSpan).toFixed(6);
    const maxLon = (lo + lonHalfSpan).toFixed(6);
    const maxLat = (la + latHalfSpan).toFixed(6);
    const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
    return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&size=1024,576&imageSR=4326&format=png&f=image`;
  };

  function safeExternalUrl(url) {
    try {
      const parsed = new URL(String(url));
      return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }

  // --- 3D summit view -------------------------------------------------------

  const MAPLIBRE_VERSION = '4.7.1';
  const summitView = { id: null, host: null, map: null, frame: 0 };
  let maplibrePromise = null;

  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (maplibrePromise) return maplibrePromise;

    maplibrePromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
      css.crossOrigin = 'anonymous';
      document.head.appendChild(css);

      const script = document.createElement('script');
      script.src = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
      script.crossOrigin = 'anonymous';
      script.onload = () => (window.maplibregl ? resolve(window.maplibregl) : reject(new Error('MapLibre unavailable')));
      script.onerror = () => reject(new Error('MapLibre failed to load'));
      document.head.appendChild(script);
    }).catch((err) => {
      maplibrePromise = null;
      throw err;
    });

    return maplibrePromise;
  }

  let despikeRegistered = false;

  // Terrarium tiles carry occasional corrupt pixels that decode as huge spikes.
  // This rewrites each tile, replacing any pixel that disagrees wildly with its
  // neighbours by the local median height.
  function despikeHeights(data, width, height, thresholdMetres) {
    const count = width * height;
    const heights = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const p = i * 4;
      heights[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
    }

    const neighbours = new Float64Array(8);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            neighbours[n] = heights[(y + dy) * width + (x + dx)];
            n += 1;
          }
        }
        neighbours.sort();
        const median = (neighbours[3] + neighbours[4]) / 2;
        if (Math.abs(heights[i] - median) <= thresholdMetres) continue;

        const value = median + 32768;
        const p = i * 4;
        const r = Math.floor(value / 256);
        const g = Math.floor(value - r * 256);
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = Math.floor((value - Math.floor(value)) * 256);
      }
    }
  }

  function registerDespikeProtocol(maplibregl) {
    if (despikeRegistered || typeof OffscreenCanvas === 'undefined') return;
    despikeRegistered = true;

    maplibregl.addProtocol('despike', async (params, abortController) => {
      const url = params.url.replace(/^despike:\/\//, 'https://');
      const res = await fetch(url, { signal: abortController?.signal });
      if (!res.ok) throw new Error(`Terrain tile ${res.status}`);

      const bitmap = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      // A pixel covers more ground at low zoom, so tolerate bigger honest steps there.
      const zoom = Number(url.match(/terrarium\/(\d+)\//)?.[1]);
      const metresPerPixel = Number.isFinite(zoom) ? (156543 * Math.cos(0.77)) / 2 ** zoom : 20;
      const threshold = Math.max(60, metresPerPixel * 1.5);

      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      despikeHeights(image.data, canvas.width, canvas.height, threshold);
      ctx.putImageData(image, 0, 0);

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return { data: await blob.arrayBuffer() };
    });
  }

  const summitStyle = {
    version: 8,
    sources: {
      imagery: {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery &copy; Esri'
      },
      terrain: {
        type: 'raster-dem',
        tiles: ['despike://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 15,
        encoding: 'terrarium',
        attribution: 'Elevation: Mapzen / AWS Open Data'
      }
    },
    layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }]
  };

  const SUMMIT_SKY = {
    'sky-color': '#6fa8dc',
    'horizon-color': '#dfeaf4',
    'fog-color': '#ffffff',
    'fog-ground-blend': 0.55,
    'horizon-fog-blend': 0.6,
    'sky-horizon-blend': 0.75,
    'atmosphere-blend': 0.85
  };

  function skyForCloudCover(cloudCover) {
    const overcast = Number.isFinite(cloudCover) ? Math.min(100, Math.max(0, cloudCover)) / 100 : 0.2;
    const mix = (clear, cloudy) => Math.round(clear + (cloudy - clear) * overcast);
    const blend = (clear, cloudy) => clear + (cloudy - clear) * overcast;
    return {
      'sky-color': `rgb(${mix(111, 122)}, ${mix(168, 127)}, ${mix(220, 135)})`,
      'horizon-color': `rgb(${mix(223, 171)}, ${mix(234, 173)}, ${mix(244, 178)})`,
      'fog-color': `rgb(${mix(255, 196)}, ${mix(255, 198)}, ${mix(255, 203)})`,
      // Thicker cloud pushes haze further down the slopes and softens the horizon.
      'fog-ground-blend': blend(0.6, 0.2),
      'horizon-fog-blend': blend(0.55, 0.9),
      'sky-horizon-blend': blend(0.7, 1),
      'atmosphere-blend': blend(0.85, 0.95)
    };
  }

  function applySummitWeather(map, id, weather) {
    if (!map || !map.isStyleLoaded()) return;
    const cloudCover = weather?.cloudCover;
    const overcast = Number.isFinite(cloudCover) ? Math.min(100, Math.max(0, cloudCover)) / 100 : 0.2;

    map.setSky(skyForCloudCover(cloudCover));

    if (map.getLayer('imagery')) {
      map.setPaintProperty('imagery', 'raster-saturation', -0.7 * overcast);
      map.setPaintProperty('imagery', 'raster-brightness-max', 1 - 0.45 * overcast);
      map.setPaintProperty('imagery', 'raster-contrast', -0.25 * overcast);
    }

    if (weather?.precipitation > 0) addRadarOverlay(map, id);
  }

  let radarPromise = null;

  function latestRadarTiles() {
    if (radarPromise) return radarPromise;
    radarPromise = fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then((res) => res.json())
      .then((data) => {
        const frame = data?.radar?.past?.[data.radar.past.length - 1];
        if (!data?.host || !frame?.path) throw new Error('No radar frame available');
        return `${data.host}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`;
      })
      .catch((err) => {
        radarPromise = null;
        throw err;
      });
    return radarPromise;
  }

  function addRadarOverlay(map, id) {
    latestRadarTiles()
      .then((tiles) => {
        if (summitView.id !== id || summitView.map !== map || map.getSource('radar')) return;
        map.addSource('radar', {
          type: 'raster',
          tiles: [tiles],
          tileSize: 256,
          maxzoom: 10,
          attribution: 'Radar &copy; RainViewer'
        });
        map.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.45 } });
      })
      .catch(() => {
        // Radar is decorative; the summit view stands on its own without it.
      });
  }

  function destroySummitView() {
    if (summitView.frame) cancelAnimationFrame(summitView.frame);
    if (summitView.map) summitView.map.remove();
    if (summitView.host) summitView.host.remove();
    summitView.id = null;
    summitView.host = null;
    summitView.map = null;
    summitView.frame = 0;
  }

  function startSummitOrbit(map) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let last = performance.now();
    const step = (now) => {
      const seconds = (now - last) / 1000;
      last = now;
      map.setBearing(map.getBearing() + seconds * 3);
      summitView.frame = requestAnimationFrame(step);
    };
    summitView.frame = requestAnimationFrame(step);
  }

  function createSummitView(id, lat, lon) {
    destroySummitView();

    const host = document.createElement('div');
    // Inline styles: Tailwind's JIT does not reliably pick up classes on nodes created here.
    host.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;opacity:0;transition:opacity .7s;';
    summitView.id = id;
    summitView.host = host;

    loadMapLibre()
      .then((maplibregl) => {
        if (summitView.id !== id) return;
        registerDespikeProtocol(maplibregl);
        const map = new maplibregl.Map({
          container: host,
          style: summitStyle,
          center: [lon, lat],
          zoom: 12.4,
          pitch: 80,
          maxPitch: 85,
          bearing: 20,
          interactive: false,
          attributionControl: { compact: true }
        });
        summitView.map = map;
        map.on('load', () => {
          if (summitView.id !== id) return;
          map.setTerrain({ source: 'terrain', exaggeration: 1.35 });
          applySummitWeather(map, id, state.weather[id]);
          map.resize();
          host.style.opacity = '1';
          startSummitOrbit(map);
        });
      })
      .catch(() => {
        // Poster image stays visible when the 3D view cannot load.
      });
  }

  function syncSummitView() {
    const mount = els.cards.querySelector('article[data-expanded="true"] [data-summit-mount]');
    if (!mount) {
      destroySummitView();
      return;
    }

    const id = Number(mount.dataset.summitMount);
    const lat = Number(mount.dataset.summitLat);
    const lon = Number(mount.dataset.summitLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (summitView.id !== id) createSummitView(id, lat, lon);
    if (summitView.host && summitView.host.parentElement !== mount) {
      mount.insertBefore(summitView.host, mount.firstChild);
      if (summitView.map) summitView.map.resize();
    }
    applySummitWeather(summitView.map, id, state.weather[id]);
  }

  const NH_FAMILY_HIKES_NAME_MAP = {
    'Black Mtn. (Benton)': 'Black Mountain',
    'Carr Mountain': 'Carr Mountain',
    'Eagle Crag': 'The Meader Ridge',
    'Eastman Mtn.': 'Eastman Mountain',
    'Hedgehog Mtn.': 'Hedgehog Mountain',
    'Hibbard Mountain': 'Mt. Wonalancet and Hibbard Mountain',
    'The Horn': 'The Horn',
    'Imp Face': 'Imp Face',
    'Jennings Peak': 'Stairs Mountain and Mts. Resolution and Crawford',
    'Middle Sister': 'The Three Sisters',
    'Mt. Avalon': 'Mt. Avalon',
    'Mt. Cardigan': 'Mt. Cardigan',
    'Mt. Chocorua': 'Mt. Chocorua',
    'Mt. Crawford': 'Stairs Mountain and Mts. Resolution and Crawford',
    'Mt. Cube (South Peak)': 'Mt. Cube',
    'Mt. Hayes': 'Mt. Hayes',
    'Mt. Israel': 'Mt. Israel',
    'Mt. Kearsarge': 'Mt. Kearsarge',
    'Mt. Kearsarge North': 'Mt. Kearsarge North',
    'Mt. Monadnock': 'Mt. Monadnock',
    'Mt. Morgan': 'Mts. Morgan and Percival',
    'Mt. Parker': 'Mt. Parker',
    'Mt. Paugus (South Peak)': 'Mt. Paugus',
    'Mt. Pemigewasset': 'Mt. Pemigewasset',
    'Mt. Percival': 'Mts. Morgan and Percival',
    'Mt. Resolution': 'Stairs Mountain and Mts. Resolution and Crawford',
    'Mt. Roberts': 'Mt. Roberts',
    'Mt. Shaw': 'Mt. Shaw',
    'Mt. Success': 'Mt. Success',
    'Mt. Tremont': 'Mt. Tremont',
    'Mt. Webster': 'Mts. Webster and Jackson',
    'Mt. Willard': 'Mt. Willard',
    'Middle Sugarloaf': 'Middle and North Sugarloaf Mountains',
    'Middle Sugarloaf Mtn.': 'Middle and North Sugarloaf Mountains',
    'North Baldface': 'The Baldfaces',
    'North Doublehead and South Doublehead': 'Doublehead Mountain',
    'North Moat Mtn.': 'South and North Moat Mountains',
    'North Percy Peak': 'North Percy Peak',
    'Pine Mtn. (Gorham)': 'Pine Mountain',
    'Potash Mtn.': 'Potash Mountain',
    'Sandwich Dome': 'Sandwich Dome',
    'Shelburne Moriah Mtn.': 'Shelburne Moriah Mountain',
    'Smarts Mtn.': 'Smarts  Mountain',
    'South Baldface': 'The Baldfaces',
    'South Moat Mtn.': 'South and North Moat Mountains',
    'Stairs Mtn.': 'Stairs Mountain and Mts. Resolution and Crawford',
    'Stinson Mtn.': 'Stinson Mountain',
    'Sugarloaf (Stratford)': 'Sugarloaf Mountain',
    'Table Mtn.': 'Table Mountain',
    'Welch Mountain and Dickey Mountain': 'Welch and Dickey Mountains',
    'Mt. Waumbek': 'Mt. Waumbek',
    'Black Mountain - Middle Peak (Jackson)': 'Black Mountain',
    'Bald Peak': 'Bald Peak',
    'Iron Mountain': 'Iron Mountain',
    'Owlshead (Carroll)': 'Owlshead',
    'Mt. Starr King': 'Mt. Waumbek',
    'Mt. Martha (Cherry Mtn.)': 'Cherry Mountain',
    'Mt. Wolf': 'Mt. Roberts',
    'Rogers Ledge': 'Rogers Ledge',
    'Square Ledge (Albany)': 'Square Ledge',
    'West Royce Mountain': 'East and West Royce',
  };

  function nhFamilyHikesUrl(p) {
    const mappedName = NH_FAMILY_HIKES_NAME_MAP[p.name] || p.name;
    const hikeParam = encodeURIComponent(mappedName);
    const sourceParam = encodeURIComponent('petrofang.github.io/52wav');
    return `http://www.nhfamilyhikes.com/hikes.php?hike=${hikeParam}&from=${sourceParam}`;
  }

  function fallbackSources(p) {
    const q = encodeURIComponent(`${p.name} New Hampshire hike`);
    return [
      {
        label: 'NH Family Hikes',
        url: nhFamilyHikesUrl(p),
        note: 'Peak page and hike notes',
      },
      {
        label: 'New England Waterfalls',
        url: 'https://www.newenglandwaterfalls.com/52withaview.php',
        note: 'Alternate-route guide and standard route options',
      },
      {
        label: 'TrailsNH',
        url: `https://www.google.com/search?q=site:trailsnh.com+${q}`,
        note: 'Recent trail conditions and weather links',
      },
    ];
  }

  function infoSources(p) {
    const fromData = Array.isArray(p.sources)
      ? p.sources
        .map((s) => {
          const label = (s?.label || s?.name || s?.title || '').trim();
          const url = safeExternalUrl(s?.url || s?.href);
          if (!label || !url) return null;
          return {
            label,
            url,
            note: String(s?.note || '').trim(),
          };
        })
        .filter(Boolean)
      : [];

    return (fromData.length ? fromData : fallbackSources(p)).slice(0, 3);
  }

  function routeChoices(p) {
    if (Array.isArray(p.routes) && p.routes.length) return p.routes;
    if (Array.isArray(p.alt_routes) && p.route) return [p.route, ...p.alt_routes];
    return p.route ? [p.route] : [];
  }

  function routeTrailhead(route, fallbackPeak = null) {
    const candidate = route?.trailhead || fallbackPeak?.trailhead || null;
    if (!candidate || candidate.lat == null || candidate.lon == null) return null;
    return candidate;
  }

  function primaryRoute(p) {
    return recommendedRoute(p) || p.route || {};
  }

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

  const weatherCodeMap = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️',
    61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
    71: '🌨️', 73: '🌨️', 75: '❄️', 77: '❄️', 80: '🌦️', 81: '🌧️',
    82: '🌧️', 85: '🌨️', 86: '🌨️', 95: '⛈️', 96: '⛈️', 99: '⛈️'
  };

  const weatherTarget = (peak) => {
    if (peak?.summit && peak.summit.lat != null && peak.summit.lon != null) {
      return { lat: Number(peak.summit.lat), lon: Number(peak.summit.lon) };
    }

    const route = primaryRoute(peak);
    const trailhead = routeTrailhead(route, peak);
    if (trailhead && trailhead.lat != null && trailhead.lon != null) {
      return { lat: Number(trailhead.lat), lon: Number(trailhead.lon) };
    }

    return null;
  };

  const weatherBadge = (peak) => {
    const weather = state.weather[peak.id];
    if (!weather) return '';

    if (weather.unavailable) {
      return `
        <div class="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200" title="Weather unavailable for ${escapeHtml(peak.name)}">
          <span aria-label="Weather unavailable">—</span>
          <span>Weather</span>
        </div>`;
    }

    if (weather.temp == null || !weather.icon) return '';
    return `
      <div class="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 ring-1 ring-sky-200" title="Current weather near ${escapeHtml(peak.name)}">
        <span aria-label="Current weather">${weather.icon}</span>
        <span>${Math.round(weather.temp)}°F</span>
      </div>`;
  };

  const badge = (text, cls, title = '') =>
    `<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</span>`;

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

  async function fetchWeatherForPeak(peak) {
    const key = `${peak.id}`;
    const now = Date.now();
    const cached = state.weather[key];
    if (cached && Number.isFinite(cached.expiresAt) && cached.expiresAt > now) return cached;

    if (weatherInflight[key]) return weatherInflight[key];

    const target = weatherTarget(peak);
    if (!target) {
      return cacheWeather(key, { icon: '—', temp: null, unavailable: true }, WEATHER_FAILURE_TTL_MS);
    }

    const request = queueWeatherRequest(async () => {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(target.lat));
      url.searchParams.set('longitude', String(target.lon));
      url.searchParams.set('current', 'temperature_2m,weather_code,precipitation,cloud_cover');
      url.searchParams.set('temperature_unit', 'fahrenheit');
      url.searchParams.set('wind_speed_unit', 'mph');
      url.searchParams.set('timezone', 'auto');

      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          return cacheWeather(key, { icon: '—', temp: null, unavailable: true }, WEATHER_FAILURE_TTL_MS);
        }

        const data = await res.json();
        const weatherCode = data?.current?.weather_code;
        const temp = data?.current?.temperature_2m;
        const precipitation = data?.current?.precipitation;
        const cloudCover = data?.current?.cloud_cover;
        return cacheWeather(key, {
          icon: weatherCodeMap[weatherCode] || '🌤️',
          temp: Number.isFinite(temp) ? temp : null,
          precipitation: Number.isFinite(precipitation) ? precipitation : 0,
          cloudCover: Number.isFinite(cloudCover) ? cloudCover : null,
          unavailable: false,
        }, WEATHER_SUCCESS_TTL_MS);
      } catch {
        return cacheWeather(key, { icon: '—', temp: null, unavailable: true }, WEATHER_FAILURE_TTL_MS);
      }
    });

    weatherInflight[key] = request.finally(() => {
      delete weatherInflight[key];
    });

    return weatherInflight[key];
  }

  async function hydrateWeather() {
    const now = Date.now();
    const targets = visiblePeaks().filter((peak) => {
      const rec = state.weather[peak.id];
      return !(rec && Number.isFinite(rec.expiresAt) && rec.expiresAt > now);
    });

    if (!targets.length) return;

    let queuedRender = false;
    const renderSoon = () => {
      if (queuedRender) return;
      queuedRender = true;
      requestAnimationFrame(() => {
        queuedRender = false;
        render();
      });
    };

    await Promise.allSettled(targets.map(async (peak) => {
      await fetchWeatherForPeak(peak);
      renderSoon();
    }));
  }

  function card(p) {
    const done = state.completed.has(p.id);
    const r = primaryRoute(p);
    const expanded = state.expandedCards.has(p.id);
    const routes = routeChoices(p);
    const detailsId = `card-details-${p.id}`;
    const sourceLinks = infoSources(p);

    const routeMarkup = routes.length
      ? routes.map((route, idx) => {
        const miles = route?.round_trip_mi ? `${route.round_trip_mi.toFixed(1)} mi` : '&mdash; mi';
        const gain = route?.gain_ft ? `${route.gain_ft.toLocaleString()} ft up` : '&mdash; ft up';
        const effort = route?.difficulty ? badge(route.difficulty, DIFFICULTY_STYLE[route.difficulty]) : '';
        const recommended = route?.recommended ? badge('Recommended', 'bg-emerald-100 text-emerald-800 ring-emerald-600/20') : '';
        const trailhead = routeTrailhead(route, p);
        const trailheadLink = trailhead
          ? `<a class="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" title="Trailhead directions for ${escapeHtml(route?.name || 'this route')}" href="${mapsDirections(trailhead.lat, trailhead.lon)}">${escapeHtml(trailhead.name || route?.name || 'Trailhead')}</a>`
          : '';
        return `
          <li class="rounded-xl border ${route?.recommended ? 'border-emerald-200 bg-emerald-50/60' : 'border-stone-200 bg-white'} px-3 py-2.5">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <p class="font-medium text-stone-800">${escapeHtml(route?.name || `Route ${idx + 1}`)}</p>
              <div class="flex items-center gap-1.5">${recommended}${effort}</div>
            </div>
            <p class="mt-1 text-xs text-stone-500">${miles} &middot; ${gain}${route?.derived ? ' &middot; est.' : ''}</p>
            ${route?.notes ? `<p class="mt-1 text-xs leading-relaxed text-stone-600">${escapeHtml(route.notes)}</p>` : ''}
            ${trailheadLink ? `<div class="mt-2"><span class="text-[11px] uppercase tracking-wide text-stone-400">Trailhead:</span> ${trailheadLink}</div>` : ''}
          </li>`;
      }).join('')
      : `<li class="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-500">Route details not yet published for this peak.</li>`;

    const routeSummary = routes.length > 1
      ? `<p class="mt-1.5 text-xs text-stone-400">via ${escapeHtml(r.name)} • ${routes.length} route options</p>`
      : r.name
        ? `<p class="mt-1.5 text-xs text-stone-400">via ${escapeHtml(r.name)}</p>`
        : '';

    const sourceMarkup = sourceLinks.map((src) => `
      <a class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 transition hover:bg-emerald-100"
         target="_blank" rel="noopener noreferrer" href="${escapeHtml(src.url)}">
        <span class="font-medium">${escapeHtml(src.label)}</span>
        ${src.note ? `<span class="block text-xs text-emerald-800/90">${escapeHtml(src.note)}</span>` : ''}
      </a>`).join('');

    const countyLabel = p.county ? `${p.county} County` : '';
    const townCounty = [p.town, countyLabel].filter(Boolean).join(', ');
    const rangeLabel = p.range
      ? (/\brange\b/i.test(p.range) ? p.range : `${p.range} Range`)
      : '';
    const locationLine = [townCounty, rangeLabel].filter(Boolean).join(' | ');
    const summitLat = Number(p?.summit?.lat);
    const summitLon = Number(p?.summit?.lon);
    const summitLatText = Number.isFinite(summitLat) ? summitLat.toFixed(6) : '&mdash;';
    const summitLonText = Number.isFinite(summitLon) ? summitLon.toFixed(6) : '&mdash;';
    const earthUrl = Number.isFinite(summitLat) && Number.isFinite(summitLon)
      ? safeExternalUrl(googleEarthView(summitLat, summitLon))
      : null;
    const satelliteImageUrl = Number.isFinite(summitLat) && Number.isFinite(summitLon)
      ? safeExternalUrl(satellitePreviewImage(summitLat, summitLon))
      : null;
    const summitWeather = state.weather[p.id];
    const summitWeatherLabel = summitWeather && !summitWeather.unavailable && summitWeather.temp != null && summitWeather.icon
      ? `<span class="text-[11px] font-medium text-white/90">${summitWeather.icon} ${Math.round(summitWeather.temp)}&deg;F</span>`
      : '';
    const earthPreview = earthUrl && expanded
      ? `
          <p class="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Summit view</p>
          <div class="relative mt-2 overflow-hidden rounded-xl border border-stone-300 bg-stone-900" style="aspect-ratio: 16 / 9;" data-summit-mount="${p.id}" data-summit-lat="${summitLat}" data-summit-lon="${summitLon}">
            ${satelliteImageUrl ? `<img class="summit-orbit summit-poster absolute inset-0 h-full w-full object-cover" alt="Satellite view of ${escapeHtml(p.name)}" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(satelliteImageUrl)}">` : ''}
            <div class="pointer-events-none absolute inset-x-0 top-0 z-20 h-10 bg-gradient-to-b from-stone-950/45 to-transparent"></div>
            <a class="group absolute inset-0 z-20 flex items-start justify-between gap-2 px-3 pt-2" target="_blank" rel="noopener noreferrer" href="${escapeHtml(earthUrl)}">
              <span class="flex items-center gap-2">
                <span class="text-[11px] font-medium text-white/90">${summitLatText}, ${summitLonText}</span>
                ${summitWeatherLabel}
              </span>
              <span class="text-[11px] font-medium text-white/80 transition group-hover:text-white">Open in Google Earth &rarr;</span>
            </a>
          </div>`
      : '';

    return `
      <article data-card-id="${p.id}" data-expanded="${expanded ? 'true' : 'false'}" tabindex="0" class="flex cursor-pointer flex-col overflow-hidden rounded-2xl border ${expanded ? 'md:col-span-2 ' : ''}${done ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200 bg-white'} shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
        <div class="flex items-start gap-3 p-4 pb-3">
          <input type="checkbox" data-id="${p.id}" ${done ? 'checked' : ''}
            class="mt-1 h-5 w-5 flex-none cursor-pointer rounded-md border-stone-300 text-emerald-600 focus:ring-emerald-500"
            aria-label="Mark ${escapeHtml(displayName(p))} as climbed">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-display text-lg font-semibold leading-snug text-stone-900">${escapeHtml(displayName(p))}</h2>
              ${weatherBadge(p)}
            </div>
            <p class="mt-0.5 text-sm text-stone-500">${escapeHtml(locationLine || p.town || '')}</p>
          </div>
          <div class="flex-none font-display text-lg font-semibold text-stone-900">
            ${p.elevation_ft.toLocaleString()}<span class="text-xs font-normal text-stone-400"> ft</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          ${statusBadge(p)}
          ${r.difficulty ? badge(r.difficulty, DIFFICULTY_STYLE[r.difficulty]) : ''}
          <button type="button" data-card-toggle="${p.id}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${detailsId}"
            class="ml-auto inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 transition hover:bg-stone-50">
            ${expanded ? 'Hide details' : 'More details'}
          </button>
        </div>

        <div class="mx-4 flex gap-2 rounded-xl bg-stone-50 px-3 py-3 ring-1 ring-inset ring-stone-200/70">
          ${statBlock(r.round_trip_mi ? r.round_trip_mi.toFixed(1) : '&mdash;', 'miles', r.round_trip_mi ? estMark(r) : '')}
          ${statBlock(r.gain_ft ? r.gain_ft.toLocaleString() : '&mdash;', 'ft up')}
          ${statBlock(p.view_rating ? `${p.view_rating}/10` : '&mdash;', 'view', viewStar(p))}
        </div>

        <div class="flex-1 px-4 pt-3">
          ${p.notes ? `<p class="text-sm leading-relaxed text-stone-600">${escapeHtml(p.notes)}</p>` : ''}
          ${routeSummary}
        </div>

        <div class="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 px-4 py-3">
          <span class="truncate text-xs text-stone-400" title="${escapeHtml(p.land?.manager || '')}">${escapeHtml(LAND_LABEL[p.land?.owner_type] || '')}</span>
          <span class="flex flex-none gap-3 text-sm font-medium">
            <a class="text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" href="${mapsSearch(p.summit.lat, p.summit.lon)}">Summit map</a>
          </span>
        </div>

        <div id="${detailsId}" class="${expanded ? '' : 'hidden '}border-t border-stone-200 bg-stone-50/70 px-4 py-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-stone-500">Peak location</p>
          <div class="mt-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-700">
            <p>${escapeHtml(locationLine || 'Location details unavailable')}</p>
            <p class="mt-1 text-xs text-stone-500">Summit lat/lon: ${summitLatText}, ${summitLonText}</p>
          </div>

          <p class="text-xs font-semibold uppercase tracking-wide text-stone-500">Route options</p>
          <ul class="mt-2 space-y-2">${routeMarkup}</ul>

          <p class="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Hiker writeups and conditions</p>
          <div class="mt-2 grid gap-2">${sourceMarkup}</div>
          ${earthPreview}
        </div>
      </article>`;
  }

  // --- table view -----------------------------------------------------------

  function tableRow(p) {
    const done = state.completed.has(p.id);
    const r = primaryRoute(p);
    const num = (v) => (v ? v.toLocaleString() : '<span class="text-stone-300">&mdash;</span>');

    return `
      <tr class="${done ? 'bg-emerald-50/50' : ''} hover:bg-stone-50">
        <td class="px-3 py-2.5">
          <input type="checkbox" data-id="${p.id}" ${done ? 'checked' : ''}
            class="h-4 w-4 cursor-pointer rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
            aria-label="Mark ${escapeHtml(displayName(p))} as climbed">
        </td>
        <td class="px-3 py-2.5">
          <div class="font-medium ${done ? 'text-emerald-900' : 'text-stone-900'}">${escapeHtml(displayName(p))}</div>
          ${r.name ? `<div class="text-xs text-stone-400">via ${escapeHtml(r.name)}</div>` : ''}
        </td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${p.elevation_ft.toLocaleString()}</td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${r.round_trip_mi ? r.round_trip_mi.toFixed(1) + estMark(r) : '<span class="text-stone-300">&mdash;</span>'}</td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${num(r.gain_ft)}</td>
        <td class="px-3 py-2.5">${r.difficulty ? badge(r.difficulty, DIFFICULTY_STYLE[r.difficulty]) : ''}</td>
        <td class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">${p.view_rating ? `${p.view_rating}/10${viewStar(p)}` : '<span class="text-stone-300">&mdash;</span>'}</td>
        <td class="px-3 py-2.5">
          <div>${escapeHtml(p.town || '')}</div>
          <div class="text-xs text-stone-400">${escapeHtml(p.county || '')} County</div>
        </td>
        <td class="px-3 py-2.5">${escapeHtml(p.range || '')}</td>
        <td class="px-3 py-2.5"><span class="text-xs text-stone-500" title="${escapeHtml(p.land?.manager || '')}">${escapeHtml(LAND_LABEL[p.land?.owner_type] || '')}</span></td>
        <td class="px-3 py-2.5">${statusBadge(p)}</td>
        <td class="px-3 py-2.5 text-sm leading-tight">
          ${(() => {
            const trailhead = routeTrailhead(r, p);
            if (!trailhead) return '<span class="text-stone-300">No trailhead</span>';
            return `<a class="block whitespace-nowrap font-medium text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" title="Drive to ${escapeHtml(trailhead.address || trailhead.name || 'the trailhead')}" href="${mapsDirections(trailhead.lat, trailhead.lon)}">Trailhead</a>`;
          })()}
          <a class="block whitespace-nowrap font-medium text-emerald-800 hover:text-emerald-950" target="_blank" rel="noopener noreferrer" href="${mapsSearch(p.summit.lat, p.summit.lon)}">Summit</a>
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

  // The rules are empty inline-blocks, so they need an explicit height and a tight
  // line-height; otherwise each one generates a full line box and inflates every row.
  const dateRule = (w) => `<span style="display:inline-block; width:${w}pt; height:7pt; line-height:7pt; vertical-align:middle; border-bottom:0.75pt solid #a8a29e;"></span>`;
  const DATE_FIELD = `${dateRule(12)}<span style="color:#a8a29e;">/</span>${dateRule(12)}<span style="color:#a8a29e;">/</span>${dateRule(20)}`;

  function printColumn(list) {
    return `
      <table style="width:100%; border-collapse:collapse; font-size:8.5pt;">
        <tr style="font-size:6.5pt; text-transform:uppercase; letter-spacing:.05em; color:#a8a29e;">
          <td style="width:11pt;"></td>
          <td style="width:58pt; padding:0 6pt 1.5pt 0; white-space:nowrap;">M / D / Yr</td>
          <td style="padding-bottom:1.5pt;">Peak</td>
          <td style="width:30pt; padding-bottom:1.5pt; text-align:right;">Feet</td>
        </tr>
        ${list.map((p) => {
          const done = state.completed.has(p.id);
          return `
            <tr>
              <td style="width:11pt; padding:1pt 0; vertical-align:top;">
                <span style="display:inline-block; width:8pt; height:8pt; border:0.75pt solid #57534e; text-align:center; line-height:8pt; font-size:7pt;">${done ? '&#10003;' : ''}</span>
              </td>
              <td style="width:58pt; padding:1pt 6pt 1pt 0; vertical-align:top; white-space:nowrap;">${DATE_FIELD}</td>
              <td style="padding:1pt 3pt 1pt 0; line-height:1.12;">${escapeHtml(displayName(p))}</td>
              <td style="width:30pt; padding:1pt 0; text-align:right; vertical-align:top; color:#57534e;">${p.elevation_ft.toLocaleString()}</td>
            </tr>`;
        }).join('')}
      </table>`;
  }

  function printSection(title, list, note) {
    if (!list.length) return '';
    const sorted = list.slice().sort((a, b) => sortName(a).localeCompare(sortName(b)));
    const half = Math.ceil(sorted.length / 2);
    return `
      <div class="print-section">
        <h2 style="font-size:10.5pt; margin:7pt 0 2pt; border-bottom:0.75pt solid #d6d3d1; padding-bottom:1.5pt;">${title}${note ? ` <span style="font-weight:normal; font-size:8pt; color:#78716c;">(${escapeHtml(note)})</span>` : ''}</h2>
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
    const revisionYear = String(state.meta?.list_revision || '').slice(0, 4);
    els.printBody.innerHTML =
      printSection('The current 52', current, revisionYear && `${revisionYear} revision`) +
      printSection('Retired peaks — these still count toward your 52', retired);
  }

  // --- render ---------------------------------------------------------------

  function renderProgress() {
    const current = state.peaks.filter((p) => p.status === 'current');
    const currentDone = current.filter((p) => state.completed.has(p.id)).length;
    const retiredDone = state.peaks.filter((p) => p.status === 'delisted' && state.completed.has(p.id)).length;
    const total = Math.min(currentDone + retiredDone, PATCH_TARGET);

    const remaining = current.filter((p) => !state.completed.has(p.id));
    const milesLeft = [...new Map(
      remaining
        .map((p) => primaryRoute(p))
        .filter((route) => route && route.round_trip_mi)
        .map((route) => [route.name || 'Unknown route', route.round_trip_mi])
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
    syncSummitView();
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

  function toggleCard(id) {
    if (!id) return;
    const cardEl = document.querySelector(`article[data-card-id="${id}"]`);
    const toggleBtn = document.querySelector(`[data-card-toggle="${id}"]`);
    const detailsEl = cardEl ? cardEl.querySelector(`#card-details-${id}`) : null;
    const isOpen = state.expandedCards.has(id);

    // Only one card may be open at a time, so opening one closes the rest.
    state.expandedCards.clear();
    if (!isOpen) {
      state.expandedCards.add(id);
    }

    const nextOpen = state.expandedCards.has(id);
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(nextOpen));
      toggleBtn.textContent = nextOpen ? 'Hide details' : 'More details';
    }
    if (detailsEl) {
      detailsEl.classList.toggle('hidden', !nextOpen);
    }
    if (cardEl) {
      cardEl.setAttribute('data-expanded', String(nextOpen));
    }

    render();
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

    els.cards.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-card-toggle]');
      if (toggleBtn) {
        toggleCard(Number(toggleBtn.dataset.cardToggle));
        return;
      }

      if (e.target.closest('a,button,input,label,select,textarea')) return;
      const cardEl = e.target.closest('article[data-card-id]');
      if (!cardEl) return;
      toggleCard(Number(cardEl.dataset.cardId));
    });

    els.cards.addEventListener('keydown', (e) => {
      if (!['Enter', ' '].includes(e.key)) return;
      if (e.target.closest('a,button,input,label,select,textarea')) return;
      const cardEl = e.target.closest('article[data-card-id]');
      if (!cardEl) return;
      e.preventDefault();
      toggleCard(Number(cardEl.dataset.cardId));
    });

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
      state.weather = loadWeatherCache();
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
      hydrateWeather().then(() => render());
    } catch (err) {
      els.cards.innerHTML =
        `<p class="col-span-full rounded-2xl border border-rose-200 bg-rose-50 py-14 text-center text-rose-700">
           Could not load the peak list: ${escapeHtml(err.message)}
         </p>`;
    }
  })();
})();
