/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 사이드바 · 인스펙터 · 경로 카드 · 토스트 · 모달
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtLen = (m) => (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m, m < 10 ? 1 : 0)} m`);   // 모든 좌표가 m 단위

const MODES = [
  { id: 'select',   group: 'draw',  icon: '🖐️', label: '선택 · 이동', short: '선택', key: '1', desc: '항목 선택, 끌어서 이동', hint: '장비·위험물·건물을 클릭해 선택하고 끌어서 옮깁니다. 빈 곳을 드래그하면 지도가 이동합니다.' },
  { id: 'building', group: 'draw',  icon: '🏢', label: '건물',        key: '6', desc: '외곽을 그려 건물 지정', hint: '드래그로 건물 외곽을 그립니다. AI 인식 없이 건물을 지정할 때 씁니다.' },
  { id: 'road',     group: 'draw',  icon: '〰️', label: '도로',        short: '도로', key: '2', desc: '이동 가능한 길', status: true, hint: '드래그해 이동 가능한 도로(우회로)를 그립니다. 보행 구역이 없으면 경로는 도로 위로만 찾습니다.' },
  { id: 'lasso',    group: 'draw',  icon: '🚶', label: '보행 구역',   short: '보행', key: '3', desc: '걸을 수 있는 범위', status: true, hint: '드래그로 보행 가능 구역의 외곽을 그립니다. 경로는 이 안에서만 찾습니다.' },
  { id: 'fence',    group: 'draw',  icon: '🚧', label: '울타리',      short: '울타리', key: '4', desc: '통행 차단선', status: true, hint: '드래그해 통행할 수 없는 안전 울타리를 설치합니다.' },
  { id: 'zone',     group: 'draw',  icon: '🌧️', label: '환경 구역',  key: '7', desc: '연약지반·고압선·침수', hint: '구역 종류를 고른 뒤 드래그로 영역을 그립니다.' },
  { id: 'route',    group: 'route', icon: '🧭', label: '안전 경로 탐색', short: '경로 탐색', key: '5', hint: '출발지 → 도착지를 차례로 클릭하세요. 핀을 끌면 위치를 바꿔 다시 찾습니다.' },
  { id: 'align',    group: 'plan',  icon: '📍', label: '도면 정합',  key: '9', hint: '도면 위 지점을 클릭하고 실제 위치(현장 측량점·좌표·위성 지도)를 지정하세요. 2~3점이면 위치·축척·방향이 맞춰집니다.' },
  { id: 'measure',  group: 'map',   icon: '📏', label: '거리 측정',  key: '0', hint: '클릭해 점을 이으면 거리를, 첫 점을 다시 누르면 면적을 잽니다. Esc: 초기화' },
  { id: '3d',       group: 'map',   icon: '🧊', label: '3D 보기',    key: '8', hint: '드래그 회전 · 우클릭 드래그 이동 · 휠 확대/축소', cls: 'mode-3d' },
];

/** 도구가 속한 작업 화면 */
const MODE_WS = { building: 'layout', road: 'layout', lasso: 'layout', fence: 'layout', zone: 'layout', route: 'route', align: 'plan' };
const WORKSPACES = ['layout', 'route', 'monitor', 'plan', 'site'];

function setWorkspace(ws, { fromMode = false, toggle = false } = {}) {
  const app = $('app');
  if (toggle && S.ws === ws && !app.classList.contains('collapsed')) { app.classList.add('collapsed'); resizeCanvas(); return; }
  S.ws = ws;
  try { localStorage.setItem('socmap.v13.ws', ws); } catch (e) { /* noop */ }
  app.classList.remove('collapsed');
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.ws === ws));
  document.querySelectorAll('.ws').forEach(sec => { sec.hidden = sec.dataset.ws !== ws; });
  if (!fromMode) {
    // 화면에 맞는 도구로 전환 (경로 화면 = 경로 탐색 모드)
    if (ws === 'route' && S.mode !== 'route') setMode('route');
    else if (ws !== 'route' && S.mode === 'route') setMode('select');
    else if (ws !== 'plan' && S.mode === 'align') setMode('select');
    else if (ws !== 'layout' && MODE_WS[S.mode] === 'layout') setMode('select');
  }
  renderModeUI();
  resizeCanvas();   // 패널이 열리고 닫히면 지도 크기가 바뀐다 (화면 중심 유지)
}

const HAZARD_ITEMS = [
  { type: 'barricade',    icon: '🚧', label: '통제구역',    defaultRadius: 3, riskLevel: 5 },
  { type: 'high_voltage', icon: '⚡', label: '고전압/전기', defaultRadius: 2, riskLevel: 5 },
  { type: 'hole',         icon: '🕳️', label: '개구부/낙하', defaultRadius: 2.5, riskLevel: 4 },
  { type: 'warning',      icon: '⚠️', label: '일반 위험',   defaultRadius: 3, riskLevel: 2 },
];

// ── 토스트 ──
function toast(msg, type = 'info', opts = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (opts.action) {
    const b = document.createElement('button');
    b.className = 'btn btn-xs'; b.textContent = opts.action.label;
    b.onclick = () => { el.remove(); opts.action.fn(); };
    el.appendChild(b);
  }
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), opts.duration || (type === 'error' ? 7000 : 4000));
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) m.hidden = true; });
});

function setLoading(text) {
  $('loading').hidden = !text;
  if (text) $('loadingText').textContent = text;
}

// ═══════════════════════════════════════════════
//  사이드바
// ═══════════════════════════════════════════════

function buildModeGrid() {
  $('modeGrid').innerHTML = MODES.filter(m => m.group === 'draw').map(m =>
    `<button class="tool tool-${m.id}" data-mode="${m.id}" title="${esc(m.hint)}">
       <span class="ti">${m.icon}</span>
       <span class="tt"><b>${m.label}</b><small>${m.desc}</small></span>
       ${m.status ? `<span class="chip" data-status="${m.id}"></span>` : ''}
       <kbd>${m.key}</kbd></button>`).join('');
  // 지도 하단 빠른 도구: 선택 + 동선 도구 + 경로 탐색
  const dockModes = ['select', 'road', 'lasso', 'fence'].map(id => MODES.find(m => m.id === id));
  $('dock').innerHTML = dockModes.map(m =>
    `<button class="dock-btn" data-mode="${m.id}" title="${esc(m.label)} (${m.key})"><span class="ico">${m.icon}</span><span class="lbl">${m.short}</span></button>`).join('')
    + '<span class="dock-sep"></span><button class="dock-route" data-mode="route" title="안전 경로 탐색 (5)"><span class="ico">🧭</span><span class="lbl">경로 탐색</span></button>';
}

/** 도구 버튼의 상태 표시(개수, 지정 여부, 경로 결과) */
function renderToolStatus() {
  const chip = (id, text, on) => document.querySelectorAll(`[data-status="${id}"]`).forEach(el => { el.textContent = text; el.classList.toggle('on', on); });
  chip('road', S.polylines.length ? `${S.polylines.length}개` : '없음', S.polylines.length > 0);
  chip('lasso', S.walkableAreaPolygon.length >= 6 ? '지정됨' : '전체', S.walkableAreaPolygon.length >= 6);
  chip('fence', S.fences.length ? `${S.fences.length}개` : '없음', S.fences.length > 0);
  const R = S.route, sub = $('routeMainSub');
  if (R && R.result) {
    const g = riskGrade(R.result.metrics.maxRisk);
    sub.innerHTML = `최근 결과 <b>${fmtLen(R.result.metrics.length)}</b> · <span style="color:${g.color === '#10b981' ? '#a7f3d0' : g.color}">${g.label}</span>`;
  } else if (R && R.points.length === 1) sub.textContent = '② 도착지를 클릭하세요';
  else sub.textContent = S.mode === 'route' ? '① 출발지를 클릭하세요' : '출발지 → 도착지를 클릭';

  const guide = $('routeGuide');
  if (S.mode === 'route' && (!R || R.points.length < 2 || !R.result)) {
    const step = R && R.points.length === 1 ? 2 : 1;
    guide.innerHTML = `<span class="step ${step === 1 ? 'now' : 'done'}">① 출발지 클릭</span><span class="arrow">→</span><span class="step ${step === 2 ? 'now' : ''}">② 도착지 클릭</span>`;
    guide.hidden = false;
  } else guide.hidden = true;
}

function renderModeUI() {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === S.mode));
  renderToolStatus();
  const slotWs = MODE_WS[S.mode] || S.ws || 'layout';
  const slot = document.querySelector(`.mode-slot[data-slot="${slotWs}"]`) || document.querySelector('.mode-slot[data-slot="layout"]');
  if ($('modeOptions').parentElement !== slot) slot.appendChild($('modeOptions'));
  const mode = MODES.find(m => m.id === S.mode);
  $('hintText').textContent = mode ? mode.hint : '';
  const box = $('modeOptions');
  let h = '';
  const st = S.settings;
  switch (S.mode) {
    case 'select':
      h = S.ws === 'layout' ? `<div class="kpis"><div><b>${S.contours.length}</b><span>건물</span></div><div><b>${S.markers.filter(m => m.isEquipment).length}</b><span>장비</span></div><div><b>${S.markers.filter(m => !m.isEquipment).length}</b><span>위험물</span></div><div><b>${S.siteEnvironment.envZones.length}</b><span>환경 구역</span></div></div>` : '';
      break;
    case 'building':
      h = `<div class="hint">${mode.hint}</div>
           <div class="row"><span class="label-sm">건물 ${S.contours.length}개</span>${S.contours.length ? '<button class="btn btn-xs" data-act="clearBuildings">모두 지우기</button>' : ''}</div>`;
      break;
    case 'road':
    case 'fence': {
      const isRoad = S.mode === 'road', key = isRoad ? 'roadWidth' : 'fenceWidth', list = isRoad ? S.polylines : S.fences;
      const range = isRoad ? 'min="1" max="12" step="0.5"' : 'min="0.1" max="2" step="0.1"';
      h = `<div class="row label-sm"><span>${isRoad ? '도로 폭' : '울타리 두께'}</span><span class="value" id="thickLabel">${st[key]} m</span></div>
           <input type="range" ${range} value="${st[key]}" data-setting="${key}">
           ${isRoad ? '' : '<div class="hint warn">⚠️ 울타리 구간은 경로 탐색 시 통과할 수 없습니다.</div>'}
           <div class="row"><span class="label-sm">${list.length}개 그려짐</span>${list.length ? `<button class="btn btn-xs" data-act="${isRoad ? 'clearRoads' : 'clearFences'}">모두 지우기</button>` : ''}</div>`;
      break;
    }
    case 'lasso':
      h = `<div class="hint">${mode.hint}</div>
           <div class="row"><span class="label-sm">${S.walkableAreaPolygon.length >= 6 ? '✅ 보행 구역 지정됨' : '지정된 구역 없음 (도면 전체가 이동 가능)'}</span>
           ${S.walkableAreaPolygon.length >= 6 ? '<button class="btn btn-xs" data-act="clearLasso">해제</button>' : ''}</div>`;
      break;
    case 'zone':
      h = `<div class="zone-picker">${Object.entries(ENV_ZONE_TYPES).map(([k, z]) =>
        `<button class="zone-opt ${S.envZoneType === k ? 'active' : ''}" data-zone="${k}" style="--zc:${z.color}">${z.icon} ${z.label.split(' ')[0]}<small>보행 ${z.pedestrian}점${k === 'floodedArea' || k === 'powerLine' ? ' · 장비 통제' : ''}</small></button>`).join('')}</div>`;
      break;
    case 'route': {
      const method = S.walkableAreaPolygon.length >= 6 ? '보행 구역 안에서' : (S.polylines.length ? '그려진 도로 위로' : '현장 전체에서 (건물·울타리 회피)');
      h = `<div class="field-row"><span>탐색 범위</span><b>${method}</b></div>
           <div class="hint">보행 구역·도로는 「배치」 화면의 동선 도구로 지정합니다.</div>`;
      break;
    }
    case 'align':
      h = alignModeOptions();
      break;
    case 'measure':
      h = `<div class="hint">${mode.hint}</div>${S.measure && S.measure.points.length >= 4 ? `<div class="alert info">${measureSummary()}</div><button class="btn btn-xs" data-act="clearMeasure">측정 초기화</button>` : ''}`;
      break;
    case '3d':
      h = View3D.available() ? `<div class="hint">${mode.hint}</div>` : '<div class="alert warn">3D 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.</div>';
      break;
  }
  box.innerHTML = h;
  box.hidden = !h;
}

function buildItemGrids() {
  $('equipmentGrid').innerHTML = Object.entries(EQUIPMENT_TYPES).map(([k, v]) =>
    `<div class="drag-item eq" draggable="true" data-item='${esc(JSON.stringify({ type: k, isEquipment: true }))}' title="끌어서 배치 또는 클릭">
       <span class="ico">${v.icon}</span><span class="lbl">${v.label}</span><span class="sub" title="사고 빈도 가중치 — 설계값 (통계 산출값 아님)">W ×${new v.cls({ x: 0, y: 0 }, {}).w_freq}</span></div>`).join('');
  const items = [...HAZARD_ITEMS, ...S.customItems];
  $('hazardGrid').innerHTML = items.map(it =>
    `<div class="drag-item" draggable="true" data-item='${esc(JSON.stringify(it))}' title="끌어서 배치 또는 클릭">
       ${it.type.startsWith('custom-') ? `<button class="icon-btn del" data-del-custom="${esc(it.type)}" title="삭제">✕</button>` : ''}
       <span class="ico">${esc(it.icon || '⚠️')}</span><span class="lbl">${esc(it.label)}</span><span class="sub">등급 ${it.riskLevel}</span></div>`).join('');
}

function renderEnvZoneList() {
  const zones = S.siteEnvironment.envZones;
  $('envZoneListWrap').hidden = !zones.length;
  $('envZoneList').innerHTML = zones.map(z => {
    const info = ENV_ZONE_TYPES[z.type] || { label: z.type, icon: '⚠️', color: '#fff' };
    const kv = z.type === 'powerLine'
      ? `<label class="label-sm" title="장비 이격거리 ${powerLineClearance(z.kV)} m (안전보건규칙 제322조)"><input type="number" class="input input-num" min="1" max="765" step="0.1" value="${+z.kV > 0 ? +z.kV : DEFAULT_POWERLINE_KV}" data-zone-kv="${esc(z.id)}"> kV · 이격 ${powerLineClearance(z.kV)} m</label>` : '';
    return `<div class="list-item" style="--c:${info.color}"><span>${info.icon} ${info.label}</span>${kv}<button class="icon-btn" data-del-zone="${esc(z.id)}" title="삭제">✕</button></div>`;
  }).join('');
}

function renderEnvControls() {
  const w = S.siteEnvironment.windSpeed;
  // 현장에 놓인 장비 중 이 풍속에서 작업 중지 대상 수 (장비별 허용 풍속 반영)
  const stopped = S.markers.filter(m => m.isEquipment).map(m => createEquipment(m, S.siteEnvironment))
    .filter(eq => eq && eq.windLimit() != null && w > eq.windLimit()).length;
  $('windSlider').value = w;
  $('windLabel').textContent = `순간 ${w} m/s${stopped ? ` ⛔ 장비 ${stopped}대 중지` : w > 10 ? ' ⚠️ 양중 주의' : ''}`;
  $('windLabel').style.color = stopped ? 'var(--danger)' : w > 10 ? 'var(--warn)' : '';
  $('safetySlider').value = S.settings.safetyLevel;
  $('safetyLabel').textContent = S.settings.safetyLevel;
  $('basemapSelect').value = S.layers.basemap;
  $('planOpacity').value = S.plan.opacity ?? 0.85;
  if (typeof syncQuickLayers === 'function') syncQuickLayers();
  $('bldgHeightSlider').value = S.settings.buildingHeight;
  $('bldgHeightLabel').textContent = S.settings.buildingHeight;
  $('showUnderground').checked = S.settings.showUnderground;
}

// ═══════════════════════════════════════════════
//  인스펙터 (선택 항목 편집)
// ═══════════════════════════════════════════════

function selectedMarker() {
  const sel = S.selection;
  return sel && sel.kind === 'marker' ? S.markers.find(m => m.id === sel.id) : null;
}

function renderInspector() {
  const el = $('inspector');
  const sel = S.selection;
  if (!sel || S.mode === '3d') { el.hidden = true; return; }
  if (sel.kind === 'marker') {
    const m = selectedMarker();
    if (!m) { S.selection = null; el.hidden = true; return; }
    el.innerHTML = m.isEquipment ? equipmentInspector(m) : hazardInspector(m);
  } else if (sel.kind === 'building') {
    if (sel.idx >= S.contours.length) { S.selection = null; el.hidden = true; return; }
    el.innerHTML = buildingInspector(sel.idx);
  }
  el.hidden = false;
}

function inspectorHeader(title) {
  return `<div class="row" style="margin-bottom:10px"><h3>${title}</h3><button class="btn btn-ghost btn-xs" data-act="deselect" title="닫기 (Esc)">✕</button></div>`;
}

function equipmentInspector(m) {
  const eq = createEquipment(m, S.siteEnvironment);
  const hd = Math.round(rad2deg(normalizeAngle(m.heading || 0)));
  let h = inspectorHeader(`${m.icon} ${esc(m.label)}`);
  h += `<div class="field"><div class="row"><span>🧭 방향 (heading)</span><span class="value" id="insHeading">${hd}°</span></div>
        <input type="range" min="0" max="355" step="5" value="${hd}" data-eq="heading"></div>`;
  h += '<h4>장비 제원</h4>';
  for (const [k, v] of Object.entries(m.equipmentParams || {})) {
    const info = PARAM_LABELS[k] || { label: k, unit: '', min: 0, max: 200 };
    const max = k === 'd_trolley' ? (m.equipmentParams.L_jib ?? info.max)
      : k === 'v_wind' && m.type === 'towerCrane' ? WIND_LIMITS.towerCrane : info.max;   // 법정 상한

    h += `<div class="field"><div class="row"><span>${info.label}</span><span class="value" data-param-label="${k}">${v} ${info.unit}</span></div>
          <input type="range" min="${info.min}" max="${max}" step="${info.step || 1}" value="${Math.min(v, max)}" data-param="${k}"></div>`;
  }
  if (m.type === 'towerCrane') {
    h += `<div class="row field"><span>🔧 설치·해체·점검 중 <span class="label-sm">(순간풍속 ${TOWER_ERECTION_WIND} m/s 초과 중지)</span></span>
          <label class="switch"><input type="checkbox" data-eqflag="erecting" ${m.erecting ? 'checked' : ''}><span class="sl"></span></label></div>`;
  }
  const mits = Object.entries(MITIGATIONS).filter(([, info]) => info.appliesTo.includes(m.type));
  if (mits.length) {
    h += '<h4>통제 완화 (H_mitigation)</h4>';
    for (const [k, info] of mits) {
      h += `<div class="row field"><span>${info.icon} ${info.label} <span class="label-sm">(−${info.value}${info.required ? ' · 법정 의무' : ''})</span></span>
            <label class="switch"><input type="checkbox" data-mit="${k}" ${m.mitigation && m.mitigation[k] ? 'checked' : ''}><span class="sl"></span></label></div>`;
    }
  }
  h += `<h4>위험도 산출</h4><div id="insFormula">${equipmentFormula(eq)}</div>`;
  h += `<div class="row-gap" style="margin-top:14px"><button class="btn flex1" data-act="duplicate">복제 <kbd>Ctrl+D</kbd></button><button class="btn btn-danger flex1" data-act="deleteSel">삭제 <kbd>Del</kbd></button></div>`;
  return h;
}

function equipmentFormula(eq) {
  if (!eq) return '';
  const fc = eq.fullControlReason();
  const wf = eq.w_freq, sp = eq.sPenalty, hm = eq.hMitigation;
  const zoneFlags = Object.keys(eq.flags).map(k => ENV_ZONE_TYPES[k] ? ENV_ZONE_TYPES[k].icon + ENV_ZONE_TYPES[k].label : k).join(', ');
  const chip = (v) => { const g = riskGrade(v); return `<span class="badge" style="background:${g.color}22;color:${g.color}">${fmt(v, 1)}</span>`; };
  const missing = Object.entries(MITIGATIONS).filter(([k, info]) => info.required && info.appliesTo.includes(eq.equipmentType) && !eq.mitigation[k]);
  return `${fc ? `<div class="alert danger" style="margin-bottom:8px">⛔ <b>전면 통제</b> — ${esc(fc)}<br>영향 반경(${fmt(eq.getMaxRadius())} m) 전체가 100점</div>` : ''}
  ${missing.map(([, info]) => `<div class="alert warn" style="margin-bottom:8px">⚠️ ${info.icon} ${info.label} 미설치 — ${info.required}</div>`).join('')}
  <div class="formula">
    <div class="row" title="설계값: 사망자 수 순위를 참고해 정한 값이며 통계로 산출한 값이 아닙니다"><span>📊 W_freq (사고 빈도 가중치 · 설계값)</span><b style="color:#a78bfa">×${wf}</b></div>
    <div class="row"><span>🌍 S_penalty (장비 위치 지반)</span><b style="color:${sp ? 'var(--warn)' : 'var(--ok)'}">+${sp}</b></div>
    ${zoneFlags ? `<div class="label-sm" style="margin-top:-2px">↳ ${esc(zoneFlags)}</div>` : ''}
    <div class="row"><span>🛡️ H_mitigation (통제 완화)</span><b style="color:${hm ? 'var(--ok)' : 'var(--muted)'}">−${hm}</b></div>
    <div class="row total"><span>🔴 Red Zone</span>${chip(fc ? 100 : 100)}</div>
    <div class="row"><span>🟠 Orange Zone</span>${chip(fc ? 100 : eq.orangeRisk())}</div>
    <div class="row"><span>⚪ 영향권 기타</span>${chip(fc ? 100 : eq.normalRisk())}</div>
    <code>Orange = clamp((${eq.orangeBase} + S) × W − H) = clamp((${eq.orangeBase} + ${sp}) × ${wf} − ${hm})</code>
  </div>`;
}

function hazardInspector(m) {
  let h = inspectorHeader(`${esc(m.icon || '⚠️')} ${esc(m.label)}`);
  h += `<div class="field"><div class="row"><span>위험 반경</span><span class="value" id="insRadius">${m.radius} m</span></div>
        <input type="range" min="0.5" max="30" step="0.5" value="${m.radius}" data-hz="radius"></div>
        <div class="field"><div class="row"><span>위험 등급</span><span class="value" id="insLevel">${m.riskLevel || 3} → R=${(m.riskLevel || 3) * 20}</span></div>
        <input type="range" min="1" max="5" value="${m.riskLevel || 3}" data-hz="riskLevel"></div>
        <div class="row-gap" style="margin-top:14px"><button class="btn flex1" data-act="duplicate">복제</button><button class="btn btn-danger flex1" data-act="deleteSel">삭제</button></div>`;
  return h;
}

function buildingInspector(idx) {
  const bd = S.buildingData[idx] || {};
  let h = inspectorHeader(`🏢 ${esc(bd.name || `건물 #${idx + 1}`)}`);
  h += `<div class="field"><div class="label-sm" style="margin-bottom:4px">건물 이름 (동 번호)</div><input type="text" class="input" maxlength="20" placeholder="예: 101동" value="${esc(bd.name || '')}" data-bd="name"></div>
        <div class="field row"><span>층수 <span class="label-sm">(3D 높이, 비우면 기본값)</span></span><input type="number" class="input input-num" min="1" max="80" value="${bd.floors || ''}" data-bd="floors"></div>
        <div class="card" style="border-color:rgba(239,68,68,.35)"><div class="row"><div><b>🚫 현관 출입 불가</b><div class="label-sm">타일 작업 등으로 현관이 막힘</div></div>
        <label class="switch danger"><input type="checkbox" data-bd="entranceBlocked" ${bd.entranceBlocked ? 'checked' : ''}><span class="sl"></span></label></div></div>
        ${bd.entranceBlocked ? '<div class="alert info" style="margin-top:8px">이 건물을 도착지로 지정하면 가장 가까운 다른 건물로 진입해 <b>지하 B1</b>을 거쳐 도착하도록 안내합니다.</div>' : ''}
        <button class="btn btn-danger" style="width:100%;margin-top:14px" data-act="deleteBuilding">건물 삭제</button>`;
  return h;
}

/** 슬라이더 조작 중에는 인스펙터 전체를 다시 그리지 않고 수치만 갱신 */
function refreshEquipmentFormula() {
  const m = selectedMarker();
  const f = $('insFormula');
  if (m && m.isEquipment && f) f.innerHTML = equipmentFormula(createEquipment(m, S.siteEnvironment));
}

// ═══════════════════════════════════════════════
//  경로 결과 카드
// ═══════════════════════════════════════════════

function renderRouteCard() {
  renderToolStatus();
  const el = $('routeCard'), R = S.route;
  el.hidden = false;
  if (!R || !R.result) {
    el.innerHTML = R && R.points.length === 1 ? '<div class="empty-mini">도착지를 클릭하세요.</div>'
      : R && R.points.length === 2 ? '<div class="empty-mini">경로를 찾지 못했습니다. 출발·도착 위치나 울타리를 확인하세요.</div>'
      : '<div class="empty-mini">🧭 지도에서 <b>출발지</b>와 <b>도착지</b>를 차례로 클릭하면<br>위험을 피하는 경로와 지표가 여기에 표시됩니다.</div>';
    return;
  }
  const r = R.result, m = r.metrics, g = riskGrade(m.maxRisk);
  const pct = (v) => m.length > 0 ? (v / m.length * 100) : 0;
  let cmp = '';
  if (r.shortestMetrics && r.shortestMetrics.length > 0) {
    const sm = r.shortestMetrics;
    const dLen = (m.length / sm.length - 1) * 100;
    const dExp = sm.exposure > 0.01 ? (1 - m.exposure / sm.exposure) * 100 : 0;
    cmp = `<div class="label-sm" style="margin-top:10px">최단 경로 대비: 거리 <b style="color:var(--text)">${dLen >= 0 ? '+' : ''}${fmt(dLen, 1)}%</b>
           ${sm.exposure > 0.01 ? ` · 위험 노출 <b style="color:${dExp > 0 ? 'var(--ok)' : 'var(--text)'}">${dExp > 0 ? '−' : ''}${fmt(Math.abs(dExp), 0)}%</b>` : ''}
           ${sm.maxRisk > m.maxRisk ? ` · 최대 위험 ${fmt(sm.maxRisk)} → ${fmt(m.maxRisk)}` : ''}</div>`;
  }
  let redirect = '';
  if (R.redirect) {
    redirect = R.redirect.viaName
      ? `<div class="alert danger" style="margin-top:10px">🚫 <b>${esc(R.redirect.fromName)}</b> 현관 출입 불가<br>➜ <b style="color:#67e8f9">${esc(R.redirect.viaName)}</b> 지하층(B1)을 통해 진입하세요</div>`
      : `<div class="alert danger" style="margin-top:10px">🚫 <b>${esc(R.redirect.fromName)}</b> 현관 출입 불가 — 우회할 다른 건물이 없습니다. 지하층 진입로를 확인하세요.</div>`;
  }
  const snap = r.snapDist > 60 ? `<div class="alert warn" style="margin-top:10px">클릭 지점이 도로에서 ${fmtLen(r.snapDist)} 떨어져 있어 가장 가까운 도로점에 연결했습니다.</div>` : '';
  const methodLabel = { road: '도로 그래프', 'grid-walkable': '보행 구역 그리드', 'grid-open': '전체 그리드' }[r.method];
  el.innerHTML = `
    <div class="row"><b>🧭 안전 경로 <span class="badge" style="background:${g.color}26;color:${g.color}">${g.label}</span></b>
      <button class="btn btn-ghost btn-xs" data-act="clearRoute" title="경로 초기화">초기화</button></div>
    <div class="row" style="align-items:baseline;margin-top:2px"><span class="big">${fmtLen(m.length)}</span><span class="label-sm">최대 R <b style="color:${g.color}">${fmt(m.maxRisk)}</b></span></div>
    <div class="rc-detail">
    <div class="grid2">
      <div class="stat"><b style="color:${g.color}">${fmt(m.maxRisk)}</b><span>최대 위험도 R</span></div>
      <div class="stat"><b>${fmt(m.avgRisk, 1)}</b><span>평균 위험도</span></div>
      <div class="stat"><b>${fmtLen(m.bands.high + m.bands.mid)}</b><span>주의 이상 구간 길이</span></div>
      <div class="stat"><b>${fmt(r.ms)} ms</b><span>${methodLabel}${r.cellSize ? ` · ${r.cellSize}px 격자` : ''}</span></div>
    </div>
    <div class="bar"><i style="width:${pct(m.bands.high)}%;background:#ef4444"></i><i style="width:${pct(m.bands.mid)}%;background:#f59e0b"></i><i style="width:${pct(m.bands.low)}%;background:#eab308"></i></div>
    <div class="legend"><span style="--c:#ef4444">위험 ≥70</span><span style="--c:#f59e0b">주의 30~70</span><span style="--c:#eab308">경미</span><span style="--c:#10b981">안전</span></div>
    ${cmp}${redirect}${snap}
    ${m.maxRisk >= 70 ? '<div class="alert warn" style="margin-top:10px">위험 구역을 완전히 피할 수 없는 경로입니다. 장비 작업 중지 또는 신호수 배치를 검토하세요.</div>' : ''}
    </div>`;
  el.hidden = false;
}

function updateUndoButtons() {
  $('tbUndo').disabled = !History.canUndo();
  $('tbRedo').disabled = !History.canRedo();
}
