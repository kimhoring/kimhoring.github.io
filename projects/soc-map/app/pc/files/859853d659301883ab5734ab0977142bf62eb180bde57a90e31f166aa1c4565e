/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v12 — 앱 진입점: 입력 처리, 업로드/백업, AI 서버 연동, 경로 계산
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const stage = $('stage');
let PLACE = null;   // 장비·위험물 배치 중: { item, name } (startPlacing)

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
  syncViewbar();
}

// ═══════════════════════════════════════════════
//  모드
// ═══════════════════════════════════════════════

function setMode(mode) {
  if (S.mode === mode) return;
  if (mode !== 'select') cancelPlacing();   // 다른 도구를 고르면 배치를 그만둔다
  S.mode = mode;
  S.draft = null;
  if (mode === '3d') {
    if (!View3D.available()) { toast('3D 라이브러리(Three.js)를 불러오지 못했습니다. 인터넷 연결을 확인하세요.', 'error'); S.mode = 'select'; }
    else { $('view3d').hidden = false; View3D.show($('view3d')); }
  }
  if (S.mode !== '3d') { $('view3d').hidden = true; View3D.hide(); }
  syncViewbar();
  if (S.mode === '3d') showCoach3d();
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

// 두 손가락 확대·축소 (휴대폰·태블릿): 두 번째 손가락이 닿으면 그리던 것을 멈추고 확대 제스처로 바꾼다
const touches = new Map();
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') touches.set(e.pointerId, pos(e));
  if (touches.size === 2) {
    const [a, b] = [...touches.values()], t = getT();
    gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, s: t.s, ox: t.ox, oy: t.oy };
    S.draft = null; requestRender();
    return;
  }
  if (touches.size > 2) return;
}, true);
canvas.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, pos(e));
  if (!gesture || gesture.type !== 'pinch' || touches.size < 2) return;
  e.stopImmediatePropagation();
  const [a, b] = [...touches.values()], g = gesture;
  const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const s = Math.max(fitScale() * 0.2, Math.min(fitScale() * 60, g.s * d / g.d));
  const wx = (g.mx - g.ox) / g.s, wy = (g.my - g.oy) / g.s;   // 처음 두 손가락 가운데의 현장 좌표를 손가락 아래에 유지
  S.view.s = s; S.view.ox = mx - wx * s; S.view.oy = my - wy * s;
  onViewChange(); requestRender();
}, true);
const touchEnd = (e) => {
  if (!touches.delete(e.pointerId)) return;
  if (gesture && gesture.type === 'pinch') { e.stopImmediatePropagation(); if (touches.size === 0) gesture = null; }
};
canvas.addEventListener('pointerup', touchEnd, true);
canvas.addEventListener('pointercancel', touchEnd, true);

canvas.addEventListener('pointerdown', e => {
  if (gesture && gesture.type === 'pinch') return;
  canvas.setPointerCapture(e.pointerId);
  const sp = pos(e), ip = screenToImg(sp.x, sp.y);
  const t0 = getT(), panStart = { sx: sp.x, sy: sp.y, px: t0.ox, py: t0.oy };
  if (e.button === 1 || e.button === 2 || spaceDown) { gesture = { type: 'pan', ...panStart }; canvas.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (pickCallback) { gesture = { type: 'pick', ...panStart, ip }; return; }
  if (PLACE) { gesture = { type: 'placeClick', ...panStart, ip }; return; }   // 누른 곳에 놓기 (끌면 지도 이동)

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
    case 'building': case 'fence': case 'site': case 'zone': {
      const width = S.settings.fenceWidth;
      S.draft = { kind: S.mode, points: [ip.x, ip.y], last: sp, width };
      gesture = { type: 'draw' };
      requestRender();
      return;
    }
    case 'aipick':   // v14.7 끌면 사각형, 누르면 점 → MobileSAM 외곽선 (detection.js aiPick)
      gesture = { type: 'aipick', ...panStart, ip, ip2: ip, box: false };
      return;
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
  if (PLACE) requestRender();   // 놓일 모습 미리 보기가 마우스를 따라온다
  updateCursorInfo(ip);
  if (!gesture) { updateHoverCursor(ip); return; }

  switch (gesture.type) {
    case 'pan':
      S.view.ox = gesture.px + sp.x - gesture.sx; S.view.oy = gesture.py + sp.y - gesture.sy; requestRender();
      break;
    case 'panOrClick': case 'routeClick': case 'alignClick': case 'measureClick': case 'pick': case 'placeClick':
      if (Math.hypot(sp.x - gesture.sx, sp.y - gesture.sy) > 5) { gesture.type = 'pan'; canvas.style.cursor = 'grabbing'; }
      break;
    case 'draw': {
      const d = S.draft;
      if (Math.hypot(sp.x - d.last.x, sp.y - d.last.y) >= 4) { d.points.push(ip.x, ip.y); d.last = sp; requestRender(); }
      break;
    }
    case 'aipick':
      if (!gesture.box && Math.hypot(sp.x - gesture.sx, sp.y - gesture.sy) > 5) gesture.box = true;
      if (gesture.box) {
        const a = gesture.ip; gesture.ip2 = ip;
        S.draft = { kind: 'aibox', points: [a.x, a.y, ip.x, a.y, ip.x, ip.y, a.x, ip.y] };
        requestRender();
      }
      break;
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
  canvas.style.cursor = S.mode === 'select' && !PLACE ? 'default' : 'crosshair';
  if (!g) return;
  switch (g.type) {
    case 'placeClick': finishPlacing(g.ip, e.shiftKey); break;
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
    case 'aipick': {
      S.draft = null; requestRender();
      if (g.box) { aiPick({ box: [g.ip, g.ip2] }); break; }
      const b = hitBuilding(g.ip.x, g.ip.y);
      if (b >= 0) { select({ kind: 'building', idx: b }); toast('이미 건물이 있는 곳입니다. 다시 따려면 이 건물을 지운 뒤 누르세요.', 'info', { duration: 3000 }); break; }
      aiPick({ point: g.ip });
      break;
    }
    case 'move': case 'rotate': if (g.moved) changed(); break;
    case 'pin': computeRoute(); break;
  }
});
canvas.addEventListener('pointercancel', () => { gesture = null; S.draft = null; requestRender(); });
canvas.addEventListener('pointerleave', () => { lastHover = null; $('cursorInfo').textContent = ''; if (PLACE) requestRender(); });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const sp = pos(e);
  zoomAt(sp.x, sp.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

function updateHoverCursor(ip) {
  if (PLACE) { canvas.style.cursor = 'crosshair'; return; }
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
    case 'fence':
      if (n < 2) break;
      if (d.kind === 'fence' && fenceWillClose(pts, getT().s)) {   // 끝을 시작점에 붙여 닫는다 → 안쪽이 통행 금지 구역 (경로 탐색도 막힘)
        pts[pts.length - 2] = pts[0]; pts[pts.length - 1] = pts[1];
        toast('닫힌 울타리 — 안쪽이 통행 금지 구역이 되었습니다. 경로 안내도 이 안으로 들어가지 않습니다.', 'success', { duration: 3200 });
      }
      S.fences.push({ points: pts, width: d.width });
      changed(); renderModeUI();
      break;
    case 'site':
      if (n < 3) { toast('현장 경계는 3개 이상의 점으로 그려야 합니다.', 'warn'); break; }
      S.siteBoundary = pts; changed(); renderModeUI();
      toast('공사 현장 경계를 지정했습니다. 안전 경로는 이 안에서 찾고, 위험도 계산·주변 건물·근로자 위치 추적도 이 안(+30 m)에서만 합니다.\n휴대폰에는 「현장 공유」 뒤에 반영됩니다.', 'success', { duration: 6000 });
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
  if (sel && window.innerWidth < 640 && !$('app').classList.contains('collapsed')) { $('app').classList.add('collapsed'); resizeCanvas(); }   // 휴대폰: 패널을 내려 인스펙터가 보이게
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

function makeMarker(item, x, y) {
  if (item.isEquipment) {
    const t = EQUIPMENT_TYPES[item.type];
    if (!t) return null;
    return { id: newId('m'), type: item.type, x, y, heading: 0, label: t.label, icon: t.icon, isEquipment: true,
      equipmentParams: { ...DEFAULT_EQUIPMENT_PARAMS[item.type] }, mitigation: { signalman: false, rearCamera: item.type === 'excavator', outriggerFixed: false } };   // 후방영상장치는 굴착기 법정 의무(제221조의2)
  }
  return { id: newId('m'), type: item.type, x, y, radius: item.defaultRadius || 30, label: item.label, icon: item.icon, riskLevel: item.riskLevel || 3, isEquipment: false };
}

function placeItem(item, x, y) {
  const m = makeMarker(item, x, y);
  if (!m) return;
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
    const k = t.dataset.bd;
    if (k === 'name') bd.name = t.value.trim();
    else if (k === 'floors') bd.floors = Math.max(0, Math.min(80, parseInt(t.value, 10) || 0)) || undefined;
    else if (k === 'builtFloors') { bd.builtFloors = +t.value; const l = $('insBuilt'); if (l) l.textContent = `${t.value} / ${buildingSpec(idx).floors}층`; }
    else if (k === 'floorHeight') { const v = parseFloat(t.value); bd.floorHeight = v >= 2.4 && v <= 8 ? v : undefined; }
    else if (k === 'basements') bd.basements = Math.max(0, Math.min(8, parseInt(t.value, 10) || 0)) || undefined;
    else return;
    changed({ risk: false });
    return;
  } else return;
  changed();
  refreshEquipmentFormula();
});
/** 2026-11-22 인스펙터 「운영」 칸 → 문서 (선택 필드: 없으면 예전과 같게 동작) */
function applyOps(m, t) {
  const k = t.dataset.ops, box = $('inspector');
  const val = (name) => (box.querySelector(`[data-ops="${name}"]`) || {}).value;
  if (k === 'opState') { if (t.value === 'work') delete m.opState; else m.opState = t.value; }
  else if (k === 'workPad') {   // 2026-11-25 작업 구역 여유(m) — 장비 종류 기본값과 같으면 지움
    const v = Math.round(+t.value);
    if (t.value === '' || !Number.isFinite(v) || v === (WORK_PAD[m.type] || 0)) delete m.workPad; else m.workPad = Math.max(0, Math.min(WORK_PAD_MAX, v));
  }
  else if (k === 'schedOn') { if (t.checked) m.schedule = { from: val('from') || '14:00', to: val('to') || '16:00' }; else delete m.schedule; }
  else if (k === 'from' || k === 'to') { if (!m.schedule) return; m.schedule = { ...m.schedule, [k]: t.value }; }
  else if (k === 'floor') { if (t.value === '') delete m.floor; else m.floor = +t.value; }
  else if (k === 'permitOn') { m.permit = { on: t.checked, names: (m.permit && m.permit.names) || [] }; if (!t.checked && !m.permit.names.length) delete m.permit; }
  else if (k === 'permitNames') { m.permit = { on: true, names: t.value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean).slice(0, 50) }; }
  else return;
  changed();
  // 시간·이름 칸은 다시 그리지 않는다 — 다시 그리면 다음 칸으로 옮긴 입력(포커스)이 사라짐
  if (!['from', 'to', 'permitNames'].includes(k)) renderInspector();
  else if (k !== 'permitNames') { const n = box.querySelector('[data-ops-label="schedNow"]'); if (n) n.textContent = scheduleActive(m.schedule) ? '켜짐' : '꺼짐'; }
  if (k === 'schedOn' || k === 'from' || k === 'to') scheduleWatch(true);
}
function setParamLabel(k, v, info = PARAM_LABELS[k] || { unit: '' }) {
  const l = document.querySelector(`[data-param-label="${k}"]`);
  if (l) l.textContent = `${v} ${info.unit}`;
}
$('inspector').addEventListener('change', e => {
  const t = e.target, m = selectedMarker();
  if (t.dataset.ops && m) { applyOps(m, t); return; }
  if (t.dataset.mit && m) { m.mitigation = { ...m.mitigation, [t.dataset.mit]: t.checked }; changed(); refreshEquipmentFormula(); }
  if (t.dataset.eqflag && m) { m[t.dataset.eqflag] = t.checked; changed(); refreshEquipmentFormula(); renderEnvControls(); }
  if (t.dataset.bd === 'entranceBlocked' && S.selection) {
    const idx = S.selection.idx;
    (S.buildingData[idx] || (S.buildingData[idx] = {})).entranceBlocked = t.checked;
    changed(); renderInspector();
  }
  if (t.dataset.bd && S.selection && S.selection.kind === 'building' && ['structure', 'stage'].includes(t.dataset.bd)) {
    const bd = S.buildingData[S.selection.idx] || (S.buildingData[S.selection.idx] = {});
    if (t.value) bd[t.dataset.bd] = t.value; else delete bd[t.dataset.bd];
    changed({ risk: false });
  }
  if (['name', 'floors', 'floorHeight', 'basements', 'structure', 'stage'].includes(t.dataset.bd)) renderInspector();
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
    clearFences: () => { S.fences = []; changed(); renderModeUI(); },
    clearSite: () => { S.siteBoundary = []; changed(); renderModeUI(); },
    clearMeasure: () => { S.measure = null; renderModeUI(); requestRender(); },
    regularizeAll: () => regularizeBuildings(S.contours.map((_, i) => i)),
    regularizeSel: () => { if (S.selection && S.selection.kind === 'building') regularizeBuildings([S.selection.idx]); },
    mergeSel: () => { if (S.selection && S.selection.kind === 'building') mergeTouchingBuildings(S.selection.idx); },
    mergeTouching: () => mergeTouchingBuildings(),
    shadowHeight: startShadowMeasure,
    dimCheck: () => startDimCheck(),
    aipickMode: () => setMode('aipick'),
    clearBuildings: () => {
      if (!confirm('모든 건물을 지울까요? (Ctrl+Z로 되돌릴 수 있습니다)')) return;
      S.contours = []; S.nodes = []; S.buildingData = {}; S.selection = null; changed(); renderModeUI(); renderInspector();
    },
  };
  if (actions[act]) actions[act]();
});

// ═══════════════════════════════════════════════
//  건물 외곽선 직각 보정 · 그림자로 높이 추정 (structure.js)
// ═══════════════════════════════════════════════

function regularizeBuildings(list) {
  if (!S.contours.length) { toast('건물이 없습니다. 도면을 올려 AI로 인식하거나 「🏢 건물」로 그리세요.', 'warn'); return; }
  let n = 0;
  for (const i of list) {
    const p = flattenContour(S.contours[i]), q = regularizeFootprint(p);
    if (q.length >= 6 && (q.length !== p.length || q.some((v, k) => Math.abs(v - p[k]) > 0.01))) { S.contours[i] = toContour(q); n++; }
  }
  changed(); renderInspector(); requestRender();
  toast(n ? `건물 ${n}개의 외곽선을 단순화하고 직각으로 맞췄습니다. (Ctrl+Z 되돌리기)` : '이미 반듯한 외곽선입니다.', n ? 'success' : 'info');
}

/** 그림자 측정: 건물 모서리(지면) → 그 모서리 그림자 끝, 두 점을 지도에서 고른다 */
function startShadowMeasure() {
  const sel = S.selection;
  if (!sel || sel.kind !== 'building') return;
  if (!getFrame()) { toast('태양 위치를 계산하려면 프로젝트 현장 위치가 필요합니다.', 'warn'); return; }
  if (S.mode === '3d') setMode('select');
  const idx = sel.idx;
  pickOnMap('① 건물 모서리(그림자가 시작되는 지면)를 클릭하세요', a => {
    S.shadow = { idx, a, b: null }; requestRender();
    pickOnMap('② 같은 모서리 그림자의 끝을 클릭하세요', b => {
      S.shadow = { idx, a, b }; requestRender();
      const t = S.plan.capturedAt ? new Date(S.plan.capturedAt) : new Date();
      $('shadowTime').value = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      renderShadowResult(); openModal('shadowModal');
    });
  });
}
function shadowCalc() {
  const sh = S.shadow, o = S.project.origin;
  if (!sh || !sh.b || !o || !$('shadowTime').value) return null;
  const dx = sh.b.x - sh.a.x, dy = sh.b.y - sh.a.y, L = Math.hypot(dx, dy);
  const sunP = sunPosition(new Date($('shadowTime').value), o.lat, o.lon);
  const h = heightFromShadow(L, sunP.elevation), sp = buildingSpec(sh.idx);
  return { L, sun: sunP, h, dirErr: shadowDirectionError(dx, dy, sunP.azimuth), floors: h ? Math.max(1, Math.round(h / sp.floorH)) : null, floorH: sp.floorH };
}
function renderShadowResult() {
  const r = shadowCalc();
  if (!r) { $('shadowResult').innerHTML = ''; return; }
  const refs = S.plan.refs.length;
  $('shadowResult').innerHTML = `
    <div class="row"><span>그림자 길이</span><b>${fmt(r.L, 1)} m</b></div>
    <div class="row"><span>태양 고도 · 방위</span><b>${fmt(r.sun.elevation, 1)}° · ${fmt(r.sun.azimuth, 0)}°</b></div>
    <div class="row"><span>추정 높이</span><b>${r.h ? `${fmt(r.h, 1)} m → ${r.floors}층 (층고 ${r.floorH} m)` : '계산 불가 (해가 너무 낮음)'}</b></div>
    ${r.dirErr > 20 ? `<div class="alert warn">그림자 방향이 태양 반대 방향과 ${fmt(r.dirErr, 0)}° 어긋납니다. 촬영 시각·점 위치·도면 방향(정합)을 확인하세요.</div>` : `<div class="hint">그림자 방향 검증: 태양 반대 방향과 ${fmt(r.dirErr, 0)}° 차이 (양호)</div>`}
    ${refs < 2 ? '<div class="alert warn">도면 정합 기준점이 2개 미만이라 축척(1px = 0.1m 가정)이 실제와 다를 수 있습니다.</div>' : ''}`;
  $('shadowApply').disabled = !r.h;
}
$('shadowTime').addEventListener('input', renderShadowResult);
$('shadowApply').addEventListener('click', () => {
  const r = shadowCalc(), sh = S.shadow;
  if (!r || !r.h) return;
  (S.buildingData[sh.idx] || (S.buildingData[sh.idx] = {})).floors = r.floors;
  S.shadow = null; closeModal('shadowModal');
  select({ kind: 'building', idx: sh.idx }); changed({ risk: false });
  toast(`그림자로 추정한 높이 ${fmt(r.h, 1)} m → ${r.floors}층으로 설정했습니다.`, 'success');
});
document.querySelectorAll('#shadowModal [data-close]').forEach(b => b.addEventListener('click', () => { S.shadow = null; requestRender(); }));

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
    ext: docExtent(), contours: S.contours, walkable: S.siteBoundary, fences: S.fences,
    field, start, end, weight: Math.pow(S.settings.safetyLevel / 10, 2),
  });
  R.result = result; R.redirect = result ? redirect : null;
  R.pieces = result ? riskPieces(result.path, field) : [];
  if (!result && !quiet) {
    toast(hasSiteBoundary()
      ? '경로를 찾을 수 없습니다.\n출발/도착 지점이 현장 경계 밖이거나 울타리·건물로 완전히 막혀 있습니다.'
      : '경로를 찾을 수 없습니다.\n울타리·건물로 완전히 막혀 있습니다.', 'error');
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
$('joinBtn').addEventListener('click', () => { renderProject(); openModal('joinModal'); watchServerInfo(); });
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
$('basemapSelect').addEventListener('change', e => { S.layers.basemap = e.target.value; S.layers.basemapUserSet = true; syncQuickLayers(); requestRender(); updateAttribution(); if (S.mode === '3d') View3D.rebuild(); });   // 🗂️ 지도 설정 (2026-11-24 한 곳으로)
function setCadastral(on) {
  S.layers.cadastral = on; $('layerCadastral').checked = on;
  if (on && getT().s < fitScale() * 1.2 && docExtent().w > 400) toast('연속지적도는 확대(줌 15 이상)해야 보입니다.', 'info', { duration: 3000 });
  requestRender(); updateAttribution();
}
$('layerCadastral').addEventListener('change', e => setCadastral(e.target.checked));
/** 브이월드 연동 (서버 .env 에 키가 있을 때): 선택지를 보이고, 한국 현장이면 기본 배경을 브이월드 영상으로 */
function syncVWorldUI() {
  const on = !!VWORLD.key;
  document.querySelectorAll('[data-vw]').forEach(el => { el.hidden = !on; });
  $('cadastralRow').hidden = !on;
  if (on && !S.layers.basemapUserSet && S.layers.basemap === 'satellite') {
    const o = S.project.origin;
    if (!o || inKorea(o.lat, o.lon)) S.layers.basemap = 'vworld';
  }
  if (!on && BASEMAPS[S.layers.basemap] && BASEMAPS[S.layers.basemap].vworld) S.layers.basemap = 'satellite';
  $('basemapSelect').value = S.layers.basemap; syncQuickLayers(); requestRender(); updateAttribution();
}
$('planOpacity').addEventListener('input', e => { S.plan.opacity = +e.target.value; requestRender(); });
function syncQuickLayers() {
  $('basemapSelect').value = S.layers.basemap; $('planOpacity').value = S.plan.opacity ?? 0.85;
  if (typeof syncViewbar === 'function') syncViewbar();
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
$('show3dXray').addEventListener('change', e => { S.view3d.xray = e.target.checked; View3D.rebuild(); });
$('show3dScaffold').addEventListener('change', e => { S.view3d.scaffold = e.target.checked; View3D.rebuild(); });
function syncSunUI() {
  $('sunDate').value = S.view3d.date; $('sunHour').value = S.view3d.hour;
  $('sunPhoto').hidden = !S.plan.capturedAt;
}
$('sunDate').addEventListener('change', e => { if (e.target.value) { S.view3d.date = e.target.value; View3D.rebuild(); } });
$('sunHour').addEventListener('input', e => { S.view3d.hour = +e.target.value; View3D.rebuild(); });
$('sunNow').addEventListener('click', () => {
  const d = new Date();
  S.view3d.date = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); S.view3d.hour = d.getHours() + d.getMinutes() / 60;
  syncSunUI(); View3D.rebuild();
});
$('sunPhoto').addEventListener('click', () => {
  const d = new Date(S.plan.capturedAt);
  S.view3d.date = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); S.view3d.hour = d.getHours() + d.getMinutes() / 60;
  syncSunUI(); View3D.rebuild();
});
View3D.onBuilt = (sun) => {
  if (!sun) return;
  const hh = Math.floor(S.view3d.hour), mm = Math.round((S.view3d.hour - hh) * 60);
  $('sunLabel').textContent = !sun.located ? '현장 위치 없음' : sun.elevation <= 0 ? `${hh}:${String(mm).padStart(2, '0')} · 해 짐`
    : `${hh}:${String(mm).padStart(2, '0')} · 고도 ${Math.round(sun.elevation)}° ${compassName(bearingToHeading(sun.azimuth))}`;
};
View3D.onPick = (idx) => select(idx != null ? { kind: 'building', idx } : null);
syncSunUI();

const layerInputs = { layerShortest: 'shortest' };   // 나머지(배치도·위험 구역·히트맵·인원)는 보기 막대
for (const [id, key] of Object.entries(layerInputs)) {
  $(id).addEventListener('change', e => { S.layers[key] = e.target.checked; syncLayerUI(); requestRender(); if (S.mode === '3d') View3D.rebuild(); if (S.mode === 'aipick') renderModeUI(); });
}
function syncLayerUI() {
  for (const [id, key] of Object.entries(layerInputs)) $(id).checked = S.layers[key];
  syncViewbar();
}

// ── 보기 막대 (v14.6): 2D/3D 전환과 자주 쓰는 레이어를 지도 위에 글자로 ──
function syncViewbar() {
  const bar = $('viewbar');
  if (!bar) return;
  bar.hidden = !$('emptyState').hidden;
  $('vb2d').classList.toggle('on', S.mode !== '3d');
  $('vb3d').classList.toggle('on', S.mode === '3d');
  const st = { basemap: S.layers.basemap !== 'none', bg: S.layers.bg !== false, zones: S.layers.zones !== false, heat: !!S.layers.heat, people: S.layers.people !== false };
  const why = {
    basemap: !S.project.origin ? '현장 위치(📍)를 지정하면 위성 지도를 볼 수 있습니다' : '',
    bg: !S.bgImage ? '배치도(도면 그림)를 올리면 켜고 끌 수 있습니다' : '',
    heat: S.mode === '3d' ? '히트맵은 2D 지도에서만 보입니다' : '',
  };
  document.querySelectorAll('.vb-chip').forEach(b => {
    const k = b.dataset.layer;
    if (!b.dataset.title) b.dataset.title = b.title;
    b.classList.toggle('on', st[k] && !why[k]);
    b.disabled = !!why[k];
    b.title = why[k] || b.dataset.title;
  });
}
function toggleBasemapLayer() {
  if (S.layers.basemap !== 'none') { S.layers.lastBasemap = S.layers.basemap; S.layers.basemap = 'none'; }
  else S.layers.basemap = S.layers.lastBasemap || (VWORLD.key ? 'vworld' : 'satellite');
  S.layers.basemapUserSet = true;
  $('basemapSelect').value = S.layers.basemap; syncQuickLayers(); updateAttribution();
}
$('vb2d').addEventListener('click', () => { if (S.mode === '3d') setMode('select'); });
$('vb3d').addEventListener('click', () => setMode('3d'));
document.querySelectorAll('.vb-chip').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.layer;
  if (k === 'basemap') toggleBasemapLayer();
  else if (k === 'heat') { toggleHeat(); return; }
  else if (k === 'people') S.layers.people = S.layers.people === false;
  else S.layers[k] = !(S.layers[k] !== false);
  syncLayerUI(); requestRender();
  if (S.mode === '3d') View3D.rebuild();
  if (S.mode === 'aipick') renderModeUI();   // 「배치도」를 끄고 켜면 AI 건물 따기가 도면/위성 중 어디서 따는지 바뀜
}));
/** 3D 를 처음 열 때 한 번: 조작법과 레이어 안내 */
function showCoach3d() {
  try { if (localStorage.getItem('socmap.v14.coach3d')) return; localStorage.setItem('socmap.v14.coach3d', '1'); } catch (e) { return; }
  const el = document.createElement('div');
  el.className = 'coach';
  el.innerHTML = '<span>🏙️ <b>3D 보기</b> — 드래그 회전 · 오른쪽 드래그 이동 · 휠 확대.<br>위쪽 버튼으로 <b>위성 지도 · 배치도 · 위험 구역 · 인원</b>을 켜고 끕니다. 건물을 누르면 구조·공정 단계를 바꿀 수 있습니다.</span><button class="btn btn-xs">알겠어요</button>';
  el.querySelector('button').onclick = () => el.remove();
  $('stage').appendChild(el);
  setTimeout(() => el.remove(), 15000);
}
function toggleHeat() { S.layers.heat = !S.layers.heat; syncLayerUI(); requestRender(); }

$('confSlider').addEventListener('input', e => { $('confLabel').textContent = (+e.target.value).toFixed(2); });

// ── 장비/위험물 배치 (v14.8): 누르면 「OO를 배치하세요」 → 지도에서 누른 곳에 생긴다. 끌어다 놓기도 그대로 됨 ──
/** 받침 「을/를」 (마지막 한글 글자의 받침으로) */
function objJosa(word) {
  const s = String(word || '').replace(/[\s)\]」』>]+$/, '');
  const c = s.charCodeAt(s.length - 1) - 0xAC00;
  return c >= 0 && c < 11172 ? (c % 28 ? '을' : '를') : '을(를)';
}
function placeItemName(item) { return item.isEquipment ? ((EQUIPMENT_TYPES[item.type] || {}).label || '장비') : (item.label || '위험물'); }
function startPlacing(item, el) {
  if (PLACE && PLACE.item.type === item.type) { cancelPlacing(); return; }   // 같은 것을 다시 누르면 취소
  pickCallback = null;
  if (S.mode !== 'select') setMode('select');
  if (S.mode !== 'select') return;
  PLACE = { item, name: placeItemName(item) };
  document.querySelectorAll('.drag-item.placing').forEach(x => x.classList.remove('placing'));
  if (el) el.classList.add('placing');
  $('placeIcon').innerHTML = item.isEquipment ? esc((EQUIPMENT_TYPES[item.type] || {}).icon || '⚙️') : hzIconHTML(hzMarkerSign(item.type), esc(item.icon || '⚠️'));
  $('placeTitle').textContent = `${PLACE.name}${objJosa(PLACE.name)} 배치하세요`;
  $('placeBanner').hidden = false;
  $('hintText').textContent = `📍 ${PLACE.name} — 지도에서 놓을 곳을 누르세요 (끌면 지도 이동 · Shift+누르기 = 여러 개 · Esc 취소)`;
  canvas.style.cursor = 'crosshair';
  if (window.innerWidth < 820) { $('app').classList.add('collapsed'); resizeCanvas(); }   // 태블릿: 패널을 접어 지도를 보이게
  requestRender();
}
function cancelPlacing() {
  if (!PLACE) return;
  PLACE = null;
  $('placeBanner').hidden = true;
  document.querySelectorAll('.drag-item.placing').forEach(x => x.classList.remove('placing'));
  $('hintText').textContent = (MODES.find(m => m.id === S.mode) || {}).hint || '';
  canvas.style.cursor = S.mode === 'select' ? 'default' : 'crosshair';
  requestRender();
}
function finishPlacing(ip, keep) {
  const P = PLACE;
  if (!P) return;
  if (!keep) cancelPlacing();
  placeItem(P.item, ip.x, ip.y);
  if (!keep) toast(`${P.name}${objJosa(P.name)} 배치했습니다. 끌어서 옮길 수 있습니다.`, 'success', { duration: 2200 });
}
/** 놓일 모습 미리 보기 (render2d 가 부름): 장비는 위험 반경까지, 위험물은 표지까지 */
function drawPlacingGhost(g, s) {
  if (!PLACE || !lastHover || gesture) return;
  const px = (n) => n / s, p = lastHover, m = makeMarker(PLACE.item, p.x, p.y);
  if (!m) return;
  g.save(); g.globalAlpha = 0.72;
  if (m.isEquipment) {
    const eq = createEquipment(m, S.siteEnvironment);
    if (eq) (eq.isFullControl() ? [{ type: 'circle', zone: 'red', cx: eq.xc, cy: eq.yc, radius: eq.getMaxRadius() }] : eq.getZoneShapes()).forEach(sh => drawZoneShape(sh, s));
    g.beginPath(); g.arc(p.x, p.y, px(15), 0, Math.PI * 2);
    g.fillStyle = 'rgba(11,17,32,0.92)'; g.fill(); g.lineWidth = px(2.5); g.strokeStyle = '#fde68a'; g.stroke();
    emoji(m.icon || '⚙️', p.x, p.y, px(17));
  } else hzMarker(g, m, px, { fill: simpleMarkerColor(m) });
  g.restore();
  hzTag(g, `여기에 ${PLACE.name} 놓기`, p.x, p.y - px(m.isEquipment ? 46 : 56), px, '#fde68a', '#111827', 11.5);
}

for (const gridId of ['equipmentGrid', 'hazardGrid']) {
  const grid = $(gridId);
  grid.addEventListener('dragstart', e => {
    const it = e.target.closest('[data-item]');
    if (it) { cancelPlacing(); e.dataTransfer.setData('application/x-socmap-item', it.dataset.item); e.dataTransfer.effectAllowed = 'copy'; }
  });
  grid.addEventListener('click', e => {
    const del = e.target.closest('[data-del-custom]');
    if (del) {
      if (PLACE && PLACE.item.type === del.dataset.delCustom) cancelPlacing();
      S.customItems = S.customItems.filter(c => c.type !== del.dataset.delCustom);
      buildItemGrids(); changed({ risk: false }); return;
    }
    const it = e.target.closest('[data-item]');
    if (!it) return;
    startPlacing(JSON.parse(it.dataset.item), it);
  });
}
$('placeCancel').addEventListener('click', () => cancelPlacing());

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
    if (file.type.startsWith('image/') || isPdfFile(file) || /\.(dxf|dwg)$/i.test(file.name)) handleUpload(file);
    else if (file.name.endsWith('.json')) handleImport(file);
    else toast('이미지·PDF·DXF 도면 또는 .json 백업 파일만 열 수 있습니다.', 'warn');
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
    if (PLACE) { cancelPlacing(); return; }
    if (pickCallback) { pickCallback = null; S.shadow = null; S.dimLine = null; $('hintText').textContent = ''; toast('지점 선택을 취소했습니다.', 'info', { duration: 1500 }); }
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
    if (!VWORLD.key) loadVWorld(BACKEND_URL).then(syncVWorldUI);
    dot.className = 'dot online';
    txt.textContent = backendInfo.model_exists === false ? '서버 연결됨 (AI 모델 없음)' : '서버 연결됨';   // AI 모델은 처음 쓸 때 불러옴
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

// ── PDF 도면 → 이미지 (pdf.js 는 PDF 를 올릴 때만 불러온다, 인터넷 필요) ──
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const PDF_MAX_PX = 6000;   // 긴 변 최대 px (A1 도면 ≈ 180 dpi, A3 이하는 300 dpi)
const PAPER_SIZES = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] };
let _pdfjs = null;
const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
function loadPdfJs() {
  if (!_pdfjs) _pdfjs = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = PDFJS_BASE + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = () => { _pdfjs = null; fail(new Error('PDF 변환 라이브러리를 불러오지 못했습니다 (인터넷 연결 필요)')); };
    document.head.appendChild(s);
  });
  return _pdfjs;
}
/**
 * PDF 한 쪽을 이미지로. 용지 크기를 알면 도면 축척(1/N)으로 실제 m/px 를 계산한다
 * (CAD 에서 실제 용지 크기로 출력한 PDF 기준 — 「A3 축소본」이면 표기된 축소 축척을 넣어야 함)
 * @returns {{file, page, pages, dpi, paper, scaleDenom, mpp}} | null(취소)
 */
async function pdfToImage(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    let page = 1;
    if (doc.numPages > 1) {
      const v = prompt(`PDF에 ${doc.numPages}쪽이 있습니다. 배치도가 있는 쪽 번호를 입력하세요.`, '1');
      if (v === null) return null;
      page = Math.min(doc.numPages, Math.max(1, parseInt(v, 10) || 1));
    }
    const pg = await doc.getPage(page), v1 = pg.getViewport({ scale: 1 });   // 1 = 72 dpi (pt)
    const mmW = v1.width * 25.4 / 72, mmH = v1.height * 25.4 / 72, long = Math.max(mmW, mmH), short = Math.min(mmW, mmH);
    const paper = Object.keys(PAPER_SIZES).find(k => Math.abs(PAPER_SIZES[k][0] / long - 1) < 0.03 && Math.abs(PAPER_SIZES[k][1] / short - 1) < 0.03) || null;
    const sc = Math.min(PDF_MAX_PX / Math.max(v1.width, v1.height), 300 / 72), vp = pg.getViewport({ scale: sc });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    // v14.7 도면 글자 층에서 축척 표기 찾기 (CAD 출력 PDF) — 실제 용지 크기로 A1/A3 표기를 고름 (geo.js parseDrawingScale)
    let hit = null, textNote = '';
    try {
      const text = (await pg.getTextContent()).items.map(i => i.str).join(' ');
      hit = parseDrawingScale(text, paper);
      if (!hit) textNote = text.trim() ? '도면 글자에서 축척 표기를 찾지 못했습니다.' : 'PDF에 글자 층이 없습니다(스캔이거나 글자가 선으로 저장됨) — 축척을 직접 넣어 주세요.';
    } catch (e) { textNote = ''; }
    const found = hit ? `도면 글자에서 「${hit.snippet}」을 찾았습니다${hit.how === 'paper-converted' ? ` → 실제 용지(${paper})로 환산하면 1/${hit.denom}` : ''}.\n맞으면 그대로 확인, 아니면 고쳐 넣으세요.${hit.candidates.length > 1 ? `\n(다른 후보: ${hit.candidates.filter(d => d !== hit.denom).map(d => '1/' + d).join(', ')})` : ''}\n` : (textNote ? textNote + '\n' : '');
    const sv = prompt(`용지 ${Math.round(mmW)} × ${Math.round(mmH)} mm${paper ? ` (${paper})` : ''} · ${Math.round(sc * 72)} dpi로 변환했습니다.\n` + found
      + '도면 축척을 입력하면 정합 전에도 실제 크기로 놓습니다. 예: 1/600 이면 600\n(모르면 비워 두세요 — 기준점 정합으로 맞춰집니다)', hit ? String(hit.denom) : '');
    const scaleDenom = parseFloat(String(sv || '').replace(/^1\s*\/\s*/, '')) || null;
    const mpp = scaleDenom ? (25.4 / (72 * sc)) * scaleDenom / 1000 : null;   // 종이 위 1px(mm) × 축척 → 실제 m
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.92));
    return { file: new File([blob], `${(file.name || 'plan').replace(/\.pdf$/i, '')}_p${page}.jpg`, { type: 'image/jpeg' }),
      page, pages: doc.numPages, dpi: Math.round(sc * 72), paper, scaleDenom, mpp, scaleFromText: !!(hit && scaleDenom === hit.denom) };
  } finally { doc.destroy(); }
}

// ── v14.7 CAD 원본(DXF) 배치도 — 서버(backend/dxf_import.py, ezdxf)가 도형을 실제 단위(m)로 읽는다 ──
//  AI 추측 없이 정확한 외곽선 + 축척(1/N 계산 불필요). 좌표가 한국 TM 이면 기준점을 자동으로 만들어 위치까지 맞춤.
const isDxfFile = (f) => /\.dxf$/i.test(f.name || '');
const DXF_MAX_PX = 4000;
let DXF_LAST = null;   // { file, data } — 건물 레이어 다시 고르기

async function fetchDxf(file, layers) {
  const form = new FormData();
  form.append('file', file, file.name || 'plan.dxf');
  if (layers) form.append('layers', JSON.stringify(layers));
  const res = await fetch(BACKEND_URL + '/api/plan/dxf', { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

/** DXF 선 → 도면 그림(흰 바탕 · 북이 위). 도면 px = ((X − x0)/mpp, (y1 − Y)/mpp) */
function renderDxfImage(d) {
  const [x0, y0, x1, y1] = d.bbox, mpp = Math.max(0.01, Math.max(x1 - x0, y1 - y0) / DXF_MAX_PX);
  const W = Math.max(64, Math.ceil((x1 - x0) / mpp)), H = Math.max(64, Math.ceil((y1 - y0) / mpp));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1f2937'; g.lineWidth = Math.max(1, Math.max(W, H) / 2500); g.lineJoin = 'round';
  g.beginPath();
  for (const l of d.lines) {
    g.moveTo((l[0] - x0) / mpp, (y1 - l[1]) / mpp);
    for (let i = 2; i < l.length; i += 2) g.lineTo((l[i] - x0) / mpp, (y1 - l[i + 1]) / mpp);
  }
  g.stroke();
  return { url: c.toDataURL('image/png'), W, H, mpp, toPx: (X, Y) => ({ x: (X - x0) / mpp, y: (y1 - Y) / mpp }) };
}

/** DXF 좌표가 한국 TM 이면: 현장 위치로 원점(서부·중부·동부·동해)을 고르고 기준점 4 + 검증점 1 을 만들어 정합 */
function dxfGeoreference(d, R) {
  const [x0, y0, x1, y1] = d.bbox, o = S.project.origin;
  const tries = [];
  for (const code of d.tm.codes) for (const swap of [false, true]) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ll = swap ? tmInverse(cy, cx, code) : tmInverse(cx, cy, code);
    if (!isFinite(ll.lat) || ll.lat < 32 || ll.lat > 39.5 || ll.lon < 123 || ll.lon > 132.5) continue;
    tries.push({ code, swap, ll, dist: o ? vincentyDistance(o.lat, o.lon, ll.lat, ll.lon) : (code === 5186 || code === 5179) && !swap ? 0 : 1e9 });
  }
  if (!tries.length) return '';
  tries.sort((a, b) => a.dist - b.dist);
  const t = tries[0];
  if (o && t.dist > 20000) return `\n⚠️ 도면 좌표가 TM 범위지만 현장에서 ${(t.dist / 1000).toFixed(0)} km 떨어져 자동 정합하지 않았습니다 (원점 확인).`;
  let note = '';
  if (!o) {   // 현장 위치가 없으면 도면 중심으로 지정 (원점은 중부원점으로 가정 — 다르면 기준점을 고치세요)
    S.project.origin = { lat: +t.ll.lat.toFixed(7), lon: +t.ll.lon.toFixed(7) };
    note = ' · 현장 위치를 도면 중심으로 지정(중부원점 가정)';
    updateAttribution();
  }
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
  S.plan.refs = pts.map(([X, Y], i) => {
    const ll = t.swap ? tmInverse(Y, X, t.code) : tmInverse(X, Y, t.code);
    return { id: newId('g'), px: R.toPx(X, Y), lat: ll.lat, lon: ll.lon, tm: { code: t.code, x: t.swap ? X : Y, y: t.swap ? Y : X }, check: i === 4 || undefined, src: 'dxf' };
  });
  applyAlignment();
  return `\n📍 도면 좌표 = ${KOREA_CRS[t.code].label}${t.swap ? ' (X·Y 바꿔 읽음)' : ''} → 실제 위치에 자동으로 맞췄습니다${note}.`;
}

async function importDxf(file, layers = null) {
  if (!S.backendOnline) await checkBackend();
  if (!S.backendOnline) { toast('DXF 도면은 서버(노트북 실행 파일)가 켜져 있어야 읽을 수 있습니다.', 'error'); return; }
  setLoading('CAD 도면(DXF)을 읽는 중…');
  let d;
  try { d = await fetchDxf(file, layers); } catch (e) { toast('DXF를 읽을 수 없습니다: ' + e.message, 'error'); return; } finally { setLoading(null); }
  DXF_LAST = { file, data: d };
  const R = renderDxfImage(d), img = await loadImage(R.url);
  S.contours = []; S.nodes = []; S.buildingData = {}; S.route = null; S.selection = null;
  setBackground(img, R.url, { newPlan: true });
  S.plan.alignError = null; S.plan.dimCheck = undefined; S.plan.capturedAt = undefined; S.plan.imageType = 'floorplan';
  S.plan.transform = defaultPlanTransform(R.W, R.H, R.mpp); invalidateExtent();
  S.plan.knownMpp = R.mpp; S.plan.knownMppSrc = `DXF 실제 단위 (${d.units}${d.units_assumed ? ' — 단위 없음이라 mm 가정' : ''})`;
  S.plan.source = { kind: 'dxf', units: d.units, unitsAssumed: d.units_assumed || undefined, layers: d.chosen_layers };
  const T = planTransform();
  S.contours = d.buildings.map(b => toContour(b.pts.flatMap(([X, Y]) => { const q = T.apply(R.toPx(X, Y)); return [q.x, q.y]; })));
  d.buildings.forEach((b, i) => { if (b.name) S.buildingData[i] = { name: b.name }; });
  S.bgFileName = file.name;
  const geo = d.tm ? dxfGeoreference(d, R) : '';
  History.init(); changed(); fitView(); renderModeUI(); renderInspector(); updateEmptyState(); syncSunUI(); renderDxfInfo();
  const named = d.buildings.filter(b => b.name).length;
  toast(`CAD 도면을 실제 크기로 불러왔습니다 — 건물 ${d.buildings.length}동${named ? ` (이름 ${named})` : ''} · 단위 ${d.units}${d.units_assumed ? '(가정)' : ''}\n`
    + (d.chosen_layers.length ? `건물 레이어: ${d.chosen_layers.join(', ')}${d.choose_how === 'shape' ? ' (이름이 아니라 모양으로 고름 — 확인하세요)' : ''}` : '건물 레이어를 찾지 못했습니다 — 「도면」 1단계에서 레이어를 골라 주세요.')
    + geo, d.buildings.length ? 'success' : 'warn', { duration: 10000 });
}

/** 도면 1단계의 DXF 레이어 고르기 (건물 레이어를 바꾸면 서버가 다시 고름) */
function renderDxfInfo() {
  const box = $('dxfInfo'), d = DXF_LAST && S.plan.source && S.plan.source.kind === 'dxf' ? DXF_LAST.data : null;
  box.hidden = !d;
  if (!d) return;
  const ls = d.layers.filter(l => l.candidates).slice(0, 12);
  box.innerHTML = `📐 <b>CAD 도면(DXF)</b> · 단위 ${esc(d.units)}${d.units_assumed ? ' (가정)' : ''} · 건물 ${d.buildings.length}동<br>건물 레이어:` +
    ls.map(l => `<label class="row label-sm" style="cursor:pointer"><span>${esc(l.name)} <small>닫힌 도형 ${l.candidates}${l.neg ? ' · 건물 아닌 이름' : ''}</small></span><input type="checkbox" data-dxf-layer="${esc(l.name)}" ${d.chosen_layers.includes(l.name) ? 'checked' : ''}></label>`).join('')
    + (ls.length ? '' : ' 닫힌 도형이 있는 레이어가 없습니다.');
}
$('dxfInfo').addEventListener('change', e => {
  if (!e.target.matches('[data-dxf-layer]') || !DXF_LAST) return;
  const layers = [...document.querySelectorAll('[data-dxf-layer]:checked')].map(x => x.dataset.dxfLayer);
  importDxf(DXF_LAST.file, layers);
});

async function handleUpload(file) {
  if (/\.dwg$/i.test(file.name || '')) { toast('DWG 는 바로 읽을 수 없습니다. CAD 에서 「다른 이름으로 저장 → DXF」로 저장하거나 무료 ODA File Converter 로 DXF 로 바꿔 올려 주세요.', 'warn', { duration: 9000 }); return; }
  if (isDxfFile(file)) return importDxf(file);
  if (DXF_LAST) { DXF_LAST = null; renderDxfInfo(); }
  let pdf = null;
  if (isPdfFile(file)) {
    setLoading('PDF 도면을 이미지로 바꾸는 중…');
    try { pdf = await pdfToImage(file); } catch (e) { toast('PDF를 열 수 없습니다: ' + e.message, 'error'); return; } finally { setLoading(null); }
    if (!pdf) return;
    file = pdf.file;
  }
  if (!file.type.startsWith('image/')) { toast('이미지 또는 PDF 파일만 업로드할 수 있습니다.', 'error'); return; }
  let img, src;
  try { src = await readAsDataURL(file); img = await loadImage(src); } catch (e) { toast('이미지 파일을 읽을 수 없습니다.', 'error'); return; }

  // 새 도면이므로 이전 도면에 종속된 건물 정보와 경로는 초기화
  S.contours = []; S.nodes = []; S.buildingData = {}; S.route = null; S.selection = null;
  setBackground(img, src, { newPlan: true });
  S.plan.alignError = null; S.plan.dimCheck = undefined; S.plan.knownMpp = undefined; S.plan.knownMppSrc = undefined;
  if (pdf && pdf.mpp) {   // 도면 축척을 알면 정합 전에도 실제 크기, 정합할 때는 축척 고정(자동)
    S.plan.transform = defaultPlanTransform(S.plan.width, S.plan.height, pdf.mpp); invalidateExtent(); fitView();
    S.plan.knownMpp = pdf.mpp; S.plan.knownMppSrc = `PDF 축척 1/${pdf.scaleDenom}${pdf.scaleFromText ? ' (도면 글자에서 읽음)' : ''}`;
  }
  S.plan.source = pdf ? { kind: 'pdf', page: pdf.page, pages: pdf.pages, dpi: pdf.dpi, paper: pdf.paper || undefined, scaleDenom: pdf.scaleDenom || undefined } : undefined;
  // 이미지 종류(배치도/항공 사진)와 촬영 시각(EXIF) — 3D 지붕 사진·그림자 높이 추정에 쓴다
  S.plan.imageType = document.querySelector('input[name="imageType"]:checked').value;
  try { const d = pdf ? null : readExifDate(await file.arrayBuffer()); S.plan.capturedAt = d && !isNaN(d) ? d.toISOString() : undefined; } catch (e) { S.plan.capturedAt = undefined; }
  syncSunUI();
  const scaleTxt = pdf && pdf.mpp ? `도면 축척 1/${pdf.scaleDenom} → 1px = ${pdf.mpp.toFixed(4)}m` : '1px = 0.1m 가정';
  toast(S.project.origin
    ? `도면을 현장 위치에 임시로 놓았습니다 (${scaleTxt}).\n「📍 도면 정합」에서 기준점 3~4개를 지정하면 실제 위치·방향·축척에 맞춰집니다.`
    : `도면을 불러왔습니다 (${scaleTxt}). 프로젝트 위치를 지정한 뒤 「📍 도면 정합」으로 실제 위치에 맞추세요.`, 'info', { duration: 8000 });
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
    siteBoundary: flat([[30, 30], [1570, 30], [1570, 990], [30, 990]]),   // 공사 현장 경계 = 걸어 다닐 수 있는 구역
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
  buildModeGrid(); buildItemGrids(); renderModeUI(); renderEnvControls(); syncLayerUI(); syncVWorldUI();
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
  // 휴대폰으로 PC 화면을 열면 관리감독자 앱을 권한다 (서버에서 열었을 때만)
  let hideBanner = false;
  try { hideBanner = localStorage.getItem('socmap.v14.phoneBanner') === '0'; } catch (e) { /* noop */ }
  if (window.innerWidth < 640 && /^https?:$/.test(location.protocol) && !hideBanner) $('phoneBanner').hidden = false;
  $('phoneBannerX').onclick = () => { $('phoneBanner').hidden = true; try { localStorage.setItem('socmap.v14.phoneBanner', '0'); } catch (e) { /* noop */ } };
  checkBackend();
  setInterval(checkBackend, 15000);
}
init();
