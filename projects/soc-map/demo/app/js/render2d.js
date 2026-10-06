/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 2D 캔버스 렌더링 · 뷰 변환(확대/이동) · 히트 테스트
 *  월드 좌표 = 현장 좌표(m).  화면 = 월드 × s + (ox, oy)
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
let DPR = 1, CW = 800, CH = 600, _laidOut = false;
const LABEL_FONT = '"Pretendard","Segoe UI","Malgun Gothic",sans-serif';

function resizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  DPR = window.devicePixelRatio || 1;
  const nw = Math.max(1, r.width), nh = Math.max(1, r.height);
  const wasHidden = CW < 20 || CH < 20 || !_laidOut;
  if (S.view.s && !wasHidden) { S.view.ox += (nw - CW) / 2; S.view.oy += (nh - CH) / 2; }   // 화면 중심 유지
  CW = nw; CH = nh;
  canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
  if (nw >= 20 && nh >= 20 && wasHidden) { _laidOut = true; fitView(true); }   // 처음 크기가 정해질 때 화면 맞춤
  requestRender();
}

function fitScale() { const e = docExtent(); return Math.min(CW / e.w, CH / e.h) * 0.96; }

// ── 뷰 변환 (화면 px / m) ──
function getT() {
  if (!S.view.s) fitView(true);
  return { s: S.view.s, ox: S.view.ox, oy: S.view.oy };
}
function screenToImg(x, y) { const t = getT(); return { x: (x - t.ox) / t.s, y: (y - t.oy) / t.s }; }
function worldToScreen(x, y) { const t = getT(); return { x: x * t.s + t.ox, y: y * t.s + t.oy }; }
function zoomAt(mx, my, factor) {
  const t = getT(), p = screenToImg(mx, my);
  const s = Math.max(0.02, Math.min(400, t.s * factor));   // 50m/px ~ 2.5mm/px
  S.view.s = s; S.view.ox = mx - p.x * s; S.view.oy = my - p.y * s;
  requestRender(); onViewChange();
}
function fitView(silent) {
  const e = docExtent(), s = fitScale();
  S.view.s = s; S.view.ox = (CW - e.w * s) / 2 - e.minX * s; S.view.oy = (CH - e.h * s) / 2 - e.minY * s;
  if (!silent) { requestRender(); onViewChange(); }
}
function centerOn(x, y, minScale) {
  const t = getT(), s = Math.max(t.s, minScale || 0);
  S.view.s = s; S.view.ox = CW / 2 - x * s; S.view.oy = CH / 2 - y * s;
  requestRender(); onViewChange();
}
/** 화면에 보이는 월드 범위 */
function visibleWorld() {
  const a = screenToImg(0, 0), b = screenToImg(CW, CH);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}
let onViewChange = () => {};

let _renderQueued = false;
function requestRender() {
  if (_renderQueued) return;
  _renderQueued = true;
  requestAnimationFrame(() => { _renderQueued = false; render(); });
}

// ── 캐시 ──
const _contourPolyCache = new WeakMap();
function getContourPolys() {
  let p = _contourPolyCache.get(S.contours);
  if (!p) { p = S.contours.map(flattenContour); _contourPolyCache.set(S.contours, p); }
  return p;
}

let _heat = { key: '', canvas: null, ext: null };
function getHeatCanvas() {
  const e = docExtent();
  const key = riskVersion() + ':' + [e.minX, e.minY, e.w, e.h].map(v => v.toFixed(1)).join(',');
  if (_heat.key === key) return _heat;
  const cols = Math.min(400, Math.max(20, Math.ceil(e.w / 0.4))), rows = Math.max(1, Math.round(cols * e.h / e.w));
  const c = _heat.canvas || document.createElement('canvas');
  c.width = cols; c.height = rows;
  const g = c.getContext('2d'), img = g.createImageData(cols, rows), field = getRiskField();
  for (let r = 0; r < rows; r++) {
    const y = e.minY + (r + 0.5) * e.h / rows;
    for (let col = 0; col < cols; col++) {
      const [R, G, B, A] = riskColor(field.at(e.minX + (col + 0.5) * e.w / cols, y)), o = (r * cols + col) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = A;
    }
  }
  g.putImageData(img, 0, 0);
  _heat = { key, canvas: c, ext: e };
  return _heat;
}

let _hatch = null;
function hatchPattern(scale) {
  if (!_hatch) {
    const c = document.createElement('canvas'); c.width = c.height = 14;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(239,68,68,0.28)'; g.fillRect(0, 0, 14, 14);
    g.strokeStyle = 'rgba(239,68,68,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-2, 16); g.lineTo(16, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(12, 16); g.lineTo(16, 12); g.stroke();
    _hatch = ctx.createPattern(c, 'repeat');
  }
  if (_hatch.setTransform) _hatch.setTransform(new DOMMatrix().scale(1 / scale));
  return _hatch;
}

// ═══════════════════════════════════════════════
//  렌더
// ═══════════════════════════════════════════════

function render() {
  const T = getT(), s = T.s, px = (n) => n / s;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, CW, CH);
  ctx.setTransform(DPR * s, 0, 0, DPR * s, DPR * T.ox, DPR * T.oy);

  // 바탕: 실제 지도 타일 → 배치도(정합 변환) → 1m/10m 격자
  const vis = visibleWorld();
  if (S.project.origin && S.layers.basemap !== 'none') Basemap.draw(ctx, s, vis);
  else {
    ctx.fillStyle = '#0d1524'; ctx.fillRect(vis.minX, vis.minY, vis.maxX - vis.minX, vis.maxY - vis.minY);
  }
  const PT = planTransform();
  if (S.bgImage && S.layers.bg && PT) {
    const [a, b, c, d, e, f] = PT.matrix;
    ctx.save();
    ctx.transform(a, d, b, e, c, f);
    ctx.globalAlpha = S.plan.opacity ?? 0.85;
    ctx.imageSmoothingEnabled = s * PT.scale < 2;
    ctx.drawImage(S.bgImage, 0, 0);
    ctx.restore();
  }
  drawGrid(vis, s);

  if (S.layers.heat) {
    const h = getHeatCanvas();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(h.canvas, h.ext.minX, h.ext.minY, h.ext.w, h.ext.h);
  }

  const polys = getContourPolys();
  const tracePoly = (p) => { ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); };

  // 보행 가능 구역 (건물은 구멍으로)
  const wap = S.walkableAreaPolygon;
  if (wap.length >= 6) {
    ctx.beginPath(); tracePoly(wap); polys.forEach(p => p.length >= 6 && tracePoly(p));
    ctx.fillStyle = 'rgba(16,185,129,0.13)'; ctx.fill('evenodd');
    ctx.beginPath(); tracePoly(wap);
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = px(2.5); ctx.setLineDash([px(10), px(6)]); ctx.stroke(); ctx.setLineDash([]);
  }

  // 환경 구역
  for (const z of S.siteEnvironment.envZones) {
    if (z.polygon.length < 6) continue;
    const info = ENV_ZONE_TYPES[z.type] || { color: '#fff' };
    if (z.type === 'powerLine') {   // 제322조 이격거리 띠 (장비 본체·붐이 들어가면 안 되는 범위)
      ctx.beginPath(); tracePoly(z.polygon);
      ctx.strokeStyle = info.color + '30'; ctx.lineWidth = 2 * powerLineClearance(z.kV); ctx.lineJoin = 'round'; ctx.stroke();
    }
    ctx.beginPath(); tracePoly(z.polygon);
    ctx.fillStyle = info.color + '2a'; ctx.fill();
    ctx.strokeStyle = info.color; ctx.lineWidth = px(2.5); ctx.stroke();
  }

  // 장비 위험 구역
  const field = getRiskField();
  if (S.layers.zones) {
    for (const eq of field.equipments) {
      if (eq.isFullControl()) {
        ctx.beginPath(); ctx.arc(eq.xc, eq.yc, eq.getMaxRadius(), 0, Math.PI * 2);
        ctx.fillStyle = hatchPattern(s); ctx.fill();
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = px(3); ctx.stroke();
      } else {
        eq.getZoneShapes().forEach(sh => drawZoneShape(sh, s));
      }
    }
  }

  // 도로
  for (const line of S.polylines) strokePolyline(line.points, '#10b981', Math.max(px(2), line.width || 3), null, 0.55);
  // 울타리
  for (const f of S.fences) {
    strokePolyline(f.points, '#f97316', Math.max(px(6), (f.width || 0.4) + px(2)), null, 0.35);
    strokePolyline(f.points, '#f97316', Math.max(px(3), f.width || 0.4), [px(12), px(7)], 1);
  }

  // 건물 (AI 외곽선)
  const sel = S.selection;
  polys.forEach((p, i) => {
    if (p.length < 6) return;
    const bd = S.buildingData[i] || {};
    const isSel = sel && sel.kind === 'building' && sel.idx === i;
    ctx.beginPath(); tracePoly(p);
    ctx.fillStyle = bd.entranceBlocked ? 'rgba(239,68,68,0.55)' : 'rgba(239,68,68,0.38)';
    ctx.fill();
    ctx.strokeStyle = isSel ? '#60a5fa' : '#ef4444'; ctx.lineWidth = px(isSel ? 3.5 : 1.8); ctx.stroke();
  });

  // 경로
  const R = S.route;
  if (R && R.result) {
    if (S.layers.shortest && R.result.shortest) strokePolyline(R.result.shortest, 'rgba(203,213,225,0.75)', px(2.5), [px(6), px(6)], 1);
    strokePolyline(R.result.path, 'rgba(59,130,246,0.35)', px(14), null, 1);
    strokePolyline(R.result.path, '#3b82f6', px(5), null, 1);
    for (const pc of R.pieces || []) {
      ctx.beginPath(); ctx.moveTo(pc[0], pc[1]); ctx.lineTo(pc[2], pc[3]);
      ctx.strokeStyle = pc[4] >= 70 ? '#ef4444' : '#f59e0b'; ctx.lineWidth = px(5); ctx.lineCap = 'round'; ctx.stroke();
    }
    if (R.redirect && R.redirect.target) {
      const a = R.redirect.via, b = R.redirect.target;
      strokePolyline([a.x, a.y, b.x, b.y], '#22d3ee', px(4), [px(4), px(6)], 1);
      label('⬇ 지하 B1 경유', (a.x + b.x) / 2, (a.y + b.y) / 2 - px(10), px(12), '#67e8f9');
    }
  }

  // 텍스트·아이콘 레이어 (도형 위)
  polys.forEach((p, i) => {
    const bd = S.buildingData[i];
    if (!bd || (!bd.name && !bd.entranceBlocked && !bd.floors)) return;
    const c = polygonCentroid(p);
    const name = (bd.name || '') + (bd.floors ? ` (${bd.floors}F)` : '');
    if (name) label(name, c.x, c.y - (bd.entranceBlocked ? px(10) : 0), px(13), '#fff');
    if (bd.entranceBlocked) emoji('🚫', c.x, c.y + (name ? px(10) : 0), px(16));
  });
  for (const z of S.siteEnvironment.envZones) {
    if (z.polygon.length < 6) continue;
    const c = polygonCentroid(z.polygon);
    emoji((ENV_ZONE_TYPES[z.type] || {}).icon || '⚠️', c.x, c.y, px(24));
  }
  for (const n of S.nodes) {
    ctx.beginPath(); ctx.arc(n.cx, n.cy, px(3.5), 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = px(1.2); ctx.stroke();
  }

  const markersNow = liveMarkers();
  // 단순 위험물
  for (const m of markersNow) {
    if (m.isEquipment) continue;
    const isSel = sel && sel.kind === 'marker' && sel.id === m.id;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
    ctx.fillStyle = simpleMarkerColor(m); ctx.fill();
    ctx.strokeStyle = isSel ? '#fff' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = px(isSel ? 2.5 : 1); ctx.stroke();
    emoji(m.icon || '⚠️', m.x, m.y, px(20));
    label(m.label, m.x, m.y - m.radius - px(9), px(11.5), '#fff');
  }

  // 장비 (운전원 휴대폰과 연동된 장비는 실시간 위치)
  for (const m of markersNow) {
    if (!m.isEquipment) continue;
    const isSel = sel && sel.kind === 'marker' && sel.id === m.id;
    const h = m.heading || 0, al = px(isSel ? 46 : 30);
    drawArrow(m.x, m.y, m.x + al * Math.cos(h), m.y + al * Math.sin(h), px(9), isSel ? '#93c5fd' : 'rgba(255,255,255,0.85)', px(2.2));
    if (isSel) {
      ctx.beginPath(); ctx.arc(m.x + al * Math.cos(h), m.y + al * Math.sin(h), px(6.5), 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = px(2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(m.x, m.y, px(15), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11,17,32,0.92)'; ctx.fill();
    ctx.strokeStyle = isSel ? '#60a5fa' : 'rgba(255,255,255,0.55)'; ctx.lineWidth = px(isSel ? 3 : 1.8); ctx.stroke();
    emoji(m.icon || '⚙️', m.x, m.y, px(17));
    label(m.label, m.x, m.y - px(25), px(11.5), '#fff');
    if (isSel) label(`${Math.round(rad2deg(normalizeAngle(h)))}°`, m.x, m.y + px(27), px(11), '#93c5fd');
  }

  // 경로 핀
  if (R) R.points.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, px(9), 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#10b981' : '#ef4444'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = px(2.5); ctx.stroke();
    label(i === 0 ? '출발' : '도착', p.x, p.y + px(21), px(12), '#fff');
  });

  drawMeasure(s);

  // 현장 인원 위치 · 정합 기준점 (project.js)
  if (typeof drawMonitorLayer === 'function') drawMonitorLayer(ctx, s);

  // 그리는 중
  const d = S.draft;
  if (d && d.points.length >= 2) {
    const col = d.kind === 'road' ? '#10b981' : d.kind === 'fence' ? '#f97316' : d.kind === 'lasso' ? '#10b981' : (ENV_ZONE_TYPES[S.envZoneType] || {}).color;
    if (d.kind === 'road' || d.kind === 'fence') strokePolyline(d.points, col, Math.max(px(2), d.width), d.kind === 'fence' ? [px(12), px(7)] : null, 1);
    else {
      ctx.beginPath(); ctx.moveTo(d.points[0], d.points[1]);
      for (let i = 2; i < d.points.length; i += 2) ctx.lineTo(d.points[i], d.points[i + 1]);
      ctx.closePath(); ctx.fillStyle = col + '22'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = px(2.5); ctx.setLineDash([px(10), px(6)]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawScaleBar(s);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** 축척에 맞춰 1·5·10·50·100m 간격 격자 */
function drawGrid(vis, s) {
  const target = 70 / s;   // 약 70px 간격
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const step = steps.find(v => v >= target) || 1000;
  ctx.save();
  ctx.lineWidth = 1 / s;
  ctx.strokeStyle = S.bgImage || S.project.origin ? 'rgba(255,255,255,0.08)' : 'rgba(148,163,184,0.09)';
  ctx.beginPath();
  for (let x = Math.floor(vis.minX / step) * step; x <= vis.maxX; x += step) { ctx.moveTo(x, vis.minY); ctx.lineTo(x, vis.maxY); }
  for (let y = Math.floor(vis.minY / step) * step; y <= vis.maxY; y += step) { ctx.moveTo(vis.minX, y); ctx.lineTo(vis.maxX, y); }
  ctx.stroke();
  ctx.restore();
}

/** 축척 막대 (화면 우하단) */
function drawScaleBar(s) {
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const barM = steps.find(v => v * s >= 80) || 1000, barPx = barM * s, x0 = CW - barPx - 18, y0 = CH - 48;
  ctx.fillStyle = 'rgba(5,8,15,0.65)'; ctx.fillRect(x0 - 8, y0 - 16, barPx + 16, 26);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + 6); ctx.lineTo(x0 + barPx, y0 + 6); ctx.lineTo(x0 + barPx, y0); ctx.stroke();
  ctx.font = `700 11px ${LABEL_FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(barM >= 1000 ? `${barM / 1000} km` : `${barM} m`, x0 + barPx / 2, y0 - 1);
  ctx.restore();
}

/** 거리·면적 측정 */
function drawMeasure(s) {
  const M = S.measure;
  if (!M || M.points.length < 2) return;
  const pts = M.points.slice();
  if (M.hover && !M.closed) pts.push(M.hover.x, M.hover.y);
  const px = (n) => n / s;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (M.closed) { ctx.closePath(); ctx.fillStyle = 'rgba(34,211,238,0.15)'; ctx.fill(); }
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = px(2.5); ctx.setLineDash([px(8), px(4)]); ctx.stroke(); ctx.setLineDash([]);
  let acc = 0;
  for (let i = 0; i < pts.length; i += 2) {
    ctx.beginPath(); ctx.arc(pts[i], pts[i + 1], px(4), 0, Math.PI * 2); ctx.fillStyle = '#22d3ee'; ctx.fill();
    if (i >= 2) {
      const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]); acc += seg;
      label(fmtDist(acc), pts[i], pts[i + 1] - px(12), px(11.5), '#a5f3fc');
    }
  }
  ctx.restore();
}
function fmtDist(m) { return m >= 1000 ? `${(m / 1000).toFixed(3)} km` : m >= 100 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`; }

function strokePolyline(pts, color, width, dash, alpha) {
  if (!pts || pts.length < 4) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  ctx.restore();
}

function label(text, x, y, size, color) {
  if (!text) return;
  ctx.font = `700 ${size}px ${LABEL_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.32; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function emoji(text, x, y, size) {
  ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
}

function drawArrow(x1, y1, x2, y2, head, color, lw) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(a - Math.PI / 6), y2 - head * Math.sin(a - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(a + Math.PI / 6), y2 - head * Math.sin(a + Math.PI / 6));
  ctx.closePath(); ctx.fill();
}

function drawZoneShape(sh, s) {
  const red = sh.zone === 'red';
  const pts = zoneShapePolygon(sh, 64);
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = red ? 'rgba(239,68,68,0.30)' : 'rgba(249,115,22,0.26)'; ctx.fill();
  ctx.strokeStyle = red ? 'rgba(239,68,68,1)' : 'rgba(249,115,22,0.95)'; ctx.lineWidth = 2.2 / s;
  if (!red) ctx.setLineDash([8 / s, 5 / s]);
  ctx.stroke(); ctx.setLineDash([]);
}

function simpleMarkerColor(m) {
  if (m.type && m.type.startsWith('custom-')) return 'rgba(168,85,247,0.38)';
  return ['', 'rgba(16,185,129,0.38)', 'rgba(234,179,8,0.38)', 'rgba(249,115,22,0.4)', 'rgba(239,68,68,0.45)', 'rgba(185,28,28,0.55)'][m.riskLevel || 3] || 'rgba(255,0,0,0.4)';
}

// ═══════════════════════════════════════════════
//  히트 테스트 (이미지 좌표 입력)
// ═══════════════════════════════════════════════

function hitHeadingHandle(ix, iy) {
  const sel = S.selection;
  if (!sel || sel.kind !== 'marker') return null;
  const m = liveMarkers().find(mm => mm.id === sel.id);
  if (!m || !m.isEquipment || m._live) return null;
  const s = getT().s, al = 46 / s, h = m.heading || 0;
  return Math.hypot(ix - (m.x + al * Math.cos(h)), iy - (m.y + al * Math.sin(h))) <= 11 / s ? m : null;
}
function hitMarker(ix, iy) {
  const s = getT().s;
  const ms = liveMarkers();
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m.isEquipment && Math.hypot(ix - m.x, iy - m.y) <= 18 / s) return m;
  }
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (!m.isEquipment && Math.hypot(ix - m.x, iy - m.y) <= Math.max(m.radius, 14 / s)) return m;
  }
  return null;
}
function hitPin(ix, iy) {
  if (!S.route) return -1;
  const s = getT().s;
  return S.route.points.findIndex(p => Math.hypot(ix - p.x, iy - p.y) <= 13 / s);
}
function hitBuilding(ix, iy) {
  const polys = getContourPolys();
  for (let i = polys.length - 1; i >= 0; i--) if (polys[i].length >= 6 && isPointInPolygon(ix, iy, polys[i])) return i;
  return -1;
}

/** 현재 화면(오버레이 제외)을 PNG로 */
function exportPng() {
  render();
  canvas.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `soc-map_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
