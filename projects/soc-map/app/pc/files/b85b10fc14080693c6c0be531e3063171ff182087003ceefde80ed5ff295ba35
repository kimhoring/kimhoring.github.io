/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v14 — 배경 지도 타일 (관리자 화면 · 근로자 앱 · 관리감독자 앱 공용)
 *  웹 메르카토르 타일을 프로젝트 국소 좌표(m)로 옮겨 캔버스에 그린다.
 *  현장 규모(수 km 이내)에서는 타일이 거의 직사각형으로 대응되므로 모서리 2점으로 배치한다.
 *  브이월드(국토교통부): 서버 .env 에 키가 있으면 영상·지명·일반 지도와 연속지적도를 쓸 수 있다 (loadVWorld)
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

/** 브이월드 — key: 서버가 내려준 APP 키(지도 타일은 브라우저가 직접 받음), base: 서버 주소(지적도·검색은 서버 경유) */
const VWORLD = { key: null, base: '' };
const vwTile = (layer, ext) => (z, x, y) => `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD.key}/${layer}/${z}/${y}/${x}.${ext}`;
const BASEMAPS = {
  satellite: {
    label: '위성 (Esri)', maxZoom: 19,
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '위성영상 © Esri, Maxar, Earthstar Geographics',
  },
  vworld: { label: '브이월드 영상', maxZoom: 19, vworld: true, url: vwTile('Satellite', 'jpeg'), attribution: '영상 © 국토교통부 브이월드' },
  vworldHybrid: { label: '브이월드 영상+지명', maxZoom: 19, vworld: true, url: vwTile('Satellite', 'jpeg'), overlay: vwTile('Hybrid', 'png'), attribution: '영상·지명 © 국토교통부 브이월드' },
  vworldBase: { label: '브이월드 지도', maxZoom: 19, vworld: true, url: vwTile('Base', 'png'), attribution: '지도 © 국토교통부 브이월드' },
  street: {
    label: '일반 지도 (OSM)', maxZoom: 19,
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '지도 © OpenStreetMap contributors',
  },
};
/** 브이월드 키가 없으면 쓸 수 없는 지도는 Esri 위성으로 대신 */
function basemapDef(layer) { const d = BASEMAPS[layer]; return d && d.vworld && !VWORLD.key ? BASEMAPS.satellite : d; }
const inKorea = (lat, lon) => lat > 33 && lat < 39 && lon > 124 && lon < 132;

/** 서버에 브이월드 키가 있는지 확인 (base: 관리자 화면은 BACKEND_URL, 휴대폰 앱은 같은 주소 '') */
async function loadVWorld(base = '') {
  try {
    const r = await fetch(`${base}/api/vworld/config`, { cache: 'no-store' });
    const c = r.ok ? await r.json() : null;
    VWORLD.key = c && c.enabled ? c.key : null; VWORLD.base = base;
  } catch (e) { VWORLD.key = null; }
  return !!VWORLD.key;
}
/** 브이월드 주소·장소 검색 (서버 경유) → [{name, lat, lon, kind}] */
async function vworldSearch(q) {
  const r = await fetch(`${VWORLD.base}/api/vworld/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`브이월드 검색 실패 (${r.status})`);
  return (await r.json()).results;
}
/** 범위 안 필지 경계 (서버 경유) → [{pnu, addr, rings: [[[lat, lon], ...]]}] */
async function vworldParcels(minlat, minlon, maxlat, maxlon) {
  const r = await fetch(`${VWORLD.base}/api/vworld/parcels?minlat=${minlat}&minlon=${minlon}&maxlat=${maxlat}&maxlon=${maxlon}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `필지 조회 실패 (${r.status})`);
  return (await r.json()).parcels;
}

const Basemap = (() => {
  const cache = new Map();   // key → {img, ok}
  const LIMIT = 500;
  const tileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
  const tileY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
  const tileLon = (x, z) => x / 2 ** z * 360 - 180;
  const tileLat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };

  function get(name, url, z, x, y) {
    const key = `${name}/${z}/${x}/${y}`;
    let t = cache.get(key);
    if (t) { cache.delete(key); cache.set(key, t); return t; }  // LRU
    const img = new Image();
    img.crossOrigin = 'anonymous';             // 캔버스 PNG 내보내기·3D 텍스처가 막히지 않도록
    t = { img, ok: false, failed: false };
    img.onload = () => { t.ok = true; requestRender(); if (self.onTile) self.onTile(); };   // 3D 지면도 다시 그림
    img.onerror = () => { t.failed = true; };
    img.src = url(z, x, y);
    cache.set(key, t);
    if (cache.size > LIMIT) cache.delete(cache.keys().next().value);
    return t;
  }

  function peek(name, z, x, y) { const t = cache.get(`${name}/${z}/${x}/${y}`); return t && t.ok ? t : null; }

  /**
   * @param ctx 현장 좌표(m)로 변환이 걸린 캔버스 컨텍스트
   * @param s   화면 px / m
   * @param view 화면에 보이는 현장 좌표 범위 {minX,minY,maxX,maxY}
   */
  function draw(ctx, s, view) {
    const def = basemapDef(S.layers.basemap);
    if (!def) return;
    const name = Object.keys(BASEMAPS).find(k => BASEMAPS[k] === def);
    drawTiles(ctx, s, view, name, def.url, def.maxZoom, 3, true);
    if (def.overlay) drawTiles(ctx, s, view, name + '+o', def.overlay, def.maxZoom, 3, false);
  }
  /** 연속지적도 겹치기 (줌 15 이상에서만 — 그보다 넓으면 선이 뭉개지고 요청이 많아짐) */
  function drawCadastral(ctx, s, view) {
    if (!VWORLD.key) return;
    drawTiles(ctx, s, view, 'cadastral', (z, x, y) => `${VWORLD.base}/api/vworld/cadastral/${z}/${x}/${y}.png`, 19, 15, false);
  }

  function drawTiles(ctx, s, view, name, url, maxZoom, minZoom, fallback) {
    const frame = getFrame();
    if (!frame) return;
    const lat0 = frame.lat0;
    let z = Math.ceil(Math.log2(156543.034 * Math.cos(lat0 * Math.PI / 180) * s * DPR / 1.0));
    if (z < minZoom) return;
    z = Math.max(3, Math.min(maxZoom, z));

    const corners = [[view.minX, view.minY], [view.maxX, view.minY], [view.maxX, view.maxY], [view.minX, view.maxY]].map(([x, y]) => frame.toLatLon(x, y));
    let x0, x1, y0, y1;
    for (;;) {
      x0 = Math.floor(Math.min(...corners.map(c => tileX(c.lon, z)))); x1 = Math.floor(Math.max(...corners.map(c => tileX(c.lon, z))));
      y0 = Math.floor(Math.min(...corners.map(c => tileY(c.lat, z)))); y1 = Math.floor(Math.max(...corners.map(c => tileY(c.lat, z))));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 120 || z <= 3) break;
      z--;
    }
    const n = 2 ** z;
    ctx.imageSmoothingEnabled = true;
    for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        const nw = frame.toLocal(tileLat(ty, z), tileLon(tx, z));
        const se = frame.toLocal(tileLat(ty + 1, z), tileLon(tx + 1, z));
        const t = get(name, url, z, wx, ty);
        if (t.ok) { ctx.drawImage(t.img, nw.x, nw.y, se.x - nw.x, se.y - nw.y); continue; }
        if (!fallback) continue;
        // 아직 안 받은 타일은 이미 받아둔 상위 타일을 확대해 임시로 채운다
        for (let k = 1; k <= 4 && z - k >= 0; k++) {
          const p = peek(name, z - k, wx >> k, ty >> k);
          if (!p) continue;
          const part = 256 / 2 ** k, sx = (wx % 2 ** k) * part, sy = (ty % 2 ** k) * part;
          ctx.drawImage(p.img, sx, sy, part, part, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
          break;
        }
      }
    }
  }

  /**
   * 2026-11-22 위성 영상 한 장 만들기 (지도에서 AI 건물 따기용) — 범위의 타일을 모두 받아 캔버스에 그린다.
   * 지금 배경이 위성이 아니면(일반 지도·끄기) 위성 영상으로 받는다. 화면 지도와 같은 배치(모서리 2점)라 좌표가 그대로 맞는다.
   * @param view {minX,minY,maxX,maxY} 현장 좌표(m)  @param k 캔버스 px / m
   * @returns Promise<{canvas, k, view, source, missing}>  canvas px = (x − minX)·k, (y − minY)·k
   */
  function capture(view, k, timeoutMs = 12000) {
    const frame = getFrame();
    if (!frame) return Promise.reject(new Error('현장 위치가 없습니다.'));
    let def = basemapDef(S.layers.basemap);
    if (!def || !/영상|위성/.test(def.label)) def = basemapDef(VWORLD.key ? 'vworld' : 'satellite');
    const name = Object.keys(BASEMAPS).find(kk => BASEMAPS[kk] === def);
    const z = Math.max(3, Math.min(def.maxZoom, Math.ceil(Math.log2(156543.034 * Math.cos(frame.lat0 * Math.PI / 180) * k))));
    const corners = [[view.minX, view.minY], [view.maxX, view.minY], [view.maxX, view.maxY], [view.minX, view.maxY]].map(([x, y]) => frame.toLatLon(x, y));
    const x0 = Math.floor(Math.min(...corners.map(c => tileX(c.lon, z)))), x1 = Math.floor(Math.max(...corners.map(c => tileX(c.lon, z))));
    const y0 = Math.floor(Math.min(...corners.map(c => tileY(c.lat, z)))), y1 = Math.floor(Math.max(...corners.map(c => tileY(c.lat, z))));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return Promise.reject(new Error('범위가 너무 넓습니다.'));
    const tiles = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) tiles.push({ tx, ty, t: get(name, def.url, z, tx, ty) });
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const waiting = tiles.some(o => !o.t.ok && !o.t.failed);
        if (waiting && Date.now() - t0 < timeoutMs) { setTimeout(tick, 120); return; }
        const c = document.createElement('canvas');
        c.width = Math.round((view.maxX - view.minX) * k); c.height = Math.round((view.maxY - view.minY) * k);
        const g = c.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
        g.setTransform(k, 0, 0, k, -view.minX * k, -view.minY * k);
        g.imageSmoothingEnabled = true;
        let missing = 0;
        for (const o of tiles) {
          if (!o.t.ok) { missing++; continue; }
          const nw = frame.toLocal(tileLat(o.ty, z), tileLon(o.tx, z)), se = frame.toLocal(tileLat(o.ty + 1, z), tileLon(o.tx + 1, z));
          g.drawImage(o.t.img, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
        }
        resolve({ canvas: c, k, view, source: def.label, attribution: def.attribution, missing, total: tiles.length, zoom: z });
      };
      tick();
    });
  }

  const self = {
    draw, drawCadastral, capture,
    attribution: () => [(basemapDef(S.layers.basemap) || {}).attribution, S.layers.cadastral && VWORLD.key ? '지적도 © 국토교통부' : ''].filter(Boolean).join(' · '),
    onTile: null,   // 타일 하나가 도착할 때마다 (3D 지면 다시 그리기)
  };
  return self;
})();

/** 주소 → 위경도 (OpenStreetMap Nominatim, 이용 정책상 가끔 쓰는 검색만) */
async function geocodeAddress(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ko&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`주소 검색 실패 (${res.status})`);
  return (await res.json()).map(r => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
}
