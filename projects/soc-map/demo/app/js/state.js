/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 앱 상태, 실행 취소/다시 실행, 자동 저장
 *
 *  모든 도형·장비 좌표와 치수는 "현장 좌표계(m)" 이다.
 *    원점 = 프로젝트 위치(위경도), x = 동쪽, y = 남쪽 (geo.js LocalFrame)
 *  배치도 이미지는 S.plan.transform(도면 px → 현장 m)으로 지도 위에 겹쳐 그린다.
 *  v11/v12 의 픽셀 좌표 문서는 applyDoc 에서 자동 변환한다.
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const APP_VERSION = 13;
const AUTOSAVE_KEY = 'socmap.v13.doc';
const AUTOSAVE_BG_KEY = 'socmap.v13.bg';

const DEFAULT_SETTINGS = { buildingHeight: 18, safetyLevel: 10, roadWidth: 3, fenceWidth: 0.4, showUnderground: true };

const S = {
  // ── 문서(저장 대상) ──
  project: { id: null, name: '새 현장', origin: null },   // origin: {lat, lon}
  plan: { width: 0, height: 0, transform: null, refs: [], opacity: 0.85 },
  bgImage: null, bgImageSrc: null,                           // 배치도 이미지 (px)
  nodes: [], contours: [],
  markers: [], polylines: [], fences: [], walkableAreaPolygon: [],
  customItems: [],
  buildingData: {},
  siteEnvironment: { windSpeed: 0, envZones: [] },
  settings: { ...DEFAULT_SETTINGS },

  // ── 화면 상태 ──
  mode: 'select', envZoneType: 'softGround',
  layers: { bg: true, heat: false, zones: true, shortest: true, basemap: 'satellite' },
  view: { s: 0, ox: 0, oy: 0 },            // 화면 = 현장 좌표(m) × s + (ox, oy)
  selection: null,
  route: null,
  backendOnline: false,
  draft: null,
  measure: null,                       // 거리·면적 측정 {points: [x,y,...], closed}
  live: {},                            // 운전원 휴대폰이 보낸 장비 실시간 위치 {markerId: {x, y, heading, ts}}
};

let _idSeq = Date.now();
function newId(prefix = 'id') { return `${prefix}_${(_idSeq++).toString(36)}`; }

const DOC_KEYS = ['project', 'plan', 'nodes', 'contours', 'markers', 'polylines', 'fences', 'walkableAreaPolygon',
  'customItems', 'buildingData', 'siteEnvironment', 'settings'];

function serializeDoc() {
  const doc = { version: APP_VERSION, units: 'm' };
  for (const k of DOC_KEYS) doc[k] = S[k];
  return JSON.stringify(doc, (key, val) => (key.startsWith('_') ? undefined : val));
}

/** 현장 좌표계 (프로젝트 위치가 정해졌을 때만) */
let _frameCache = { key: null, frame: null };
function getFrame() {
  const o = S.project.origin;
  if (!o) return null;
  const key = o.lat + ',' + o.lon;
  if (_frameCache.key !== key) _frameCache = { key, frame: new LocalFrame(o.lat, o.lon) };
  return _frameCache.frame;
}

/** 도면 px → 현장 m 변환 */
function planTransform() {
  return S.plan.transform ? makeTransform(S.plan.transform) : null;
}

/** 새 도면의 기본 배치: 원점 중심, 1px = 0.1m (정합 전 임시) */
function defaultPlanTransform(w, h, mpp = 0.1) {
  return [mpp, 0, -w * mpp / 2, 0, mpp, -h * mpp / 2];
}

// ═══════════════════════════════════════════════
//  문서 적용 + 이전 버전(픽셀 좌표) 변환
// ═══════════════════════════════════════════════

function applyDoc(doc) {
  doc = doc.units === 'm' ? doc : migratePixelDoc(doc);
  S.project = { id: null, name: '새 현장', origin: null, ...(doc.project || {}) };
  S.plan = { width: 0, height: 0, transform: null, refs: [], opacity: 0.85, ...(doc.plan || {}) };
  S.nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  S.contours = Array.isArray(doc.contours) ? doc.contours : [];
  S.markers = (Array.isArray(doc.markers) ? doc.markers : []).map(m => ({ ...m, id: m.id || newId('m') }));
  S.polylines = (doc.polylines || []).map(l => (Array.isArray(l) ? { points: l, width: DEFAULT_SETTINGS.roadWidth } : l));
  S.fences = (doc.fences || []).map(l => (Array.isArray(l) ? { points: l, width: DEFAULT_SETTINGS.fenceWidth } : l));
  S.walkableAreaPolygon = Array.isArray(doc.walkableAreaPolygon) ? doc.walkableAreaPolygon : [];
  S.customItems = Array.isArray(doc.customItems) ? doc.customItems : [];
  S.buildingData = doc.buildingData && typeof doc.buildingData === 'object' ? doc.buildingData : {};
  const env = doc.siteEnvironment || {};
  S.siteEnvironment = {
    windSpeed: +env.windSpeed || 0,
    envZones: (env.envZones || []).filter(z => z && Array.isArray(z.polygon)).map(z => ({ ...z, id: z.id || newId('z') })),
  };
  S.settings = { ...DEFAULT_SETTINGS, ...(doc.settings || {}) };
  invalidateExtent();
}

const LENGTH_PARAMS = ['r_max', 'r_blind', 'L_boom', 'r_load', 'r_outrigger', 'r_mast', 'L_jib', 'd_trolley', 'r_shadow',
  'L_mast', 'L_base', 'r_buffer', 'r_boom', 'L_car', 'W_car', 'D_sign'];

/**
 * v11/v12 문서(도면 픽셀 좌표)를 현장 m 좌표로 변환.
 * GPS 기준점(geoRefs)이 2개 이상이면 그 위치로 프로젝트 원점과 도면 정합을 만들고,
 * 없으면 축척(metersPerPx)만으로 변환한다(위치 미지정 프로젝트).
 */
function migratePixelDoc(doc) {
  const mpp = (doc.settings && doc.settings.metersPerPx) || 0.1;
  const refs = (doc.geoRefs || []).filter(r => isFinite(r.lat) && isFinite(r.lon));
  let origin = null, T;
  if (refs.length >= 2) {
    origin = { lat: refs.reduce((s, r) => s + r.lat, 0) / refs.length, lon: refs.reduce((s, r) => s + r.lon, 0) / refs.length };
    const F = new LocalFrame(origin.lat, origin.lon);
    T = fitTransform(refs.map(r => ({ src: { x: r.x, y: r.y }, dst: F.toLocal(r.lat, r.lon) })));
  }
  if (!T) T = makeTransform([mpp, 0, 0, 0, mpp, 0]);
  const k = T.scale, rot = T.rotation * Math.PI / 180;
  const P = (x, y) => T.apply({ x, y });
  const flat = (arr) => { const o = []; for (let i = 0; i + 1 < arr.length; i += 2) { const p = P(arr[i], arr[i + 1]); o.push(p.x, p.y); } return o; };

  const out = { ...doc, units: 'm' };
  out.project = { id: null, name: '가져온 현장', origin };
  out.plan = {
    width: 0, height: 0, transform: T.matrix, opacity: 0.85,
    refs: refs.map(r => ({ id: r.id || newId('g'), px: { x: r.x, y: r.y }, lat: r.lat, lon: r.lon })),
  };
  out.nodes = (doc.nodes || []).map(n => { const p = P(n.cx, n.cy); return { ...n, cx: p.x, cy: p.y }; });
  out.contours = (doc.contours || []).map(c => c.map(pt => { const q = Array.isArray(pt[0]) ? pt[0] : pt; const p = P(+q[0], +q[1]); return [[p.x, p.y]]; }));
  out.markers = (doc.markers || []).map(m => {
    const p = P(m.x, m.y), r = { ...m, x: p.x, y: p.y };
    if (m.isEquipment) {
      r.heading = (m.heading || 0) + rot;
      r.equipmentParams = { ...(m.equipmentParams || {}) };
      for (const key of LENGTH_PARAMS) if (r.equipmentParams[key] != null) r.equipmentParams[key] = +(r.equipmentParams[key] * k).toFixed(2);
    } else r.radius = +((m.radius || 30) * k).toFixed(2);
    return r;
  });
  const line = (l, w) => { const pts = Array.isArray(l) ? l : l.points; return { points: flat(pts), width: w }; };
  out.polylines = (doc.polylines || []).map(l => line(l, Math.max(1, ((l.thickness || 6) * k))));
  out.fences = (doc.fences || []).map(l => line(l, DEFAULT_SETTINGS.fenceWidth));
  out.walkableAreaPolygon = flat(doc.walkableAreaPolygon || []);
  out.siteEnvironment = { ...(doc.siteEnvironment || {}), envZones: ((doc.siteEnvironment || {}).envZones || []).map(z => ({ ...z, polygon: flat(z.polygon || []) })) };
  out.customItems = (doc.customItems || []).map(c => ({ ...c, defaultRadius: +((c.defaultRadius || 30) * k).toFixed(1) }));
  out.settings = { ...DEFAULT_SETTINGS, safetyLevel: (doc.settings || {}).safetyLevel ?? 10 };
  return out;
}

// ═══════════════════════════════════════════════
//  현장 범위 (화면 맞춤 · 경로 격자 · 히트맵)
// ═══════════════════════════════════════════════

let _extent = null;
function invalidateExtent() { _extent = null; }

function docExtent() {
  if (_extent) return _extent;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  const T = planTransform();
  if (T && S.plan.width) for (const [x, y] of [[0, 0], [S.plan.width, 0], [S.plan.width, S.plan.height], [0, S.plan.height]]) { const p = T.apply({ x, y }); add(p.x, p.y); }
  for (const c of S.contours) for (const pt of c) { const q = Array.isArray(pt[0]) ? pt[0] : pt; add(+q[0], +q[1]); }
  for (const m of S.markers) { const r = m.isEquipment ? 15 : (m.radius || 3); add(m.x - r, m.y - r); add(m.x + r, m.y + r); }
  const flat = (a) => { for (let i = 0; i + 1 < a.length; i += 2) add(a[i], a[i + 1]); };
  S.polylines.forEach(l => flat(l.points)); S.fences.forEach(l => flat(l.points)); flat(S.walkableAreaPolygon);
  S.siteEnvironment.envZones.forEach(z => flat(z.polygon));
  if (!isFinite(minX)) { minX = -100; maxX = 100; minY = -60; maxY = 60; }
  const pad = Math.max(10, 0.05 * Math.max(maxX - minX, maxY - minY));
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  _extent = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  return _extent;
}

// ═══════════════════════════════════════════════
//  변경 알림 → 렌더 / 위험도 캐시 / 히스토리 / 자동 저장
// ═══════════════════════════════════════════════

const History = {
  stack: [], index: -1, timer: null, limit: 80,
  init() { this.stack = [serializeDoc()]; this.index = 0; },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 350); },
  flush() {
    clearTimeout(this.timer); this.timer = null;
    const snap = serializeDoc();
    if (snap === this.stack[this.index]) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    Autosave.save(snap);
    onHistoryChange();
  },
  canUndo() { return this.index > 0 || this.timer !== null; },
  canRedo() { return this.index < this.stack.length - 1; },
  undo() { if (this.timer) this.flush(); if (this.index <= 0) return false; this.index--; this.restore(); return true; },
  redo() { if (this.index >= this.stack.length - 1) return false; this.index++; this.restore(); return true; },
  restore() {
    applyDoc(JSON.parse(this.stack[this.index]));
    Autosave.save(this.stack[this.index]);
    invalidateRisk();
    onDocReplaced();
    onHistoryChange();
  },
};

const Autosave = {
  save(snap) { try { localStorage.setItem(AUTOSAVE_KEY, snap); } catch (e) { /* 저장 공간 부족 */ } },
  saveBackground() {
    try {
      if (S.bgImageSrc) localStorage.setItem(AUTOSAVE_BG_KEY, S.bgImageSrc); else localStorage.removeItem(AUTOSAVE_BG_KEY);
      return true;
    } catch (e) {
      try { localStorage.removeItem(AUTOSAVE_BG_KEY); } catch (_) { /* noop */ }
      return false;
    }
  },
  load() {
    try {
      let doc = localStorage.getItem(AUTOSAVE_KEY), bg = localStorage.getItem(AUTOSAVE_BG_KEY);
      if (!doc) { doc = localStorage.getItem('socmap.v12.doc'); bg = localStorage.getItem('socmap.v12.bg'); } // v12 자동 저장 이어받기
      return doc ? { doc: JSON.parse(doc), bg } : null;
    } catch (e) { return null; }
  },
  clear() {
    try { for (const k of [AUTOSAVE_KEY, AUTOSAVE_BG_KEY, 'socmap.v12.doc', 'socmap.v12.bg']) localStorage.removeItem(k); } catch (e) { /* noop */ }
  },
};

/** 운전원 휴대폰의 실시간 위치를 반영한 장비 목록 */
function liveMarkers() {
  const live = S.live;
  if (!Object.keys(live).length) return S.markers;
  return S.markers.map(m => (live[m.id] ? { ...m, x: live[m.id].x, y: live[m.id].y, heading: live[m.id].heading ?? m.heading, _live: live[m.id] } : m));
}

let _riskVersion = 0, _riskField = null, _riskFieldVersion = -1;
function invalidateRisk() { _riskVersion++; invalidateExtent(); }
function getRiskField() {
  if (_riskFieldVersion !== _riskVersion) {
    _riskField = new RiskField(liveMarkers(), S.siteEnvironment);
    _riskFieldVersion = _riskVersion;
  }
  return _riskField;
}
function riskVersion() { return _riskVersion; }

function changed(opts = {}) {
  if (opts.risk !== false) invalidateRisk(); else invalidateExtent();
  if (opts.history !== false) History.schedule();
  onDocChanged(opts);
}

let onDocChanged = () => {};
let onDocReplaced = () => {};
let onHistoryChange = () => {};
