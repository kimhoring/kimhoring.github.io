/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v12 — 앱 진입점: 입력 처리, 업로드/백업, AI 서버 연동, 경로 계산
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const stage = $('stage');

// ═══════════════════════════════════════════════
//  상태 변경 훅 연결
// ═══════════════════════════════════════════════

let _routeTimer = null;
onDocChanged = (opts) => {
  requestRender();
  if (opts.risk !== false && S.route && S.route.points.length === 2) {
    clearTimeout(_routeTimer);
    _routeTimer = setTimeout(() => computeRoute({ quiet: true }), 250);
  }
  if (S.mode === '3d') View3D.rebuild();
  updateUndoButtons();
};
onDocReplaced = () => {
  if (S.selection && S.selection.kind === 'marker' && !S.markers.some(m => m.id === S.selection.id)) S.selection = null;
  if (S.selection && S.selection.kind === 'building' && S.selection.idx >= S.contours.length) S.selection = null;
  buildItemGrids(); renderEnvZoneList(); renderEnvControls(); renderModeUI(); renderInspector();
  updateEmptyState();
  onDocChanged({ history: false });
};
onHistoryChange = updateUndoButtons;
onViewChange = () => { $('zoomLabel').textContent = Math.round(getT().s / fitScale() * 100) + '%'; };

function updateEmptyState() {
  $('emptyState').hidden = !!(S.bgImage || S.contours.length || S.markers.length || S.project.origin);
}

// ═══════════════════════════════════════════════
//  모드
// ═══════════════════════════════════════════════

function setMode(mode) {
  if (S.mode === mode) return;
  S.mode = mode;
  S.draft = null;
  if (mode === '3d') {
    if (!View3D.available()) { toast('3D 라이브러리(Three.js)를 불러오지 못했습니다. 인터넷 연결을 확인하세요.', 'error'); S.mode = 'select'; }
    else { $('view3d').hidden = false; View3D.show($('view3d')); }
  }
  if (S.mode !== '3d') { $('view3d').hidden = true; View3D.hide(); }
  canvas.style.cursor = ['select'].includes(S.mode) ? 'default' : 'crosshair';
  if (MODE_WS[S.mode] && S.ws !== MODE_WS[S.mode]) setWorkspace(MODE_WS[S.mode], { fromMode: true });
  // 태블릿: 패널이 지도를 덮으므로 그리기·경로 도구를 고르면 패널을 접어 지도를 보이게 한다
  if (window.innerWidth < 820 && !['select', '3d'].includes(S.mode)) { $('app').classList.add('collapsed'); resizeCanvas(); }
  renderModeUI(); renderInspector(); renderRouteCard(); requestRender();
}

// ═══════════════════════════════════════════════
//  캔버스 포인터 입력
// ═══════════════════════════════════════════════

let gesture = null, spaceDown = false, lastHover = null;
const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const sp = pos(e), ip = screenToImg(sp.x, sp.y);
  const t0 = getT(), panStart = { sx: sp.x, sy: sp.y, px: t0.ox, py: t0.oy };
  if (e.button === 1 || e.button === 2 || spaceDown) { gesture = { type: 'pan', ...panStart }; canvas.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (pickCallback) { gesture = { type: 'pick', ...panStart, ip }; return; }

  switch (S.mode) {
    case 'select': {
      const handle = hitHeadingHandle(ip.x, ip.y);
      if (handle) { gesture = { type: 'rotate', id: handle.id }; return; }
      const m = hitMarker(ip.x, ip.y);
      if (m) {
        select({ kind: 'marker', id: m.id });
        gesture = { type: 'move', id: m.id, dx: ip.x - m.x, dy: ip.y - m.y, moved: false };
        return;
      }
      gesture = { type: 'panOrClick', ...panStart, ip };
      return;
    }
    case 'building': case 'road': case 'fence': case 'lasso': case 'zone': {
      const width = S.mode === 'road' ? S.settings.roadWidth : S.settings.fenceWidth;
      S.draft = { kind: S.mode, points: [ip.x, ip.y], last: sp, width };
      gesture = { type: 'draw' };
      requestRender();
      return;
    }
    case 'align':
      gesture = { type: 'alignClick', ...panStart, ip };
      return;
    case 'measure':
      gesture = { type: 'measureClick', ...panStart, ip };
      return;
    case 'route': {
      const pin = hitPin(ip.x, ip.y);
      gesture = pin >= 0 ? { type: 'pin', idx: pin } : { type: 'routeClick', ...panStart, ip };
      return;
    }
  }
});

canvas.addEventListener('pointermove', e => {
  const sp = pos(e), ip = screenToImg(sp.x, sp.y);
  lastHover = ip;
  if (S.mode === 'measure' && S.measure && !S.measure.closed) { S.measure.hover = ip; requestRender(); }
  updateCursorInfo(ip);
  if (!gesture) { updateHoverCursor(ip); return; }

  switch (gesture.type) {
    case 'pan':
      S.view.ox = gesture.px + sp.x - gesture.sx; S.view.oy = gesture.py + sp.y - gesture.sy; requestRender();
      break;
    case 'panOrClick': case 'routeClick': case 'alignClick': case 'measureClick': case 'pick':
      if (Math.hypot(sp.x - gesture.sx, sp.y - gesture.sy) > 5) { gesture.type = 'pan'; canvas.style.cursor = 'grabbing'; }
      break;
    case 'draw': {
      const d = S.draft;
      if (Math.hypot(sp.x - d.last.x, sp.y - d.last.y) >= 4) { d.points.push(ip.x, ip.y); d.last = sp; requestRender(); }
      break;
    }
    case 'move': {
      const m = S.markers.find(mm => mm.id === gesture.id);
      if (m) { m.x = ip.x - gesture.dx; m.y = ip.y - gesture.dy; gesture.moved = true; changed({ history: false }); refreshEquipmentFormula(); }
      break;
    }
    case 'rotate': {
      const m = S.markers.find(mm => mm.id === gesture.id);
      if (m) {
        let deg = rad2deg(normalizeAngle(Math.atan2(ip.y - m.y, ip.x - m.x)));
        if (!e.shiftKey) deg = Math.round(deg / 5) * 5; // Shift: 자유 회전
        m.heading = deg2rad(deg % 360);
        gesture.moved = true;
        changed({ history: false });
        const lbl = $('insHeading'); if (lbl) lbl.textContent = Math.round(deg % 360) + '°';
        const sl = document.querySelector('[data-eq="heading"]'); if (sl) sl.value = Math.round(deg % 360);
        refreshEquipmentFormula();
      }
      break;
    }
    case 'pin':
      S.route.points[gesture.idx] = { x: ip.x, y: ip.y }; requestRender();
      break;
  }
});

canvas.addEventListener('pointerup', e => {
  const g = gesture; gesture = null;
  canvas.style.cursor = S.mode === 'select' ? 'default' : 'crosshair';
  if (!g) return;
  switch (g.type) {
    case 'panOrClick': {
      const b = hitBuilding(g.ip.x, g.ip.y);
      select(b >= 0 ? { kind: 'building', idx: b } : null);
      break;
    }
    case 'routeClick': addRoutePoint(g.ip); break;
    case 'alignClick': onAlignClick(g.ip); break;
    case 'measureClick': addMeasurePoint(g.ip); break;
    case 'pick': { const cb = pickCallback; pickCallback = null; $('hintText').textContent = ''; cb(g.ip); break; }
    case 'draw': finishDraft(); break;
    case 'move': case 'rotate': if (g.moved) changed(); break;
    case 'pin': computeRoute(); break;
  }
});
canvas.addEventListener('pointercancel', () => { gesture = null; S.draft = null; requestRender(); });
canvas.addEventListener('pointerleave', () => { lastHover = null; $('cursorInfo').textContent = ''; });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const sp = pos(e);
  zoomAt(sp.x, sp.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

function updateHoverCursor(ip) {
  if (S.mode === 'select') {
    canvas.style.cursor = hitHeadingHandle(ip.x, ip.y) ? 'alias' : hitMarker(ip.x, ip.y) ? 'move' : hitBuilding(ip.x, ip.y) >= 0 ? 'pointer' : 'default';
  } else if (S.mode === 'route') {
    canvas.style.cursor = hitPin(ip.x, ip.y) >= 0 ? 'move' : 'crosshair';
  } else if (S.mode === 'align') {
    canvas.style.cursor = hitAlignRef(ip.x, ip.y) >= 0 ? 'pointer' : 'crosshair';
  }
}

function updateCursorInfo(ip) {
  const field = getRiskField(), r = field.at(ip.x, ip.y), F = getFrame();
  let txt;
  if (F) { const ll = F.toLatLon(ip.x, ip.y); txt = `<span>${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}</span>`; }
  else txt = `<span>x ${ip.x.toFixed(1)} m, y ${(-ip.y).toFixed(1)} m</span>`;
  if (S.measure && S.measure.points.length >= 2 && S.mode === 'measure') txt = measureSummary() + ' · ' + txt;
  if (r > 0) {
    const g = riskGrade(r), top = field.explain(ip.x, ip.y)[0];
    txt += ` · <b style="color:${g.color}">R ${fmt(r, 0)}</b> ${top ? esc(top.text) : ''}`;
  } else txt += ' · <b style="color:var(--ok)">R 0</b>';
  $('cursorInfo').innerHTML = txt;
}

function finishDraft() {
  const d = S.draft; S.draft = null;
  if (!d) return;
  const pts = d.points;
  const n = pts.length / 2;
  switch (d.kind) {
    case 'road': case 'fence':
      if (n < 2) break;
      (d.kind === 'road' ? S.polylines : S.fences).push({ points: pts, width: d.width });
      changed(); renderModeUI();
      break;
    case 'lasso':
      if (n < 3) { toast('보행 구역은 3개 이상의 점으로 그려야 합니다.', 'warn'); break; }
      S.walkableAreaPolygon = pts; changed(); renderModeUI();
      toast('보행 구역이 지정되었습니다. 경로는 이 영역 안에서만 탐색됩니다.', 'success');
      break;
    case 'zone':
      if (n < 3) break;
      S.siteEnvironment.envZones.push({ id: newId('z'), type: S.envZoneType, polygon: pts });
      changed(); renderEnvZoneList(); renderInspector();
      break;
    case 'building':
      if (n < 3 || Math.abs(polygonArea(pts)) < 4) { toast('건물이 너무 작습니다. 더 크게 그려주세요.', 'warn'); break; }
      S.contours = [...S.contours, toContour(pts)];
      changed(); renderModeUI(); updateEmptyState();
      select({ kind: 'building', idx: S.contours.length - 1 });
      break;
  }
  requestRender();
}

// ── 지도에서 한 점 고르기 (프로젝트 위치·정합 기준점 등) ──
let pickCallback = null;
function pickOnMap(hint, cb) {
  pickCallback = cb;
  $('hintText').textContent = '📌 ' + hint + ' (Esc: 취소)';
  canvas.style.cursor = 'crosshair';
  toast(hint, 'info', { duration: 4000 });
}

// ── 거리 · 면적 측정 ──
function addMeasurePoint(ip) {
  const M = S.measure;
  if (!M || M.closed) { S.measure = { points: [ip.x, ip.y], closed: false }; renderModeUI(); requestRender(); return; }
  const s = getT().s;
  if (M.points.length >= 6 && Math.hypot(ip.x - M.points[0], ip.y - M.points[1]) <= 10 / s) M.closed = true;   // 첫 점 클릭 = 면적
  else M.points.push(ip.x, ip.y);
  renderModeUI(); requestRender();
}
function measureSummary() {
  const M = S.measure;
  if (!M || M.points.length < 4) return '';
  const p = M.points;
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  if (M.closed) {
    const per = len + Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]), area = Math.abs(polygonArea(p));
    return `둘레 <b>${fmtDist(per)}</b> · 면적 <b>${area >= 10000 ? (area / 10000).toFixed(3) + ' ha' : area.toFixed(1) + ' ㎡'}</b>`;
  }
  return `거리 <b>${fmtDist(len)}</b>`;
}

function polygonArea(p) { let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]; return a / 2; }
function toContour(flat) { const c = []; for (let i = 0; i < flat.length; i += 2) c.push([[+flat[i].toFixed(2), +flat[i + 1].toFixed(2)]]); return c; }

// ═══════════════════════════════════════════════
//  선택 · 편집
// ═══════════════════════════════════════════════

function select(sel) {
  S.selection = sel;
  renderInspector(); requestRender();
}

function deleteSelection() {
  const sel = S.selection;
  if (!sel) return;
  if (sel.kind === 'marker') {
    S.markers = S.markers.filter(m => m.id !== sel.id);
  } else if (sel.kind === 'building') {
    deleteBuilding(sel.idx);
  }
  S.selection = null;
  changed(); renderInspector(); renderModeUI();
}

/** 건물 삭제 시 buildingData 인덱스를 당겨서 맞춘다 */
function deleteBuilding(idx) {
  const poly = getContourPolys()[idx];
  S.contours = S.contours.filter((_, i) => i !== idx);
  if (poly) S.nodes = S.nodes.filter(n => !isPointInPolygon(n.cx, n.cy, poly));
  const nb = {};
  for (const [k, v] of Object.entries(S.buildingData)) {
    const i = +k;
    if (i < idx) nb[i] = v; else if (i > idx) nb[i - 1] = v;
  }
  S.buildingData = nb;
}

function duplicateSelection() {
  const m = selectedMarker();
  if (!m) return;
  const copy = JSON.parse(JSON.stringify(m));
  copy.id = newId('m'); copy.x += 3; copy.y += 3;
  S.markers.push(copy);
  select({ kind: 'marker', id: copy.id });
  changed();
}

function placeItem(item, x, y) {
  let m;
  if (item.isEquipment) {
    const t = EQUIPMENT_TYPES[item.type];
    if (!t) return;
    m = { id: newId('m'), type: item.type, x, y, heading: 0, label: t.label, icon: t.icon, isEquipment: true,
      equipmentParams: { ...DEFAULT_EQUIPMENT_PARAMS[item.type] }, mitigation: { signalman: false, rearCamera: item.type === 'excavator', outriggerFixed: false } };   // 후방영상장치는 굴착기 법정 의무(제221조의2)
  } else {
    m = { id: newId('m'), type: item.type, x, y, radius: item.defaultRadius || 30, label: item.label, icon: item.icon, riskLevel: item.riskLevel || 3, isEquipment: false };
  }
  S.markers.push(m);
  if (S.mode !== 'select') setMode('select');
  select({ kind: 'marker', id: m.id });
  changed(); updateEmptyState(); renderModeUI();
}

// 인스펙터 입력 (이벤트 위임)
$('inspector').addEventListener('input', e => {
  const t = e.target, m = selectedMarker();
  if (t.dataset.eq === 'heading' && m) {
    m.heading = deg2rad(+t.value); $('insHeading').textContent = t.value + '°';
  } else if (t.dataset.param && m) {
    const k = t.dataset.param, info = PARAM_LABELS[k] || { unit: '' };
    let v = +t.value;
    m.equipmentParams[k] = v;
    if (k === 'L_jib') { // 트롤리는 지브 길이를 넘을 수 없다
      const tr = document.querySelector('[data-param="d_trolley"]');
      if (tr) tr.max = v;
      if (m.equipmentParams.d_trolley > v) { m.equipmentParams.d_trolley = v; if (tr) tr.value = v; setParamLabel('d_trolley', v); }
    }
    setParamLabel(k, v, info);
    if (k === 'v_wind') renderEnvControls();
  } else if (t.dataset.hz && m) {
    m[t.dataset.hz] = +t.value;
    if (t.dataset.hz === 'radius') $('insRadius').textContent = `${m.radius} m`;
    else $('insLevel').textContent = `${m.riskLevel} → R=${m.riskLevel * 20}`;
  } else if (t.dataset.bd && S.selection && S.selection.kind === 'building') {
    const idx = S.selection.idx, bd = S.buildingData[idx] || (S.buildingData[idx] = {});
    if (t.dataset.bd === 'name') bd.name = t.value.trim();
    else if (t.dataset.bd === 'floors') bd.floors = Math.max(0, Math.min(80, parseInt(t.value, 10) || 0)) || undefined;
    changed({ risk: false });
    return;
  } else return;
  changed();
  refreshEquipmentFormula();
});
function setParamLabel(k, v, info = PARAM_LABELS[k] || { unit: '' }) {
  const l = document.querySelector(`[data-param-label="${k}"]`);
  if (l) l.textContent = `${v} ${info.unit}`;
}
$('inspector').addEventListener('change', e => {
  const t = e.target, m = selectedMarker();
  if (t.dataset.mit && m) { m.mitigation = { ...m.mitigation, [t.dataset.mit]: t.checked }; changed(); refreshEquipmentFormula(); }
  if (t.dataset.eqflag && m) { m[t.dataset.eqflag] = t.checked; changed(); refreshEquipmentFormula(); renderEnvControls(); }
  if (t.dataset.bd === 'entranceBlocked' && S.selection) {
    const idx = S.selection.idx;
    (S.buildingData[idx] || (S.buildingData[idx] = {})).entranceBlocked = t.checked;
    changed(); renderInspector();
  }
  if (t.dataset.bd === 'name') renderInspector();
});

// 버튼 액션 (이벤트 위임)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const actions = {
    deselect: () => select(null),
    deleteSel: deleteSelection,
    deleteBuilding: deleteSelection,
    duplicate: duplicateSelection,
    toggleRouteCard: () => { $('routeCard').classList.toggle('mini'); renderRouteCard(); },
    clearRoute: () => { S.route = null; renderRouteCard(); renderModeUI(); requestRender(); View3D.rebuild(); },
    clearRoads: () => { S.polylines = []; changed(); renderModeUI(); },
    clearFences: () => { S.fences = []; changed(); renderModeUI(); },
    clearLasso: () => { S.walkableAreaPolygon = []; changed(); renderModeUI(); },
    clearMeasure: () => { S.measure = null; renderModeUI(); requestRender(); },
    clearBuildings: () => {
      if (!confirm('모든 건물을 지울까요? (Ctrl+Z로 되돌릴 수 있습니다)')) return;
      S.contours = []; S.nodes = []; S.buildingData = {}; S.selection = null; changed(); renderModeUI(); renderInspector();
    },
  };
  if (actions[act]) actions[act]();
});

// ═══════════════════════════════════════════════
//  경로 탐색
// ═══════════════════════════════════════════════

function addRoutePoint(p) {
  if (!S.route || S.route.points.length >= 2) S.route = { points: [], result: null, redirect: null };
  S.route.points.push({ x: p.x, y: p.y });
  if (S.route.points.length === 2) computeRoute();
  else { renderRouteCard(); $('hintText').textContent = '도착지를 클릭하세요.'; }
  renderModeUI(); requestRender();
}

function computeRoute({ quiet = false } = {}) {
  const R = S.route;
  if (!R || R.points.length < 2) return;
  const start = R.points[0];
  let end = R.points[1];
  let redirect = null;

  // 현관 출입 불가 건물이 도착지면 → 가장 가까운 다른 건물로 진입 후 지하로 이동
  const polys = getContourPolys();
  const bi = hitBuilding(end.x, end.y);
  if (bi >= 0 && S.buildingData[bi] && S.buildingData[bi].entranceBlocked) {
    const nameOf = (i) => (S.buildingData[i] && S.buildingData[i].name) || `건물 #${i + 1}`;
    const target = polygonCentroid(polys[bi]);
    let best = -1, bestD = Infinity;
    polys.forEach((p, i) => {
      if (i === bi || p.length < 6 || (S.buildingData[i] && S.buildingData[i].entranceBlocked)) return;
      const c = polygonCentroid(p), d = Math.hypot(c.x - target.x, c.y - target.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) {
      const via = polygonCentroid(polys[best]);
      redirect = { fromName: nameOf(bi), viaName: nameOf(best), via, target };
      end = via;
    } else {
      redirect = { fromName: nameOf(bi) };
    }
  }

  const field = getRiskField();
  const result = planRoute({
    ext: docExtent(), contours: S.contours, walkable: S.walkableAreaPolygon, polylines: S.polylines, fences: S.fences,
    field, start, end, weight: Math.pow(S.settings.safetyLevel / 10, 2),
  });
  R.result = result; R.redirect = result ? redirect : null;
  R.pieces = result ? riskPieces(result.path, field) : [];
  if (!result && !quiet) {
    toast(S.walkableAreaPolygon.length >= 6
      ? '경로를 찾을 수 없습니다.\n출발/도착 지점이 보행 구역 밖이거나 울타리·건물로 완전히 막혀 있습니다.'
      : '경로를 찾을 수 없습니다.\n울타리·건물로 막혀 있거나, 도로가 서로 연결되어 있지 않습니다.', 'error');
  }
  renderRouteCard(); requestRender(); View3D.rebuild();
}

/** 경로 중 위험 구간(R≥30)을 색칠하기 위한 조각들 */
function riskPieces(path, field) {
  const out = [];
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i], ay = path[i + 1], bx = path[i + 2], by = path[i + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.4));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const r = field.at(ax + (bx - ax) * (t0 + t1) / 2, ay + (by - ay) * (t0 + t1) / 2);
      if (r >= 30) out.push([ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, r]);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════
//  사이드바 이벤트
// ═══════════════════════════════════════════════

// 모든 도구 버튼 (패널 · 하단 도구 · 지도 컨트롤 · 3D 패널)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b && !b.closest('.modal')) setMode(b.dataset.mode);
});
document.querySelectorAll('.rail-btn').forEach(b => b.addEventListener('click', () => setWorkspace(b.dataset.ws, { toggle: true })));

// ── 팝오버 (프로젝트 메뉴 · 지도 레이어) ──
function togglePopover(id, anchor) {
  const pop = $(id), open = pop.hidden;
  document.querySelectorAll('.popover').forEach(p => { p.hidden = true; });
  pop.hidden = !open;
  if (open && anchor) anchor.classList.add('open');
}
document.addEventListener('click', e => {
  if (e.target.closest('.popover') || e.target.closest('#prjSwitch') || e.target.closest('#layersBtn')) return;
  document.querySelectorAll('.popover').forEach(p => { p.hidden = true; });
});
$('prjSwitch').addEventListener('click', () => togglePopover('prjMenu'));
$('prjMenu').addEventListener('click', e => { if (e.target.closest('.menu-item')) $('prjMenu').hidden = true; });
$('layersBtn').addEventListener('click', () => togglePopover('layersPop'));
document.querySelectorAll('input[name="basemapQuick"]').forEach(r => r.addEventListener('change', () => {
  S.layers.basemap = r.value; $('basemapSelect').value = r.value; requestRender(); updateAttribution();
}));
$('planOpacityQuick').addEventListener('input', e => { S.plan.opacity = +e.target.value; $('planOpacity').value = e.target.value; requestRender(); });
$('planOpacityQuick').addEventListener('change', () => changed({ risk: false }));
$('joinBtn').addEventListener('click', () => { renderProject(); openModal('joinModal'); });
$('alertBell').addEventListener('click', () => setWorkspace('monitor'));

$('modeOptions').addEventListener('input', e => {
  const k = e.target.dataset.setting;
  if (!k) return;
  S.settings[k] = +e.target.value;
  $('thickLabel').textContent = e.target.value + ' m';
  changed({ risk: false });
});
$('modeOptions').addEventListener('click', e => {
  const z = e.target.closest('[data-zone]');
  if (z) { S.envZoneType = z.dataset.zone; renderModeUI(); }
});

$('envZoneList').addEventListener('change', e => {
  const id = e.target.dataset.zoneKv;
  if (!id) return;
  const z = S.siteEnvironment.envZones.find(q => q.id === id);
  if (!z) return;
  z.kV = Math.max(1, Math.min(765, +e.target.value || DEFAULT_POWERLINE_KV));
  changed(); renderEnvZoneList(); refreshEquipmentFormula();
});
$('envZoneList').addEventListener('click', e => {
  const b = e.target.closest('[data-del-zone]');
  if (!b) return;
  S.siteEnvironment.envZones = S.siteEnvironment.envZones.filter(z => z.id !== b.dataset.delZone);
  changed(); renderEnvZoneList(); renderInspector();
});

$('windSlider').addEventListener('input', e => {
  S.siteEnvironment.windSpeed = +e.target.value;
  renderEnvControls(); changed(); refreshEquipmentFormula();
});
$('safetySlider').addEventListener('input', e => {
  S.settings.safetyLevel = +e.target.value;
  $('safetyLabel').textContent = e.target.value;
  changed({ risk: false, history: true });
  if (S.route && S.route.points.length === 2) { clearTimeout(_routeTimer); _routeTimer = setTimeout(() => computeRoute({ quiet: true }), 150); }
});
$('basemapSelect').addEventListener('change', e => { S.layers.basemap = e.target.value; syncQuickLayers(); requestRender(); updateAttribution(); });
$('planOpacity').addEventListener('input', e => { S.plan.opacity = +e.target.value; $('planOpacityQuick').value = e.target.value; requestRender(); });
function syncQuickLayers() {
  document.querySelectorAll('input[name="basemapQuick"]').forEach(r => { r.checked = r.value === S.layers.basemap; });
  $('planOpacityQuick').value = S.plan.opacity ?? 0.85;
}
$('planOpacity').addEventListener('change', () => changed({ risk: false }));
function updateAttribution() {
  const t = S.project.origin ? Basemap.attribution() : '';
  $('mapAttribution').textContent = t; $('mapAttribution').hidden = !t;
}
$('bldgHeightSlider').addEventListener('input', e => {
  S.settings.buildingHeight = +e.target.value; $('bldgHeightLabel').textContent = e.target.value; changed({ risk: false });
});
$('showUnderground').addEventListener('change', e => { S.settings.showUnderground = e.target.checked; changed({ risk: false }); });

const layerInputs = { layerBg: 'bg', layerHeat: 'heat', layerZones: 'zones', layerShortest: 'shortest' };
for (const [id, key] of Object.entries(layerInputs)) {
  $(id).addEventListener('change', e => { S.layers[key] = e.target.checked; syncLayerUI(); requestRender(); });
}
function syncLayerUI() {
  for (const [id, key] of Object.entries(layerInputs)) $(id).checked = S.layers[key];
  $('tbHeat').classList.toggle('on', S.layers.heat);
}
function toggleHeat() { S.layers.heat = !S.layers.heat; syncLayerUI(); requestRender(); }

$('confSlider').addEventListener('input', e => { $('confLabel').textContent = (+e.target.value).toFixed(2); });

// 장비/위험물: 끌어다 놓기 또는 클릭
for (const gridId of ['equipmentGrid', 'hazardGrid']) {
  const grid = $(gridId);
  grid.addEventListener('dragstart', e => {
    const it = e.target.closest('[data-item]');
    if (it) { e.dataTransfer.setData('application/x-socmap-item', it.dataset.item); e.dataTransfer.effectAllowed = 'copy'; }
  });
  grid.addEventListener('click', e => {
    const del = e.target.closest('[data-del-custom]');
    if (del) {
      S.customItems = S.customItems.filter(c => c.type !== del.dataset.delCustom);
      buildItemGrids(); changed({ risk: false }); return;
    }
    const it = e.target.closest('[data-item]');
    if (!it) return;
    const c = screenToImg(CW / 2 + (Math.random() - 0.5) * 60, CH / 2 + (Math.random() - 0.5) * 60);
    placeItem(JSON.parse(it.dataset.item), c.x, c.y);
  });
}

stage.addEventListener('dragover', e => {
  e.preventDefault();
  if ([...e.dataTransfer.types].includes('Files')) stage.classList.add('drop-hover');
});
stage.addEventListener('dragleave', e => { if (e.target === stage || !stage.contains(e.relatedTarget)) stage.classList.remove('drop-hover'); });
stage.addEventListener('drop', e => {
  e.preventDefault();
  stage.classList.remove('drop-hover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) {
    if (file.type.startsWith('image/')) handleUpload(file);
    else if (file.name.endsWith('.json')) handleImport(file);
    else toast('이미지 또는 .json 백업 파일만 열 수 있습니다.', 'warn');
    return;
  }
  const data = e.dataTransfer.getData('application/x-socmap-item');
  if (!data || S.mode === '3d') return;
  const sp = pos(e), ip = screenToImg(sp.x, sp.y);
  placeItem(JSON.parse(data), ip.x, ip.y);
});

// 새 위험물
$('addHazardBtn').addEventListener('click', () => { openModal('hazardModal'); $('newHazardName').focus(); });
$('newHazardRadius').addEventListener('input', e => { $('newHazardRadiusLabel').textContent = e.target.value + ' m'; });
$('newHazardRisk').addEventListener('input', e => { $('newHazardRiskLabel').textContent = e.target.value; });
$('hazardAddBtn').addEventListener('click', () => {
  const label = $('newHazardName').value.trim(), icon = $('newHazardIcon').value.trim();
  if (!label || !icon) { toast('이름과 아이콘을 모두 입력해주세요.', 'warn'); return; }
  S.customItems.push({ type: 'custom-' + newId('c'), icon, label, defaultRadius: +$('newHazardRadius').value, riskLevel: +$('newHazardRisk').value });
  buildItemGrids(); changed({ risk: false });
  closeModal('hazardModal');
  $('newHazardName').value = '';
  toast(`'${label}' 위험물이 추가되었습니다.`, 'success');
});

// 툴바
$('tbUndo').addEventListener('click', undo);
$('tbRedo').addEventListener('click', redo);
$('tbZoomIn').addEventListener('click', () => zoomAt(CW / 2, CH / 2, 1.25));
$('tbZoomOut').addEventListener('click', () => zoomAt(CW / 2, CH / 2, 0.8));
$('tbFit').addEventListener('click', fitView);
$('tbHeat').addEventListener('click', toggleHeat);
$('tbPng').addEventListener('click', exportPng);
$('helpBtn').addEventListener('click', () => openModal('helpModal'));
$('tbSidebar').addEventListener('click', () => { document.querySelector('.app').classList.toggle('collapsed'); });

function undo() { if (History.undo()) toast('실행 취소', 'info', { duration: 1200 }); }
function redo() { if (History.redo()) toast('다시 실행', 'info', { duration: 1200 }); }

// ═══════════════════════════════════════════════
//  키보드
// ═══════════════════════════════════════════════

window.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    if (typing) { e.target.blur(); return; }
    if (pickCallback) { pickCallback = null; $('hintText').textContent = ''; toast('지점 선택을 취소했습니다.', 'info', { duration: 1500 }); }
    else if (S.mode === 'measure' && S.measure) { S.measure = null; renderModeUI(); }
    else if (S.draft) { S.draft = null; gesture = null; }
    else if (S.selection) select(null);
    else if (S.route) { S.route = null; renderRouteCard(); renderModeUI(); View3D.rebuild(); }
    requestRender();
    return;
  }
  if (typing) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (ctrl && k === 's') { e.preventDefault(); handleExport(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { if (S.selection) { e.preventDefault(); deleteSelection(); } return; }
  if (e.key === ' ') { spaceDown = true; if (!gesture) canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  const mode = MODES.find(m => m.key === e.key);
  if (mode) { setMode(mode.id); return; }
  if (k === 'h') toggleHeat();
  else if (k === 'f') fitView();
  else if (e.key === '+' || e.key === '=') zoomAt(CW / 2, CH / 2, 1.25);
  else if (e.key === '-') zoomAt(CW / 2, CH / 2, 0.8);
  else if (k === 'r') {
    const m = selectedMarker();
    if (m && m.isEquipment) {
      m.heading = normalizeAngle((m.heading || 0) + deg2rad(e.shiftKey ? -15 : 15));
      changed(); renderInspector();
    }
  }
});
window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; if (!gesture) canvas.style.cursor = S.mode === 'select' ? 'default' : 'crosshair'; } });

// ═══════════════════════════════════════════════
//  AI 서버
// ═══════════════════════════════════════════════

// 서버가 이 페이지를 직접 제공(/map)하면 그 주소를, 파일로 열었으면 저장된 주소 또는 localhost 를 쓴다
let BACKEND_URL = (() => {
  if (/^https?:$/.test(location.protocol) && location.pathname.endsWith('/map')) return location.origin;
  try { return localStorage.getItem('SOC_MAP_BACKEND_URL') || 'http://localhost:8000'; } catch (e) { return 'http://localhost:8000'; }
})();
let backendInfo = null;

async function checkBackend() {
  const dot = $('statusDot'), txt = $('statusText');
  try {
    const res = await fetch(BACKEND_URL + '/health', { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(res.status);
    backendInfo = await res.json();
    S.backendOnline = true;
    dot.className = 'dot online';
    txt.textContent = backendInfo.model_loaded ? '서버 연결됨' : '서버 연결됨 (AI 모델 준비 중)';
    txt.style.color = '';
  } catch (e) {
    S.backendOnline = false; backendInfo = null;
    dot.className = 'dot offline';
    txt.textContent = '서버 꺼짐 · 로컬 모드';
    txt.style.color = 'var(--muted)';
  }
  return S.backendOnline;
}

$('backendBtn').addEventListener('click', () => {
  $('backendUrlInput').value = BACKEND_URL;
  $('backendDetail').textContent = backendInfo
    ? `상태: ${backendInfo.status} · 모델: ${backendInfo.model_exists ? '있음' : '없음'} (${backendInfo.task || '-'})`
    : '현재 연결되어 있지 않습니다.';
  openModal('backendModal');
});
$('backendSaveBtn').addEventListener('click', async () => {
  const url = $('backendUrlInput').value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) { toast('http:// 또는 https:// 로 시작하는 주소를 입력하세요.', 'warn'); return; }
  BACKEND_URL = url;
  try { localStorage.setItem('SOC_MAP_BACKEND_URL', url); } catch (e) { /* noop */ }
  closeModal('backendModal');
  toast((await checkBackend()) ? 'AI 서버에 연결되었습니다.' : 'AI 서버에 연결할 수 없습니다.', S.backendOnline ? 'success' : 'error');
});

// ═══════════════════════════════════════════════
//  업로드 · 백업
// ═══════════════════════════════════════════════

const readAsDataURL = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
const loadImage = (src) => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });

function setBackground(img, src, { newPlan = false } = {}) {
  S.bgImage = img; S.bgImageSrc = src;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (newPlan || !S.plan.transform || !S.plan.width) {
    if (newPlan || !S.plan.transform) { S.plan.transform = defaultPlanTransform(w, h); S.plan.refs = []; }
  }
  S.plan.width = w; S.plan.height = h;
  invalidateExtent();
  S.layers.bg = true; syncLayerUI();
  fitView(); updateEmptyState();
  if (!Autosave.saveBackground()) toast('도면 이미지가 커서 브라우저 자동 저장에서는 제외됩니다.\n작업을 지키려면 💾 저장(백업)을 이용하세요.', 'warn', { duration: 6000 });
}

async function handleUpload(file) {
  if (!file.type.startsWith('image/')) { toast('이미지 파일만 업로드할 수 있습니다.', 'error'); return; }
  let img, src;
  try { src = await readAsDataURL(file); img = await loadImage(src); } catch (e) { toast('이미지 파일을 읽을 수 없습니다.', 'error'); return; }

  // 새 도면이므로 이전 도면에 종속된 건물 정보와 경로는 초기화
  S.contours = []; S.nodes = []; S.buildingData = {}; S.route = null; S.selection = null;
  setBackground(img, src, { newPlan: true });
  toast(S.project.origin
    ? '도면을 현장 위치에 임시로 놓았습니다 (1px = 0.1m 가정).\n「📍 도면 정합」에서 기준점 2~3개를 지정하면 실제 위치·축척에 정확히 맞춰집니다.'
    : '도면을 불러왔습니다 (1px = 0.1m 가정). 프로젝트 위치를 지정한 뒤 「📍 도면 정합」으로 실제 위치에 맞추세요.', 'info', { duration: 8000 });
  renderRouteCard(); renderInspector();

  if (!S.backendOnline) await checkBackend();
  if (!S.backendOnline) {
    toast('AI 서버가 꺼져 있어 도면만 불러왔습니다.\n「🏢 건물 그리기」 도구로 건물을 직접 지정할 수 있습니다.', 'warn', { duration: 6000 });
    S.bgFileName = file.name;
    History.init(); changed(); renderModeUI();
    return;
  }

  S.bgFileName = file.name;
  await runDetection(file, file.name, { reset: true });
}

function handleExport() {
  History.flush();
  const doc = JSON.parse(serializeDoc());
  doc.bgImageSrc = S.bgImageSrc;
  doc.savedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `soc-map_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('백업 파일을 저장했습니다.', 'success');
}

async function handleImport(file) {
  let doc;
  try { doc = JSON.parse(await file.text()); } catch (e) { toast('유효하지 않은 백업 파일입니다.', 'error'); return; }
  await loadDocument(doc, doc.bgImageSrc || null);
  toast(`'${file.name}' 을(를) 불러왔습니다.`, 'success');
}

async function loadDocument(doc, bgSrc) {
  applyDoc(doc);
  S.bgFileName = null;
  S.route = null; S.selection = null;
  if (bgSrc) {
    try { setBackground(await loadImage(bgSrc), bgSrc); } catch (e) { S.bgImage = null; S.bgImageSrc = null; }
  } else { S.bgImage = null; S.bgImageSrc = null; Autosave.saveBackground(); }
  invalidateRisk(); fitView(); updateAttribution();
  History.init(); Autosave.save(History.stack[0]);
  onDocReplaced(); renderRouteCard();
}

$('uploadBtn').addEventListener('click', () => $('fileInput').click());
$('emptyUploadBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleUpload(f); });
$('importBtn').addEventListener('click', () => $('jsonInput').click());
$('jsonInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleImport(f); });
$('exportBtn').addEventListener('click', handleExport);
$('sampleBtn').addEventListener('click', loadSample);
$('emptySampleBtn').addEventListener('click', loadSample);

// ═══════════════════════════════════════════════
//  데모용 샘플 현장 (AI 서버 없이 시연 가능)
// ═══════════════════════════════════════════════

async function loadSample() {
  if ((S.markers.length || S.contours.length) && !confirm('현재 작업을 닫고 샘플 현장을 열까요? (저장하지 않은 내용은 사라집니다)')) return;
  // 1600×1000px 가상 배치도 (1px = 0.1m → 160m × 100m 현장)
  const W = 1600, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#c8bfa9'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${80 + Math.random() * 50},60,0.08)`; g.fillRect(Math.random() * W, Math.random() * H, 3 + Math.random() * 8, 3 + Math.random() * 8); }
  g.fillStyle = '#8d8a84';
  g.fillRect(0, 455, W, 90); g.fillRect(735, 0, 90, H);
  g.strokeStyle = '#f5f5f4'; g.setLineDash([24, 18]); g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 500); g.lineTo(W, 500); g.moveTo(780, 0); g.lineTo(780, H); g.stroke(); g.setLineDash([]);
  const buildingsPx = [
    [[160, 120], [500, 120], [500, 360], [160, 360]],
    [[980, 110], [1420, 110], [1420, 250], [1140, 250], [1140, 380], [980, 380]],
    [[170, 640], [420, 640], [420, 900], [170, 900]],
    [[1000, 640], [1380, 640], [1380, 880], [1000, 880]],
  ];
  for (const b of buildingsPx) {
    g.fillStyle = '#9aa4b2'; g.strokeStyle = '#475569'; g.lineWidth = 4;
    g.beginPath(); b.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.stroke();
  }
  g.fillStyle = 'rgba(71,85,105,.25)'; g.fillRect(520, 640, 160, 230);
  const src = c.toDataURL('image/jpeg', 0.85);

  const M = (x, y) => [+(x * 0.1 - 80).toFixed(2), +(y * 0.1 - 50).toFixed(2)];   // 도면 px → 현장 m (중심 원점)
  const flat = (pts) => pts.flatMap(([x, y]) => M(x, y));
  const heading = (deg) => deg2rad(deg);
  const eq = (type, x, y, deg, params, mitigation = {}) => {
    const [mx, my] = M(x, y), t = EQUIPMENT_TYPES[type];
    return { id: newId('m'), type, x: mx, y: my, heading: heading(deg), label: t.label, icon: t.icon, isEquipment: true,
      equipmentParams: { ...DEFAULT_EQUIPMENT_PARAMS[type], ...params }, mitigation };
  };
  const doc = {
    units: 'm',
    project: { id: null, name: '샘플 현장 (가상)', origin: { lat: 35.17600, lon: 126.90650 } },
    plan: { width: W, height: H, transform: [0.1, 0, -80, 0, 0.1, -50], refs: [], opacity: 0.85 },
    contours: buildingsPx.map(b => b.map(([x, y]) => [M(x, y)])),
    nodes: [],
    buildingData: { 0: { name: '101동', floors: 6 }, 1: { name: '102동', floors: 9 }, 2: { name: '103동', floors: 4, entranceBlocked: true }, 3: { name: '104동', floors: 7 } },
    markers: [
      eq('towerCrane', 620, 300, 20, { L_jib: 35, d_trolley: 26, r_load: 3, r_shadow: 2 }),
      eq('excavator', 600, 720, 180, {}, { rearCamera: true }),
      eq('mobileCrane', 900, 600, 70, { L_boom: 14 }, { signalman: true }),
      eq('concretePumpCar', 1230, 560, 0, { r_boom: 18 }),
      { id: newId('m'), type: 'hole', ...(([x, y]) => ({ x, y }))(M(880, 300)), radius: 2.8, label: '개구부/낙하', icon: '🕳️', riskLevel: 4, isEquipment: false },
    ],
    polylines: [], walkableAreaPolygon: [],
    fences: [{ points: flat([[880, 420], [960, 420], [960, 560]]), width: 0.4 }],
    siteEnvironment: { windSpeed: 4, envZones: [
      { id: newId('z'), type: 'softGround', polygon: flat([[470, 600], [700, 600], [710, 900], [460, 900]]) },
      { id: newId('z'), type: 'powerLine', kV: 22.9, polygon: flat([[1490, 300], [1530, 300], [1530, 980], [1490, 980]]) },
    ] },
    settings: { ...DEFAULT_SETTINGS },
  };
  await loadDocument(doc, src);
  const [sx, sy] = M(60, 980), [ex, ey] = M(1300, 160);
  S.route = { points: [{ x: sx, y: sy }, { x: ex, y: ey }], result: null, redirect: null };
  computeRoute();
  setMode('select');
  toast('샘플 현장을 열었습니다 (가상 위치 · 160m × 100m).\n「🧭 경로 탐색」이나 장비 이동, 「📏 거리 측정」을 해 보세요.', 'success', { duration: 6500 });
}

// ═══════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════

async function init() {
  buildModeGrid(); buildItemGrids(); renderModeUI(); renderEnvControls(); syncLayerUI();
  let ws = 'layout';
  try { ws = localStorage.getItem('socmap.v13.ws') || 'layout'; } catch (e) { /* noop */ }
  setWorkspace(WORKSPACES.includes(ws) && ws !== 'route' ? ws : 'layout');
  if (window.innerWidth < 820) document.querySelector('.app').classList.add('collapsed');
  new ResizeObserver(() => { resizeCanvas(); View3D.resize(); }).observe(stage);
  resizeCanvas();

  const saved = Autosave.load();
  const hasWork = saved && saved.doc && ((saved.doc.markers || []).length || (saved.doc.contours || []).length || saved.bg);
  if (hasWork) {
    await loadDocument(saved.doc, saved.bg);
    toast('이전에 작업하던 내용을 자동으로 복원했습니다.', 'info', {
      duration: 7000,
      action: { label: '새로 시작', fn: () => { Autosave.clear(); loadDocument({}, null); updateEmptyState(); } },
    });
  } else {
    History.init();
  }
  updateEmptyState(); updateUndoButtons(); onViewChange();
  checkBackend();
  setInterval(checkBackend, 15000);
}
init();
