/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 위험도 가중 A* 경로 탐색 (단위 m)
 *
 *  - 그리드 모드 : 보행 가능 구역(올가미)이 있거나 도로가 없을 때. 건물·울타리는 래스터화하여 통과 불가.
 *  - 도로 모드   : 올가미 없이 도로(자유 곡선)만 그렸을 때. 도로 그래프 위에서만 이동.
 *
 *  간선 비용 = 거리 × (1 + w × R)   (R: 0~100)  →  w=0 이면 최단 거리, w=1 이면 R=100 구간이 101배 비용.
 *  v11 대비: 이진 힙 + 타입 배열(수십~수백 배 빠름), 해상도 무관 비용, 경로 평활화, 최단 경로 비교 지표.
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

// ── 이진 최소 힙 (우선순위, 값) ──
class MinHeap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.v.length; }
  push(pri, val) {
    const p = this.p, v = this.v;
    let i = v.length; p.push(pri); v.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= pri) break;
      p[i] = p[parent]; v[i] = v[parent]; i = parent;
    }
    p[i] = pri; v[i] = val;
  }
  pop() {
    const p = this.p, v = this.v, top = v[0];
    const lp = p.pop(), lv = v.pop(), n = v.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        p[i] = p[c]; v[i] = v[c]; i = c;
      }
      p[i] = lp; v[i] = lv;
    }
    return top;
  }
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const det = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(det) < 1e-10) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / det;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / det;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/** 울타리 선분 목록 (bbox 포함) */
function fenceSegments(fences) {
  const segs = [];
  for (const f of fences || []) {
    const pts = f.points || f, half = (f.width || 0.4) / 2 + 0.3;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
      segs.push({ ax, ay, bx, by, half,
        minX: Math.min(ax, bx) - half, maxX: Math.max(ax, bx) + half,
        minY: Math.min(ay, by) - half, maxY: Math.max(ay, by) + half });
    }
  }
  return segs;
}

function crossesFence(x1, y1, x2, y2, segs) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  for (const s of segs) {
    if (maxX < s.minX || minX > s.maxX || maxY < s.minY || minY > s.maxY) continue;
    if (segmentsIntersect(x1, y1, x2, y2, s.ax, s.ay, s.bx, s.by)) return true;
    if (pointToSegmentDistance(x2, y2, s.ax, s.ay, s.bx, s.by) <= s.half) return true;
  }
  return false;
}

/** 경로 품질 지표 */
function measurePath(pts, field) {
  let length = 0, maxRisk = 0, exposure = 0;
  const bands = { high: 0, mid: 0, low: 0 };
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const seg = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(seg / 0.3));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, r = field.at(ax + (bx - ax) * t, ay + (by - ay) * t), ds = seg / n;
      if (r > maxRisk) maxRisk = r;
      exposure += r / 100 * ds;
      if (r >= 70) bands.high += ds; else if (r >= 30) bands.mid += ds; else if (r > 0) bands.low += ds;
    }
    length += seg;
  }
  return { length, maxRisk, exposure, avgRisk: length > 0 ? exposure / length * 100 : 0, bands };
}

// ═══════════════════════════════════════════════
//  그리드 모드
// ═══════════════════════════════════════════════

/** ext: 현장 범위(m). 셀 (c, r) 의 월드 좌표 = (ox + c·cs, oy + r·cs) */
function buildNavGrid({ ext, contourPolys, excluded, walkable, fences, field, maxCells = 180000 }) {
  const iw = ext.w, ih = ext.h, ox = ext.minX, oy = ext.minY;
  const cs = Math.max(0.25, +Math.sqrt(iw * ih / maxCells).toFixed(2));
  const cols = Math.floor(iw / cs) + 1, rows = Math.floor(ih / cs) + 1;

  // 장애물을 저해상도 캔버스에 그려 래스터화 (다각형 판정을 셀마다 반복하지 않기 위해)
  const cv = document.createElement('canvas');
  cv.width = cols; cv.height = rows;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.setTransform(1 / cs, 0, 0, 1 / cs, 0.5 - ox / cs, 0.5 - oy / cs);
  const poly = (p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); };

  if (walkable && walkable.length >= 6) {
    g.fillStyle = '#000'; g.fillRect(ox - cs, oy - cs, iw + 2 * cs, ih + 2 * cs);
    g.fillStyle = '#fff'; poly(walkable); g.fill();
  } else {
    g.fillStyle = '#fff'; g.fillRect(ox - cs, oy - cs, iw + 2 * cs, ih + 2 * cs);
  }
  g.fillStyle = '#000';
  contourPolys.forEach((p, i) => { if (!excluded.has(i) && p.length >= 6) { poly(p); g.fill(); } });
  g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const f of fences || []) {
    const pts = f.points || f;
    if (pts.length < 4) continue;
    g.lineWidth = Math.max((f.width || 0.4) + 0.6, cs * 2.2); // 최소 2셀 두께 → 대각선 틈새 방지
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  }

  const data = g.getImageData(0, 0, cols, rows).data;
  const N = cols * rows, blocked = new Uint8Array(N), risk = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (data[i * 4] < 128) { blocked[i] = 1; continue; }
    risk[i] = field.at(ox + (i % cols) * cs, oy + Math.floor(i / cols) * cs);
  }
  // 위험 영역을 1셀 팽창: 셀 중심 샘플링 오차 때문에 지름길이 위험 구역 가장자리를 스치는 것을 방지
  const dilated = new Float32Array(N);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (blocked[i]) continue;
      let m = risk[i];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && risk[rr * cols + cc] > m) m = risk[rr * cols + cc];
      }
      dilated[i] = m;
    }
  }
  return { cs, cols, rows, ox, oy, blocked, risk: dilated };
}

function nearestFreeCell(grid, x, y, maxR = 40) {
  const { cs, cols, rows, blocked, ox, oy } = grid;
  const c0 = Math.round((x - ox) / cs), r0 = Math.round((y - oy) / cs);
  for (let rad = 0; rad <= maxR; rad++) {
    let best = -1, bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c;
        if (blocked[i]) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

function astarGrid(grid, s, e, w) {
  const { cs, cols, rows, blocked, risk } = grid;
  const N = cols * rows;
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const ec = e % cols, er = (e / cols) | 0;
  const h = (i) => {
    const dx = Math.abs(i % cols - ec), dy = Math.abs(((i / cols) | 0) - er);
    return cs * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
  };
  const heap = new MinHeap();
  gScore[s] = 0; heap.push(h(s), s);
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === e) break;
    closed[cur] = 1;
    const cc = cur % cols, cr = (cur / cols) | 0;
    for (const [dc, dr, dist] of NB) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (blocked[ni] || closed[ni]) continue;
      if (dc && dr && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) continue; // 모서리 끼어들기 금지
      const tg = gScore[cur] + dist * cs * (1 + w * (risk[cur] + risk[ni]) / 2);
      if (tg < gScore[ni]) { gScore[ni] = tg; came[ni] = cur; heap.push(tg + h(ni), ni); }
    }
  }
  if (s !== e && came[e] === -1) return null;
  const cells = [];
  for (let c = e; c !== -1; c = came[c]) cells.push(c);
  return cells.reverse();
}

/** 시선(line-of-sight) 기반 평활화: 비용이 원래 경로보다 커지지 않을 때만 지름길을 택한다 */
function smoothGridPath(grid, pts, w) {
  const { cs, cols, rows, blocked, risk, ox, oy } = grid;
  const n = pts.length / 2;
  if (n < 3) return pts;
  const cellAt = (x, y) => {
    const c = Math.round((x - ox) / cs), r = Math.round((y - oy) / cs);
    return (c < 0 || r < 0 || c >= cols || r >= rows) ? -1 : r * cols + c;
  };
  const cum = new Float64Array(n);
  const segCost = (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(len / (cs * 0.5)));
    let cost = 0;
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k, i = cellAt(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (i < 0 || blocked[i]) return Infinity;
      cost += len / k * (1 + w * risk[i]);
    }
    return cost;
  };
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + segCost(pts[2 * i - 2], pts[2 * i - 1], pts[2 * i], pts[2 * i + 1]);

  const out = [pts[0], pts[1]];
  let a = 0;
  while (a < n - 1) {
    let best = a + 1;
    for (let b = a + 2; b < n; b++) {
      const c = segCost(pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1]);
      if (c <= (cum[b] - cum[a]) * 1.001 + 1e-6) best = b;
      else if (c === Infinity) break;
    }
    out.push(pts[2 * best], pts[2 * best + 1]);
    a = best;
  }
  return out;
}

function gridRoute(grid, start, end, w) {
  const s = nearestFreeCell(grid, start.x, start.y), e = nearestFreeCell(grid, end.x, end.y);
  if (s < 0 || e < 0) return null;
  const cells = astarGrid(grid, s, e, w);
  if (!cells) return null;
  const pts = [start.x, start.y];
  for (const c of cells) pts.push(grid.ox + (c % grid.cols) * grid.cs, grid.oy + ((c / grid.cols) | 0) * grid.cs);
  pts.push(end.x, end.y);
  return smoothGridPath(grid, pts, w);
}

// ═══════════════════════════════════════════════
//  도로(그래프) 모드
// ═══════════════════════════════════════════════

function buildRoadGraph({ polylines, contourPolys, excluded, fences, field, link = 3 }) {
  const nodes = [];
  const segs = fenceSegments(fences);
  const insideBuilding = (x, y) => contourPolys.some((p, i) => !excluded.has(i) && isPointInPolygon(x, y, p));
  const addEdge = (a, b) => {
    if (a.edges.includes(b.id)) return;
    if (crossesFence(a.x, a.y, b.x, b.y, segs)) return;
    a.edges.push(b.id); b.edges.push(a.id);
  };

  polylines.forEach((line, li) => {
    const pts = line.points || line;
    let prev = null;
    for (let i = 0; i < pts.length; i += 2) {
      const x = +pts[i], y = +pts[i + 1];
      if (prev && Math.hypot(x - prev.x, y - prev.y) < 0.6 && i < pts.length - 2) continue;
      const node = { id: nodes.length, x, y, line: li, edges: [], blocked: insideBuilding(x, y), risk: field.at(x, y) };
      nodes.push(node);
      if (prev) addEdge(prev, node);
      prev = node;
    }
  });

  // 가까운 점끼리 연결 (공간 해시로 O(n))
  const hash = new Map(), key = (cx, cy) => cx + ',' + cy;
  for (const n of nodes) {
    const k = key(Math.floor(n.x / link), Math.floor(n.y / link));
    (hash.get(k) || hash.set(k, []).get(k)).push(n);
  }
  for (const n of nodes) {
    const cx = Math.floor(n.x / link), cy = Math.floor(n.y / link);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const m of hash.get(key(cx + dx, cy + dy)) || []) {
        if (m.id <= n.id) continue;
        if (Math.hypot(n.x - m.x, n.y - m.y) < link) addEdge(n, m);
      }
    }
  }
  return nodes;
}

function roadRoute(nodes, start, end, w) {
  const free = nodes.filter(n => !n.blocked);
  if (!free.length) return null;
  const nearest = (p) => free.reduce((b, n) => (Math.hypot(n.x - p.x, n.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? n : b));
  const s = nearest(start), e = nearest(end);
  const g = new Float64Array(nodes.length).fill(Infinity), came = new Int32Array(nodes.length).fill(-1);
  const heap = new MinHeap();
  const h = (n) => Math.hypot(n.x - e.x, n.y - e.y);
  g[s.id] = 0; heap.push(h(s), s.id);
  while (heap.size) {
    const id = heap.pop(), cur = nodes[id];
    if (id === e.id) break;
    for (const nid of cur.edges) {
      const nb = nodes[nid];
      if (nb.blocked) continue;
      const tg = g[id] + Math.hypot(nb.x - cur.x, nb.y - cur.y) * (1 + w * (cur.risk + nb.risk) / 2);
      if (tg < g[nid]) { g[nid] = tg; came[nid] = id; heap.push(tg + h(nb), nid); }
    }
  }
  if (s.id !== e.id && came[e.id] === -1) return null;
  const ids = [];
  for (let c = e.id; c !== -1; c = came[c]) ids.push(c);
  ids.reverse();
  const pts = [start.x, start.y];
  for (const id of ids) pts.push(nodes[id].x, nodes[id].y);
  pts.push(end.x, end.y);
  return { pts, snapDist: Math.max(Math.hypot(s.x - start.x, s.y - start.y), Math.hypot(e.x - end.x, e.y - end.y)) };
}

// ═══════════════════════════════════════════════
//  통합 진입점
// ═══════════════════════════════════════════════

/**
 * @returns {{ path, shortest, metrics, shortestMetrics, method, cellSize, ms, snapDist } | null}
 */
function planRoute({ ext, contours, walkable, polylines, fences, field, start, end, weight }) {
  const t0 = performance.now();
  const contourPolys = (contours || []).map(flattenContour);
  // 출발/도착 지점이 건물 안이면 그 건물은 장애물에서 제외 (건물에서 나가고 들어가는 경로 허용)
  const excluded = new Set();
  contourPolys.forEach((p, i) => {
    if (isPointInPolygon(start.x, start.y, p) || isPointInPolygon(end.x, end.y, p)) excluded.add(i);
  });

  const useRoads = !(walkable && walkable.length >= 6) && polylines.some(l => (l.points || l).length >= 4);
  let path, shortest, cellSize = null, snapDist = 0;

  if (useRoads) {
    const nodes = buildRoadGraph({ polylines, contourPolys, excluded, fences, field });
    const r = roadRoute(nodes, start, end, weight);
    if (!r) return null;
    path = r.pts; snapDist = r.snapDist;
    const s = roadRoute(nodes, start, end, 0);
    shortest = s ? s.pts : null;
  } else {
    const grid = buildNavGrid({ ext, contourPolys, excluded, walkable, fences, field });
    cellSize = grid.cs;
    path = gridRoute(grid, start, end, weight);
    if (!path) return null;
    shortest = gridRoute(grid, start, end, 0);
  }

  return {
    path, shortest,
    metrics: measurePath(path, field),
    shortestMetrics: shortest ? measurePath(shortest, field) : null,
    method: useRoads ? 'road' : (walkable && walkable.length >= 6 ? 'grid-walkable' : 'grid-open'),
    cellSize, snapDist,
    ms: performance.now() - t0,
  };
}
