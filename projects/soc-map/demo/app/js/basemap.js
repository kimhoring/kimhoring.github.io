/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 배경 지도 (위성 / 일반 지도) 타일
 *  웹 메르카토르 타일을 프로젝트 국소 좌표(m)로 옮겨 캔버스에 그린다.
 *  현장 규모(수 km 이내)에서는 타일이 거의 직사각형으로 대응되므로 모서리 2점으로 배치한다.
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const BASEMAPS = {
  satellite: {
    label: '위성', maxZoom: 19,
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '위성영상 © Esri, Maxar, Earthstar Geographics',
  },
  street: {
    label: '일반 지도', maxZoom: 19,
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '지도 © OpenStreetMap contributors',
  },
};

const Basemap = (() => {
  const cache = new Map();   // key → {img, ok}
  const LIMIT = 500;
  const tileX = (lon, z) => (lon + 180) / 360 * 2 ** z;
  const tileY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
  const tileLon = (x, z) => x / 2 ** z * 360 - 180;
  const tileLat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };

  function get(layer, z, x, y) {
    const key = `${layer}/${z}/${x}/${y}`;
    let t = cache.get(key);
    if (t) { cache.delete(key); cache.set(key, t); return t; }  // LRU
    const img = new Image();
    img.crossOrigin = 'anonymous';             // 캔버스 PNG 내보내기·3D 텍스처가 막히지 않도록
    t = { img, ok: false, failed: false };
    img.onload = () => { t.ok = true; requestRender(); };
    img.onerror = () => { t.failed = true; };
    img.src = BASEMAPS[layer].url(z, x, y);
    cache.set(key, t);
    if (cache.size > LIMIT) cache.delete(cache.keys().next().value);
    return t;
  }

  function peek(layer, z, x, y) { const t = cache.get(`${layer}/${z}/${x}/${y}`); return t && t.ok ? t : null; }

  /**
   * @param ctx 현장 좌표(m)로 변환이 걸린 캔버스 컨텍스트
   * @param s   화면 px / m
   * @param view 화면에 보이는 현장 좌표 범위 {minX,minY,maxX,maxY}
   */
  function draw(ctx, s, view) {
    const layer = S.layers.basemap, def = BASEMAPS[layer], frame = getFrame();
    if (!def || !frame) return;
    const lat0 = frame.lat0;
    let z = Math.ceil(Math.log2(156543.034 * Math.cos(lat0 * Math.PI / 180) * s * DPR / 1.0));
    z = Math.max(3, Math.min(def.maxZoom, z));

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
        const t = get(layer, z, wx, ty);
        if (t.ok) { ctx.drawImage(t.img, nw.x, nw.y, se.x - nw.x, se.y - nw.y); continue; }
        // 아직 안 받은 타일은 이미 받아둔 상위 타일을 확대해 임시로 채운다
        for (let k = 1; k <= 4 && z - k >= 0; k++) {
          const p = peek(layer, z - k, wx >> k, ty >> k);
          if (!p) continue;
          const part = 256 / 2 ** k, sx = (wx % 2 ** k) * part, sy = (ty % 2 ** k) * part;
          ctx.drawImage(p.img, sx, sy, part, part, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
          break;
        }
      }
    }
  }

  return { draw, attribution: () => (BASEMAPS[S.layers.basemap] || {}).attribution || '' };
})();

/** 주소 → 위경도 (OpenStreetMap Nominatim, 이용 정책상 가끔 쓰는 검색만) */
async function geocodeAddress(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ko&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`주소 검색 실패 (${res.status})`);
  return (await res.json()).map(r => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
}
