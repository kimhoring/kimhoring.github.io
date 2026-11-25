/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v14.8 — 위험 표시 그림 (관리자 2D 지도 · 휴대폰 지도 · 3D 표지 공용)
 *
 *  목표: 그림만 보고 "여기는 못 지나간다 / 감전 / 추락 / 빠진다"를 바로 알게 한다.
 *   - 표지는 현장에 실제로 붙는 안전보건표지 모양을 따른다 (산업안전보건법 시행규칙 별표 6 안전보건표지):
 *       금지표지 = 흰 바탕 빨간 원 + 사선(출입 금지), 경고표지 = 노란 삼각형 + 검정 그림(고압전기·추락·위험 장소 …)
 *   - 울타리 = 실제 가설 울타리처럼 빨강·흰 줄무늬 띠 + 기둥 + 출입 금지 표지.
 *     닫힌 울타리(처음과 끝이 만남)는 안쪽을 빨간 빗금 「통행 금지 구역」으로 칠한다 — 경로 탐색도 안쪽으로 못 들어감
 *   - 구역마다 무늬가 다르다: 연약지반 = 진흙 물결, 급경사 = 오르막 꺾쇠, 고압선 = 노랑·검정 경고 띠, 침수 = 물결
 *   - 그림 아래에 글자 판(「통행 금지」「고압 전기 · 감전」)을 붙여 표지를 몰라도 읽힌다
 *
 *  그리는 함수는 모두 (g: 2D 컨텍스트, …, px: 화면 px → 지금 좌표 단위) 를 받는다 — 지도(m 좌표)와 아이콘(px 좌표)이 같은 코드.
 *  Node 테스트(vm)에서도 불러올 수 있게 최상위에서는 document 를 쓰지 않는다.
 *  필요한 전역: 없음 (costmap.js 의 powerLineClearance 가 있으면 고압선 이격거리를 글자 판에 씀)
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const HZ_FONT = '"Pretendard","Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif';

/** 환경 구역 그림 (위험도 수치는 costmap.js ENV_ZONE_TYPES — 여기는 보이는 모양만) */
const HZ_ZONE_STYLE = {
  softGround:  { sign: 'sink',    pattern: 'mud',   color: '#d97706', tag: '연약지반 · 침하 위험', tagBg: '#facc15', tagFg: '#111827' },
  steepSlope:  { sign: 'slope',   pattern: 'slope', color: '#f97316', tag: '급경사 30% 이상',     tagBg: '#facc15', tagFg: '#111827' },
  powerLine:   { sign: 'voltage', pattern: 'volt',  color: '#facc15', tag: '고압선 · 감전 위험',   tagBg: '#facc15', tagFg: '#111827', tape: true },
  floodedArea: { sign: 'flood',   pattern: 'water', color: '#3b82f6', tag: '침수 지역 · 진입 금지', tagBg: '#2563eb', tagFg: '#ffffff' },
};
/** 위험물(지점) 그림 — ui.js HAZARD_ITEMS 의 type. name 은 기본 이름(사용자가 바꾸면 글자 판 아래에 따로 보여 줌) */
const HZ_MARKER_STYLE = {
  barricade:    { name: '통제구역',    sign: 'noEntry', pattern: 'noEntry', tape: ['#ffffff', '#dc2626'], tag: '출입 금지',          tagBg: '#dc2626', tagFg: '#ffffff' },
  high_voltage: { name: '고전압/전기', sign: 'voltage', pattern: 'volt',    tape: ['#111827', '#facc15'], tag: '고압 전기 · 감전',   tagBg: '#facc15', tagFg: '#111827' },
  hole:         { name: '개구부/낙하', sign: 'fall',    pit: true,          tape: ['#111827', '#facc15'], tag: '개구부 · 추락 위험', tagBg: '#facc15', tagFg: '#111827' },
  warning:      { name: '일반 위험',   sign: 'danger',  fill: 'rgba(249,115,22,0.24)', tape: ['#7c2d12', '#fb923c'], tag: '위험 · 주의', tagBg: '#f97316', tagFg: '#111827' },
};
const hzZoneSign = (type) => (HZ_ZONE_STYLE[type] || {}).sign || 'danger';
const hzMarkerSign = (type) => (HZ_MARKER_STYLE[type] || {}).sign || null;

// ═══════════════════════════════════════════════
//  표지 (100 × 100 설계 격자, 가운데가 0,0)
// ═══════════════════════════════════════════════

/** 표지 하나. size = 표지 전체 지름(지금 좌표 단위) */
function hzSign(g, kind, x, y, size) {
  g.save();
  g.translate(x, y); g.scale(size / 100, size / 100);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (kind === 'noEntry') hzNoEntry(g);
  else {
    hzTriangle(g);
    g.fillStyle = '#111827'; g.strokeStyle = '#111827';
    (HZ_PICTO[kind] || HZ_PICTO.danger)(g);
  }
  g.restore();
}

/** 경고표지 바탕: 흰 테두리(어두운 지도에서도 보이게) + 노란 삼각형 + 검정 테두리 */
function hzTriangle(g) {
  const tri = () => { g.beginPath(); g.moveTo(0, -45); g.lineTo(49, 40); g.lineTo(-49, 40); g.closePath(); };
  tri(); g.lineWidth = 15; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
  tri(); g.fillStyle = '#facc15'; g.fill();
  g.lineWidth = 7; g.strokeStyle = '#111827'; g.stroke();
}

/** 금지표지(출입 금지): 흰 원 + 빨간 테 + 걷는 사람 + 빨간 사선 */
function hzNoEntry(g) {
  g.beginPath(); g.arc(0, 0, 49, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
  // 걷는 사람
  g.fillStyle = '#111827'; g.strokeStyle = '#111827'; g.lineWidth = 8;
  g.beginPath(); g.arc(3, -24, 7.5, 0, Math.PI * 2); g.fill();
  g.beginPath();
  g.moveTo(1, -13); g.lineTo(-2, 8);            // 몸
  g.moveTo(-2, 8); g.lineTo(-13, 27);           // 뒷다리
  g.moveTo(-2, 8); g.lineTo(9, 18); g.lineTo(11, 30);   // 앞다리
  g.moveTo(0, -9); g.lineTo(-13, 2);            // 뒷팔
  g.moveTo(0, -9); g.lineTo(13, -1);            // 앞팔
  g.stroke();
  // 빨간 테 + 사선 (왼쪽 위 → 오른쪽 아래)
  g.beginPath(); g.arc(0, 0, 41, 0, Math.PI * 2); g.lineWidth = 12; g.strokeStyle = '#dc2626'; g.stroke();
  g.beginPath(); g.moveTo(-29, -29); g.lineTo(29, 29); g.lineWidth = 11; g.stroke();
}

/** 경고표지 안 그림 (검정) — 삼각형 안쪽 대략 x ±28, y −20 ~ 34 */
const HZ_PICTO = {
  danger(g) {   // 위험 장소: 느낌표
    g.beginPath(); g.moveTo(-5.5, -19); g.lineTo(5.5, -19); g.lineTo(3.5, 14); g.lineTo(-3.5, 14); g.closePath(); g.fill();
    g.beginPath(); g.arc(0, 26, 5.5, 0, Math.PI * 2); g.fill();
  },
  voltage(g) {  // 고압 전기: 번개
    g.beginPath();
    g.moveTo(6, -24); g.lineTo(-13, 9); g.lineTo(-1, 9); g.lineTo(-8, 35); g.lineTo(15, -3); g.lineTo(3, -3); g.lineTo(13, -24);
    g.closePath(); g.fill();
  },
  fall(g) {     // 개구부 추락: 구멍 + 빠지는 사람
    g.beginPath(); g.ellipse(0, 28, 27, 7.5, 0, 0, Math.PI * 2); g.fill();
    g.lineWidth = 6.5;
    g.beginPath(); g.arc(9, -13, 6, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.moveTo(6, -5); g.lineTo(-1, 13);                // 몸
    g.moveTo(-1, 13); g.lineTo(-11, 20);              // 다리
    g.moveTo(-1, 13); g.lineTo(4, 23);
    g.moveTo(4, -1); g.lineTo(-10, -11);              // 들린 팔
    g.moveTo(4, -1); g.lineTo(18, -6);
    g.stroke();
  },
  sink(g) {     // 연약지반: 반쯤 빠진 상자 + 진흙 물결
    g.save();
    g.beginPath(); g.moveTo(0, -45); g.lineTo(49, 40); g.lineTo(-49, 40); g.closePath(); g.clip();
    g.save(); g.translate(-2, 8); g.rotate(-0.22); g.fillRect(-15, -15, 30, 22); g.restore();
    g.fillStyle = '#facc15';   // 상자 아랫부분을 진흙(바탕색)으로 덮는다
    g.beginPath(); g.moveTo(-40, 16); for (let x = -40; x <= 40; x += 2) g.lineTo(x, 16 + 3 * Math.sin(x / 5)); g.lineTo(40, 40); g.lineTo(-40, 40); g.closePath(); g.fill();
    g.restore();
    g.lineWidth = 4.5;
    for (const yy of [16, 27]) {
      g.beginPath();
      for (let x = -26 + (yy - 16) * 0.4; x <= 26 - (yy - 16) * 0.4; x += 2) { const y = yy + 3 * Math.sin(x / 5); x === -26 + (yy - 16) * 0.4 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    // 아래로 화살표
    g.lineWidth = 4; g.beginPath(); g.moveTo(20, -8); g.lineTo(20, 6); g.moveTo(15, 1); g.lineTo(20, 7); g.lineTo(25, 1); g.stroke();
  },
  slope(g) {    // 급경사: 비탈 + 구르는 돌
    g.beginPath(); g.moveTo(-28, 33); g.lineTo(28, 33); g.lineTo(28, -6); g.closePath(); g.fill();
    g.beginPath(); g.arc(-8, 8, 6.5, 0, Math.PI * 2); g.fill();
    g.lineWidth = 3.5; g.beginPath(); g.arc(-8, 8, 12, Math.PI * 0.95, Math.PI * 1.45); g.stroke();
  },
  flood(g) {    // 침수: 물결 세 줄
    g.lineWidth = 5;
    for (const [yy, w] of [[-4, 16], [9, 22], [22, 28]]) {
      g.beginPath();
      for (let x = -w; x <= w; x += 2) { const y = yy + 3.5 * Math.sin(x / 4.5); x === -w ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
  },
};

// ═══════════════════════════════════════════════
//  무늬 (화면 px 기준 크기 — 확대해도 같은 굵기)
// ═══════════════════════════════════════════════

const HZ_TILE_RES = 2;   // 고해상도 화면에서 흐리지 않게 2배로 만든다
const _hzTiles = {};
/** 무늬 한 칸 캔버스 (3D 텍스처도 이것을 씀) */
function hzTile(kind) {
  if (_hzTiles[kind]) return _hzTiles[kind];
  if (typeof document === 'undefined') return null;
  const T = kind === 'mud' ? 24 : kind === 'water' ? 22 : 16, R = HZ_TILE_RES;
  const c = document.createElement('canvas'); c.width = c.height = T * R;
  const g = c.getContext('2d'); g.scale(R, R); g.lineCap = 'round';
  const diag = (color, lw, flip, off = 0) => {
    g.strokeStyle = color; g.lineWidth = lw; g.beginPath();
    for (const k of [-T, 0, T]) {
      if (!flip) { g.moveTo(k + off - 1, T + 1); g.lineTo(k + off + T + 1, -1); }
      else { g.moveTo(k + off - 1, -1); g.lineTo(k + off + T + 1, T + 1); }
    }
    g.stroke();
  };
  const wave = (y, amp, color, lw) => {
    g.strokeStyle = color; g.lineWidth = lw; g.beginPath();
    for (let x = 0; x <= T; x += 1) { const yy = y + amp * Math.sin(x / T * Math.PI * 2); x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
    g.stroke();
  };
  switch (kind) {
    case 'noEntry':   // 빨간 빗금 (통행 금지)
      g.fillStyle = 'rgba(220,38,38,0.20)'; g.fillRect(0, 0, T, T);
      diag('rgba(239,68,68,0.95)', 3.2, false);
      break;
    case 'volt':      // 노랑·검정 경고 띠
      g.fillStyle = 'rgba(250,204,21,0.16)'; g.fillRect(0, 0, T, T);
      diag('rgba(250,204,21,0.85)', 3.4, true);
      diag('rgba(17,24,39,0.45)', 3.4, true, T / 2);
      break;
    case 'mud':       // 진흙 물결 + 점
      g.fillStyle = 'rgba(180,83,9,0.30)'; g.fillRect(0, 0, T, T);
      wave(7, 2.2, 'rgba(251,191,36,0.9)', 2);
      wave(17, 2.2, 'rgba(120,53,15,0.8)', 2);
      g.fillStyle = 'rgba(253,230,138,0.85)'; g.beginPath(); g.arc(T * 0.25, 12, 1.3, 0, Math.PI * 2); g.arc(T * 0.75, 2, 1.1, 0, Math.PI * 2); g.fill();
      break;
    case 'slope':     // 오르막 꺾쇠
      g.fillStyle = 'rgba(249,115,22,0.16)'; g.fillRect(0, 0, T, T);
      g.strokeStyle = 'rgba(253,186,116,0.95)'; g.lineWidth = 2; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(2, 11); g.lineTo(8, 5); g.lineTo(14, 11); g.stroke();
      break;
    case 'water':     // 물결
      g.fillStyle = 'rgba(37,99,235,0.26)'; g.fillRect(0, 0, T, T);
      wave(6, 2, 'rgba(147,197,253,0.95)', 2);
      wave(16, 2, 'rgba(191,219,254,0.7)', 1.6);
      break;
    default:
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, T, T);
  }
  return (_hzTiles[kind] = c);
}

const _hzPatterns = new WeakMap();
/** 무늬 채우기 — 화면 px 크기를 유지하도록 지금 축척(px(1))에 맞춘다 */
function hzPattern(g, kind, px) {
  let map = _hzPatterns.get(g);
  if (!map) { map = {}; _hzPatterns.set(g, map); }
  let p = map[kind];
  if (p === undefined) {
    const tile = hzTile(kind);
    p = map[kind] = tile ? g.createPattern(tile, 'repeat') : null;
  }
  if (p && p.setTransform && typeof DOMMatrix !== 'undefined') {
    const k = px(1) / HZ_TILE_RES;
    p.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
  }
  return p;
}

// ═══════════════════════════════════════════════
//  글자 판 · 경계선
// ═══════════════════════════════════════════════

/** 글자 판(둥근 사각형). y 는 판의 위쪽. 돌려주는 값 = 판 아래쪽 y */
function hzTag(g, text, x, y, px, bg = '#111827', fg = '#ffffff', size = 11.5) {
  if (!text) return y;
  g.save();
  g.font = `800 ${px(size)}px ${HZ_FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(text).width + px(12), h = px(size + 8), r = px(5), x0 = x - w / 2;
  g.beginPath();
  if (g.roundRect) g.roundRect(x0, y, w, h, r); else g.rect(x0, y, w, h);
  g.fillStyle = bg; g.fill();
  g.lineWidth = px(1.5); g.strokeStyle = 'rgba(0,0,0,0.75)'; g.stroke();
  g.fillStyle = fg; g.fillText(text, x, y + h / 2 + px(0.5));
  g.restore();
  return y + h;
}

/** 경고 띠 선: 두 색이 번갈아 (흰·빨강 = 통행 금지, 검정·노랑 = 위험). path() 는 경로를 만드는 함수 */
function hzTape(g, path, px, colors, width = 5, seg = 8) {
  const [a, b] = colors;
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'butt';
  path(); g.lineWidth = px(width + 2.5); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
  path(); g.lineWidth = px(width); g.strokeStyle = a; g.stroke();
  if (b) { path(); g.setLineDash([px(seg), px(seg)]); g.strokeStyle = b; g.stroke(); }
  g.restore();
}

function hzPolyPath(g, pts, close) {
  return () => {
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    if (close) g.closePath();
  };
}
function hzCentroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const x0 = p[i], y0 = p[i + 1], x1 = p[(i + 2) % n], y1 = p[(i + 3) % n], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) { let sx = 0, sy = 0; for (let i = 0; i < p.length; i += 2) { sx += p[i]; sy += p[i + 1]; } return { x: sx / (p.length / 2), y: sy / (p.length / 2) }; }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

// ═══════════════════════════════════════════════
//  울타리
// ═══════════════════════════════════════════════

const HZ_FENCE_CLOSE_M = 0.5;   // 처음·끝 점이 이 거리 안이면 닫힌 울타리 (경로 탐색에서도 안쪽이 막힘)
function hzFenceClosed(pts) {
  return !!pts && pts.length >= 8 && Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) <= HZ_FENCE_CLOSE_M;
}
function hzPolyLength(pts) {
  let L = 0;
  for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return L;
}
/** 선을 따라 거리 d 인 점 */
function hzPointAt(pts, d) {
  for (let i = 2; i < pts.length; i += 2) {
    const L = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (d <= L || i === pts.length - 2) { const t = L ? Math.min(1, d / L) : 0; return { x: pts[i - 2] + (pts[i] - pts[i - 2]) * t, y: pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t }; }
    d -= L;
  }
  return { x: pts[0], y: pts[1] };
}

/** 울타리 바닥(닫힌 울타리의 안쪽) — 다른 것보다 먼저 그린다 */
function hzFenceArea(g, f, px) {
  const pts = f.points;
  if (!hzFenceClosed(pts)) return;
  const path = hzPolyPath(g, pts, true);
  path(); g.fillStyle = hzPattern(g, 'noEntry', px) || 'rgba(220,38,38,0.25)'; g.fill();
}
/** 울타리 선: 빨강·흰 줄무늬 띠 + 기둥. o.signs !== false 면 표지·글자도 (hzFenceSigns) */
function hzFence(g, f, px, o = {}) {
  const pts = f.points;
  if (!pts || pts.length < 4) return;
  const closed = hzFenceClosed(pts), path = hzPolyPath(g, pts, false);
  const wpx = Math.max(6, (f.width || 0.4) / px(1));   // 실제 두께가 화면에서 더 굵으면 그 굵기
  hzTape(g, path, px, ['#ffffff', '#dc2626'], wpx, 9);
  // 기둥 (실제 약 2.5 m 간격, 너무 촘촘하면 화면 36 px 간격)
  const L = hzPolyLength(pts), step = Math.max(2.5, px(36));
  g.save();
  g.fillStyle = '#1f2937'; g.strokeStyle = '#f8fafc'; g.lineWidth = px(1.2);
  const post = (q) => { const r = px(3.2); g.fillRect(q.x - r, q.y - r, 2 * r, 2 * r); g.strokeRect(q.x - r, q.y - r, 2 * r, 2 * r); };
  for (let d = 0; d <= L + 1e-6; d += step) post(hzPointAt(pts, d));
  if (!closed) post({ x: pts[pts.length - 2], y: pts[pts.length - 1] });
  g.restore();
  if (o.signs !== false) hzFenceSigns(g, f, px);
}
/** 울타리 표지: 선 위 출입 금지 표지(가운데 + 화면 260 px 마다) + 「통행 금지」, 닫힌 울타리는 가운데에 「통행 금지 구역」 */
function hzFenceSigns(g, f, px) {
  const pts = f.points;
  if (!pts || pts.length < 4) return;
  const closed = hzFenceClosed(pts), L = hzPolyLength(pts);
  const gap = px(260), n = Math.max(1, Math.floor(L / gap));
  for (let k = 0; k < n; k++) {
    const q = hzPointAt(pts, L * (k + 0.5) / n);
    hzSign(g, 'noEntry', q.x, q.y, px(closed ? 18 : 22));
    if (!closed && k === Math.floor((n - 1) / 2)) hzTag(g, '통행 금지', q.x, q.y + px(13), px, '#dc2626', '#ffffff', 11);
  }
  if (closed) {
    const c = hzCentroid(pts);
    hzSign(g, 'noEntry', c.x, c.y - px(10), px(34));
    hzTag(g, '통행 금지 구역', c.x, c.y + px(10), px, '#dc2626', '#ffffff', 12.5);
  }
}

// ═══════════════════════════════════════════════
//  환경 구역 (연약지반 · 급경사 · 고압선 · 침수)
// ═══════════════════════════════════════════════

function hzZoneTag(z) {
  const st = HZ_ZONE_STYLE[z.type];
  if (!st) return '위험 구역';
  if (z.type === 'powerLine' && typeof powerLineClearance === 'function') {
    const kv = +z.kV > 0 ? +z.kV : (typeof DEFAULT_POWERLINE_KV !== 'undefined' ? DEFAULT_POWERLINE_KV : 22.9);
    return `고압선 ${kv}kV · 이격 ${powerLineClearance(kv)} m`;
  }
  return st.tag;
}
/** 구역 바탕(무늬 + 경계) */
function hzZoneArea(g, z, px) {
  const p = z.polygon;
  if (!p || p.length < 6) return;
  const st = HZ_ZONE_STYLE[z.type] || { color: '#ffffff', pattern: null };
  const path = hzPolyPath(g, p, true);
  path(); g.fillStyle = st.color + '22'; g.fill();
  const pat = st.pattern && hzPattern(g, st.pattern, px);
  if (pat) { path(); g.fillStyle = pat; g.fill(); }
  if (st.tape) hzTape(g, path, px, ['#111827', '#facc15'], 4.5, 10);
  else {
    g.save(); path(); g.lineJoin = 'round';
    g.lineWidth = px(5); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
    g.lineWidth = px(2.6); g.strokeStyle = st.color; g.stroke();
    g.restore();
  }
}
/** 구역 표지 + 글자 판 (도형 위 글자 층에서) */
function hzZoneLabel(g, z, px) {
  const p = z.polygon;
  if (!p || p.length < 6) return;
  const st = HZ_ZONE_STYLE[z.type] || { tagBg: '#111827', tagFg: '#fff' };
  const c = hzCentroid(p);
  hzSign(g, hzZoneSign(z.type), c.x, c.y - px(12), px(34));
  hzTag(g, hzZoneTag(z), c.x, c.y + px(10), px, st.tagBg, st.tagFg, 11.5);
}

// ═══════════════════════════════════════════════
//  위험물 (지점: 통제구역 · 고전압 · 개구부 · 일반 위험 · 사용자 정의)
// ═══════════════════════════════════════════════

/** 바닥 원: 무늬 또는 구멍 + 경고 띠 테두리. o.fill = 사용자 정의 항목 바탕색, o.sel = 선택됨 */
function hzMarkerDisc(g, m, px, o = {}) {
  const st = HZ_MARKER_STYLE[m.type], r = Math.max(m.radius || 1, px(6));
  const path = () => { g.beginPath(); g.arc(m.x, m.y, r, 0, Math.PI * 2); };
  if (st && st.pit) {   // 개구부: 실제 구멍처럼 가운데가 어두운 원
    const gr = g.createRadialGradient(m.x, m.y, r * 0.1, m.x, m.y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.7, 'rgba(12,10,9,0.88)'); gr.addColorStop(1, 'rgba(68,64,60,0.85)');
    path(); g.fillStyle = gr; g.fill();
  } else if (st) {
    path(); g.fillStyle = st.fill || (st.pattern === 'volt' ? 'rgba(250,204,21,0.16)' : 'rgba(220,38,38,0.16)'); g.fill();
    const pat = st.pattern && hzPattern(g, st.pattern, px);
    if (pat) { path(); g.fillStyle = pat; g.fill(); }
  } else {
    path(); g.fillStyle = o.fill || 'rgba(168,85,247,0.38)'; g.fill();
  }
  if (st) hzTape(g, path, px, st.tape, 5, 7);
  else { g.save(); path(); g.lineWidth = px(2); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.setLineDash([px(6), px(4)]); g.stroke(); g.restore(); }
  if (o.sel) { g.save(); g.beginPath(); g.arc(m.x, m.y, r + px(5), 0, Math.PI * 2); g.lineWidth = px(2.5); g.strokeStyle = '#60a5fa'; g.stroke(); g.restore(); }
}
/** 가운데 표지 + 글자 판. 사용자 정의 항목은 이모지 + 이름 */
function hzMarkerLabel(g, m, px, o = {}) {
  const st = HZ_MARKER_STYLE[m.type];
  if (st) {
    hzSign(g, st.sign, m.x, m.y - px(10), px(o.size || 30));
    let y = hzTag(g, st.tag, m.x, m.y + px(9), px, st.tagBg, st.tagFg, 11);
    if (m.label && m.label !== st.name) hzTag(g, m.label, m.x, y + px(2), px, 'rgba(15,23,42,0.9)', '#ffffff', 10.5);
  } else {
    g.save();
    g.font = `${px(22)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(m.icon || '⚠️', m.x, m.y - px(8));
    g.restore();
    hzTag(g, m.label || '위험', m.x, m.y + px(8), px, 'rgba(88,28,135,0.95)', '#ffffff', 11);
  }
}
function hzMarker(g, m, px, o = {}) { hzMarkerDisc(g, m, px, o); hzMarkerLabel(g, m, px, o); }

// ═══════════════════════════════════════════════
//  화면 목록용 아이콘 (표지를 그림으로)
// ═══════════════════════════════════════════════

const _hzIcons = {};
function hzIconURL(kind, size = 40) {
  if (!kind || typeof document === 'undefined') return null;
  const key = kind + ':' + size;
  if (_hzIcons[key]) return _hzIcons[key];
  try {
    const c = document.createElement('canvas'); c.width = c.height = size * 2;
    const g = c.getContext('2d'); if (!g) return null;
    hzSign(g, kind, size, size * (kind === 'noEntry' ? 1 : 1.04), size * 1.9);
    return (_hzIcons[key] = c.toDataURL('image/png'));
  } catch (e) { return null; }
}
/** <img> 태그 (만들 수 없으면 fallback 글자 — 이미 esc 된 것) */
function hzIconHTML(kind, fallback = '', cls = 'hz-ico') {
  const url = hzIconURL(kind);
  return url ? `<img class="${cls}" src="${url}" alt="" draggable="false">` : fallback;
}
