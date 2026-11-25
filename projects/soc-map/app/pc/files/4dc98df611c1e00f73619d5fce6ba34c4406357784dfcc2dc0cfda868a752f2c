/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v14 — 건물 구조 시스템 · 공사 단계 · 이미지 기반 보정 (단위 m)
 *
 *  공사장 이미지(배치도·항공 사진)에서 얻은 건물 외곽을 실제 구조물에 가깝게 만드는 계산.
 *  - regularizeFootprint : AI 외곽선(울퉁불퉁한 다각형) → 주축 방향 직각 다각형 (단순화 + 직각 보정)
 *  - structuralLayout    : 구조 형식별 기둥 격자·보·내력벽·코어 배치 (3D 표현용 추정 — 구조 설계가 아님)
 *  - suggestStructure    : 외곽 형태로 구조 형식 추정 (판상형 공동주택 → 벽식 등)
 *  - offsetPolygon       : 외곽을 바깥으로 넓힘 (비계 · 터파기 범위)
 *  - sunPosition         : 날짜·시각·위치 → 태양 고도·방위 (3D 그림자, 그림자 높이 추정)
 *  - heightFromShadow    : 항공 사진의 그림자 길이 × tan(촬영 시각 태양 고도) = 건물 높이
 *  - readExifDate        : JPEG EXIF 촬영 시각
 *  좌표: 현장 좌표계 x = 동, y = 남 (geo.js LocalFrame). 다각형은 평탄화 배열 [x0,y0,x1,y1,...]
 *  costmap.js 의 pointToSegmentDistance · isPointInPolygon · polygonCentroid 를 쓴다.
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

/** 구조 형식 — 층고·경간·부재 크기는 대표 설계값(조정 가능)이며 법정 기준이 아니다 */
const STRUCTURE_TYPES = {
  wall:  { label: 'RC 벽식',   desc: '공동주택(아파트)에 주로 쓰는 내력벽 구조', floorH: 2.9, span: [4.5, 6.5], member: 0.2 },
  frame: { label: 'RC 라멘조', desc: '기둥·보 골조 (상가·업무·주차장)',          floorH: 3.6, span: [7.0, 9.0], member: 0.7 },
  steel: { label: '철골조',    desc: '철골 기둥·보 (공장·대형 판매·업무)',        floorH: 4.2, span: [8.0, 12.0], member: 0.45 },
};
const CONSTRUCTION_STAGES = {
  excavation: { label: '터파기·흙막이', order: 0 },
  foundation: { label: '기초',          order: 1 },
  frame:      { label: '골조 공사',     order: 2 },
  finish:     { label: '외장·마감',     order: 3 },
  done:       { label: '준공',          order: 4 },
};
const BASEMENT_H = 3.5;   // 지하층 층고(설계값) — 터파기 깊이 추정용

// ── 기본 기하 ──
const stPts = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const p = { x: +flat[i], y: +flat[i + 1] }, q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
  return out;
};
const stFlat = (pts) => pts.flatMap(p => [+p.x.toFixed(3), +p.y.toFixed(3)]);
function signedArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y; return a / 2; }
function footprintArea(flat) { return Math.abs(signedArea(stPts(flat))); }

/** 닫힌 다각형 Douglas–Peucker: 가장 먼 두 꼭짓점을 기준으로 두 사슬로 나눠 단순화 */
function simplifyClosed(pts, tol) {
  const n = pts.length;
  if (n <= 4) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y); if (d > fd) { fd = d; far = i; } }
  const chain = (c) => {
    const keep = new Uint8Array(c.length); keep[0] = keep[c.length - 1] = 1;
    const stack = [[0, c.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let idx = -1, md = tol;
      for (let i = s + 1; i < e; i++) { const d = pointToSegmentDistance(c[i].x, c[i].y, c[s].x, c[s].y, c[e].x, c[e].y); if (d > md) { md = d; idx = i; } }
      if (idx >= 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return c.filter((_, i) => keep[i]);
  };
  const a = chain(pts.slice(0, far + 1)), b = chain([...pts.slice(far), pts[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** 건물 주축 방향(라디안, 0~π/2): 변 길이 가중 4배각 원형 평균 — 직각인 변들은 같은 축으로 모인다 */
function dominantAxis(pts) { return axisStats(pts).theta; }
/** 주축 방향과 직각성 R(0~1): 모든 변이 주축·직각 방향이면 1, 방향이 흩어져 있으면(삼각형·원) 0 에 가깝다 */
function axisStats(pts) {
  let sx = 0, sy = 0, sl = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    sx += L * Math.cos(4 * ang); sy += L * Math.sin(4 * ang); sl += L;
  }
  let t = Math.atan2(sy, sx) / 4;
  if (t < 0) t += Math.PI / 2;
  return { theta: t, R: sl ? Math.hypot(sx, sy) / sl : 0 };
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}
const lineX = (l1, l2) => {   // 직선 (점 p, 방향 d) 두 개의 교점
  const den = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / den;
  return { x: l1.x + l1.dx * t, y: l1.y + l1.dy * t };
};
const parallel = (a, b) => Math.abs(a.dx * b.dy - a.dy * b.dx) < 0.087;   // 5° 이내

/**
 * AI 외곽선 정리: 단순화 → 주축에 가까운 변(±snapDeg)을 주축·직각 방향으로 맞춤 → 이웃 직선 교점으로 꼭짓점 재계산.
 * 직각 건물이 아니면(직각성 R < 0.45: 삼각형·원형 등) 방향은 그대로 두고 단순화·모서리 잡음 정리만 한다.
 * 면적이 15% 넘게 바뀌거나 꼬이면 단순화 결과만 돌려준다 (건물 모양을 망치지 않음).
 * @returns {number[]} 평탄화 다각형 (m)
 */
function regularizeFootprint(flat, { tol = 0.5, snapDeg = 15, minEdge = 0.8 } = {}) {
  const pts = stPts(flat);
  if (pts.length < 3) return flat.slice();
  const area0 = Math.abs(signedArea(pts));
  if (area0 < 1) return flat.slice();
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  tol = Math.max(0.1, Math.min(tol, size * 0.06));
  const simple = simplifyClosed(pts, tol);
  if (simple.length < 3) return flat.slice();
  const { theta, R } = axisStats(simple), orth = R >= 0.45, snap = snapDeg * Math.PI / 180, Q = Math.PI / 2;

  // 변마다 직선 (중점 + 방향). 주축 근처면 방향을 맞춘다.
  // 짧은 변일수록 끝점 잡음 때문에 각도가 크게 흔들리므로 허용 각도를 atan(2·tol / 길이)만큼(최대 15°) 넓힌다
  let lines = simple.map((a, i) => {
    const b = simple[(i + 1) % simple.length], len = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const k = Math.round((ang - theta) / Q), diff = ang - theta - k * Q;
    const snapped = orth && Math.abs(diff) <= snap + Math.min(snap, Math.atan(2 * tol / Math.max(len, 1e-6)));
    const dir = snapped ? theta + k * Q : ang;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dx: Math.cos(dir), dy: Math.sin(dir), len, end: b, snapped };
  });

  // 연속한 평행 직선: 거의 겹치면 합치고, 직각으로 맞춘 두 변이 떨어져 있으면 직각 연결 변(단차)을 넣는다
  const mergeOrStep = () => {
    for (let i = 0; i < lines.length && lines.length > 3; i++) {
      const a = lines[i], j = (i + 1) % lines.length, b = lines[j];
      // 방향을 맞추지 않은 짧은 두 변은 끝점 잡음만큼(최대 20°) 꺾여 있어도 한 직선으로 본다
      const dot = a.dx * b.dx + a.dy * b.dy, loose = !a.snapped && !b.snapped && dot > 0;
      const lim = loose ? Math.max(0.087, Math.sin(Math.min(0.35, Math.atan(3 * tol / Math.max(1e-6, Math.min(a.len, b.len)))))) : 0.087;
      if (Math.abs(a.dx * b.dy - a.dy * b.dx) >= lim) continue;
      const nx = -a.dy, ny = a.dx, off = (b.x - a.x) * nx + (b.y - a.y) * ny;
      if (Math.abs(off) < tol * 1.5 || !(a.snapped && b.snapped)) {
        const w = a.len + b.len, sb = dot >= 0 ? 1 : -1;
        let dx = a.dx, dy = a.dy;
        if (!a.snapped && !b.snapped) { dx = a.dx * a.len + sb * b.dx * b.len; dy = a.dy * a.len + sb * b.dy * b.len; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; }
        else if (b.snapped && !a.snapped) { dx = b.dx * sb; dy = b.dy * sb; }
        const m = { x: (a.x * a.len + b.x * b.len) / w, y: (a.y * a.len + b.y * b.len) / w, dx, dy, len: w, end: b.end, snapped: a.snapped || b.snapped };
        lines.splice(i, 1, m); lines.splice(j > i ? j : 0, 1);
      } else {
        const v = a.end, s = Math.sign(off);
        lines.splice(i + 1, 0, { x: v.x, y: v.y, dx: nx * s, dy: ny * s, len: Math.abs(off), end: v, snapped: a.snapped });
      }
      return true;
    }
    return false;
  };
  for (let guard = 0; guard < 64 && mergeOrStep(); guard++) { /* 반복 */ }

  const vertices = () => lines.map((l, i) => lineX(lines[(i - 1 + lines.length) % lines.length], l) || { x: l.x, y: l.y });
  let out = vertices();
  // 너무 짧은 변 제거 (그 변을 만든 직선을 빼고 다시 교점 계산). 가장 짧은 것부터.
  // 직각으로 맞추지 못한 짧은 변(tol×4 미만)은 모서리 잡음(지그재그·모따기)으로 보고 함께 지운다
  const chamfer = Math.max(minEdge, tol * 4);
  for (let guard = 0; guard < 48 && lines.length > 3; guard++) {
    let k = -1, kl = Infinity;
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length], len = Math.hypot(b.x - a.x, b.y - a.y);
      if ((len < minEdge || (!lines[i].snapped && len < chamfer)) && len < kl) { k = i; kl = len; }
    }
    if (k < 0) break;
    lines.splice(k, 1);
    for (let g2 = 0; g2 < 8 && mergeOrStep(); g2++) { /* 반복 */ }
    out = vertices();
  }
  const area1 = Math.abs(signedArea(out));
  if (out.length < 3 || selfIntersects(out) || area1 / area0 < 0.85 || area1 / area0 > 1.18) return stFlat(simple);
  return stFlat(out);
}

/** 외곽을 바깥으로 d(m) 넓힌 다각형 (꼭짓점은 교점, 뾰족하면 d·3 으로 제한) */
function offsetPolygon(flat, d) {
  const pts = stPts(flat);
  if (pts.length < 3) return flat.slice();
  const sgn = signedArea(pts) > 0 ? 1 : -1;   // 화면 좌표(y=남)에서 양수 = 시계 방향
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
    const nx = dy * sgn, ny = -dx * sgn;   // 바깥쪽 법선
    return { x: a.x + nx * d, y: a.y + ny * d, dx, dy };
  });
  return stFlat(lines.map((l, i) => {
    const p = lineX(lines[(i - 1 + lines.length) % lines.length], l), v = pts[i];
    if (!p || Math.hypot(p.x - v.x, p.y - v.y) > Math.abs(d) * 3) return { x: l.x, y: l.y };
    return p;
  }));
}

/** 다각형을 θ 방향 국소 좌표(u = 주축, v = 직각)로. 긴 변이 u 가 되도록 필요하면 90° 돌린다 */
function localFrameOf(pts, theta, longU = true) {
  const make = (t) => {
    const c = Math.cos(t), s = Math.sin(t);
    const L = pts.map(p => ({ u: p.x * c + p.y * s, v: -p.x * s + p.y * c }));
    return {
      L, theta: t, toW: (u, v) => ({ x: u * c - v * s, y: u * s + v * c }),
      umin: Math.min(...L.map(p => p.u)), umax: Math.max(...L.map(p => p.u)), vmin: Math.min(...L.map(p => p.v)), vmax: Math.max(...L.map(p => p.v)),
      flatL: L.flatMap(p => [p.u, p.v]),
    };
  };
  const F = make(theta);
  return longU && F.vmax - F.vmin > F.umax - F.umin + 1e-6 ? make(theta + Math.PI / 2) : F;
}
/** 국소 좌표 u = const 직선이 다각형 안에 있는 v 구간들 */
function clipAtU(L, u) {
  const vs = [];
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    if ((a.u <= u) !== (b.u <= u)) vs.push(a.v + (u - a.u) * (b.v - a.v) / (b.u - a.u));
  }
  vs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < vs.length; i += 2) out.push([vs[i], vs[i + 1]]);
  return out;
}

/** 외곽 형태로 구조 형식 추정 — 화면에 「추정」으로 표시하고 사용자가 바꿀 수 있다 */
function suggestStructure(flat) {
  const pts = stPts(flat);
  if (pts.length < 3) return { type: 'frame', reason: '' };
  const F = localFrameOf(pts, dominantAxis(pts));
  const a = F.umax - F.umin, b = F.vmax - F.vmin, depth = Math.min(a, b), length = Math.max(a, b), area = Math.abs(signedArea(pts));
  if (area >= 2500 && depth >= 30) return { type: 'steel', reason: `바닥 ${Math.round(area)}㎡ · 깊이 ${depth.toFixed(0)} m 대형 평면` };
  if (depth <= 16 && length >= depth * 1.8) return { type: 'wall', reason: `깊이 ${depth.toFixed(1)} m 판상형 — 공동주택 벽식으로 추정` };
  return { type: 'frame', reason: `${length.toFixed(0)} × ${depth.toFixed(0)} m 평면 — 기둥·보 골조로 추정` };
}

/**
 * 구조 형식별 부재 배치 (3D 표현용 추정). 주축 방향 격자를 경간 범위 안에서 고르게 나눈다.
 * @returns {{angle, nU, nV, spanU, spanV, columns:{x,y}[], beams:number[][], walls:number[][], core:number[], area}}
 *   beams·walls: [x1, y1, x2, y2] (m)
 */
function structuralLayout(flat, typeKey) {
  const T = STRUCTURE_TYPES[typeKey] || STRUCTURE_TYPES.frame;
  const pts = stPts(flat);
  const empty = { angle: 0, nU: 0, nV: 0, spanU: 0, spanV: 0, columns: [], beams: [], walls: [], core: [], area: 0 };
  if (pts.length < 3) return empty;
  const F = localFrameOf(pts, dominantAxis(pts));
  const inset = T.member / 2 + 0.1, target = (T.span[0] + T.span[1]) / 2;
  const grid = (a, b) => {
    const len = Math.max(0.1, b - a - 2 * inset), n = Math.max(1, Math.round(len / target)), st = len / n;
    return { n, st, at: Array.from({ length: n + 1 }, (_, i) => a + inset + i * st) };
  };
  const gu = grid(F.umin, F.umax), gv = grid(F.vmin, F.vmax);
  const inside = (u, v) => isPointInPolygon(u, v, F.flatL);
  const cols = new Map(), columns = [], beams = [], walls = [];
  if (typeKey !== 'wall') {
    gu.at.forEach((u, i) => gv.at.forEach((v, j) => { if (inside(u, v)) { cols.set(`${i},${j}`, { u, v }); columns.push(F.toW(u, v)); } }));
    const seg = (p, q) => { const a = F.toW(p.u, p.v), b = F.toW(q.u, q.v); beams.push([a.x, a.y, b.x, b.y]); };
    for (let i = 0; i <= gu.n; i++) for (let j = 0; j <= gv.n; j++) {
      const c = cols.get(`${i},${j}`); if (!c) continue;
      const r = cols.get(`${i + 1},${j}`), d = cols.get(`${i},${j + 1}`);
      if (r && inside((c.u + r.u) / 2, c.v)) seg(c, r);
      if (d && inside(c.u, (c.v + d.v) / 2)) seg(c, d);
    }
  } else {
    // 벽식: 주축 방향으로 경간마다 세대 경계벽(직각 방향) — 외벽은 3D 에서 외곽을 따라 따로 그린다
    for (let i = 1; i < gu.n; i++) for (const [v0, v1] of clipAtU(F.L, gu.at[i])) {
      if (v1 - v0 < 1) continue;
      const a = F.toW(gu.at[i], v0 + 0.1), b = F.toW(gu.at[i], v1 - 0.1); walls.push([a.x, a.y, b.x, b.y]);
    }
  }
  // 코어(계단·승강기): 무게중심에서 가장 가까운, 네 모서리가 모두 안쪽인 칸
  const th = F.theta, c = polygonCentroid(stFlat(pts)), cu = c.x * Math.cos(th) + c.y * Math.sin(th), cv = -c.x * Math.sin(th) + c.y * Math.cos(th);
  let core = [], best = Infinity;
  const cw = Math.min(gu.st, 7), ch = Math.min(gv.st, 7);
  for (let i = 0; i < gu.n; i++) for (let j = 0; j < gv.n; j++) {
    const u0 = gu.at[i] + (gu.st - cw) / 2, v0 = gv.at[j] + (gv.st - ch) / 2, u1 = u0 + cw, v1 = v0 + ch;
    if (![[u0, v0], [u1, v0], [u1, v1], [u0, v1]].every(([u, v]) => inside(u, v))) continue;
    const d = Math.hypot((u0 + u1) / 2 - cu, (v0 + v1) / 2 - cv);
    if (d < best) { best = d; core = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].flatMap(([u, v]) => { const w = F.toW(u, v); return [w.x, w.y]; }); }
  }
  return { angle: th, nU: gu.n, nV: gv.n, spanU: gu.st, spanV: gv.st, columns, beams, walls, core, area: Math.abs(signedArea(pts)) };
}

/** 주축과 직각 방향으로 spacing 간격의 선분들 (터파기 버팀보) */
function crossBraces(flat, spacing = 5) {
  const pts = stPts(flat);
  if (pts.length < 3) return [];
  const F = localFrameOf(pts, dominantAxis(pts));
  // 짧은 변 방향으로 걸치도록: 주축 길이가 더 길면 u 를 따라 배치
  const alongU = F.umax - F.umin >= F.vmax - F.vmin;
  const L = alongU ? F.L : F.L.map(p => ({ u: p.v, v: p.u }));
  const lo = alongU ? F.umin : F.vmin, hi = alongU ? F.umax : F.vmax, out = [];
  for (let u = lo + spacing / 2; u < hi; u += spacing) for (const [v0, v1] of clipAtU(L, u)) {
    const a = alongU ? F.toW(u, v0) : F.toW(v0, u), b = alongU ? F.toW(u, v1) : F.toW(v1, u);
    out.push([a.x, a.y, b.x, b.y]);
  }
  return out;
}

// ═══════════════════════════════════════════════
//  태양 위치 · 그림자로 높이 추정
// ═══════════════════════════════════════════════

/**
 * 태양 고도·방위 (천문력 저정밀 식, 오차 약 0.5° 이내 — 현장 그림자 검토에 충분)
 * @returns {{elevation: number, azimuth: number}} 도. 방위는 북 = 0°, 시계 방향
 */
function sunPosition(date, lat, lon) {
  const R = Math.PI / 180;
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;   // J2000.0 이후 일수
  const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * R, eps = (23.439 - 0.0000004 * n) * R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)), dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * R - ra, phi = lat * R;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { elevation: el / R, azimuth: ((az / R) % 360 + 360) % 360 };
}

/** 그림자 길이(m)와 태양 고도(°) → 높이(m). 고도 5° 미만은 오차가 커서 계산하지 않는다 */
function heightFromShadow(lengthM, elevationDeg) {
  if (!(lengthM > 0) || !(elevationDeg >= 5)) return null;
  return lengthM * Math.tan(elevationDeg * Math.PI / 180);
}

/** 현장 좌표 벡터(dx 동, dy 남)의 방위(북 = 0°) */
function bearingOf(dx, dy) { return ((Math.atan2(dx, -dy) * 180 / Math.PI) % 360 + 360) % 360; }
/** 측정한 그림자 방향과 태양 반대 방향의 차이(°) — 크면 점을 잘못 찍었거나 도면 방향(정합)이 틀린 것 */
function shadowDirectionError(dx, dy, sunAzimuth) {
  const d = Math.abs(bearingOf(dx, dy) - (sunAzimuth + 180) % 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** JPEG EXIF 촬영 시각 (DateTimeOriginal, 없으면 DateTime). 시간대 정보가 없으면 이 기기 시간대로 해석 */
function readExifDate(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    for (let off = 2; off + 4 <= v.byteLength;) {
      const marker = v.getUint16(off), size = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return exifDate(v, off + 10);   // 'Exif'
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      off += 2 + size;
    }
  } catch (e) { /* 형식 오류 */ }
  return null;
}
function exifDate(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(t + o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const ifd = (o) => {
    const tags = {};
    for (let i = 0, n = u16(o); i < n; i++) {
      const e = o + 2 + i * 12, type = u16(e + 2), cnt = u32(e + 4);
      tags[u16(e)] = { cnt, at: cnt * (SIZE[type] || 1) > 4 ? u32(e + 8) : e + 8 };
    }
    return tags;
  };
  const ifd0 = ifd(u32(4));
  let dt = null, tz = null;
  if (ifd0[0x8769]) {
    const ex = ifd(u32(ifd0[0x8769].at));
    if (ex[0x9003]) dt = str(ex[0x9003].at, ex[0x9003].cnt);
    if (ex[0x9011]) tz = str(ex[0x9011].at, ex[0x9011].cnt);
  }
  if (!dt && ifd0[0x0132]) dt = str(ifd0[0x0132].at, ifd0[0x0132].cnt);
  const m = dt && dt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  if (tz && /^[+-]\d{2}:\d{2}$/.test(tz)) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
