/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 관리자: 공사 프로젝트 · 도면 정합 · 현장 인원 실시간 모니터링
 *
 *  프로젝트 = GPS 원점이 정해진 공사 현장. 서버에 등록하면 참여 코드(QR)로 휴대폰이 합류한다.
 *  관리자 키는 이 브라우저(localStorage)에만 보관하고 서버에는 해시만 있다.
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const PRJ = {
  ws: null, connected: false, info: null,
  clients: new Map(), events: [], survey: [],
  sync: false, publishTimer: null, lastPlanSrc: undefined, siteVersion: 0, joinCode: null,
  sims: [], audio: null, focusId: null,
};

const KeyStore = {
  all() { try { return JSON.parse(localStorage.getItem('socmap.v13.keys') || '{}'); } catch (e) { return {}; } },
  get(pid) { return this.all()[pid] || null; },
  set(pid, key) { try { const a = this.all(); a[pid] = key; localStorage.setItem('socmap.v13.keys', JSON.stringify(a)); } catch (e) { /* noop */ } },
};
const managerKey = () => (S.project.id ? KeyStore.get(S.project.id) : null);
const wsUrl = (path) => BACKEND_URL.replace(/^http/, 'ws') + path;
const ago = (ts) => { const s = Math.max(0, Math.round(Date.now() / 1000 - ts)); return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`; };

async function api(path, { method = 'GET', body, manager = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (manager && managerKey()) headers['X-Manager-Key'] = managerKey();
  const res = await fetch(BACKEND_URL + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) throw new Error((data && data.detail) || `HTTP ${res.status}`);
  return data;
}

// ═══════════════════════════════════════════════
//  프로젝트 생성 · 위치 지정 · 열기
// ═══════════════════════════════════════════════

let _prjModalMode = 'new';
function openProjectModal(mode) {
  _prjModalMode = mode;
  const isNew = mode === 'new';
  $('prjModalTitle').textContent = isNew ? '🏗️ 새 공사 프로젝트' : '📍 현장 위치 지정';
  $('prjNameRow').hidden = !isNew;
  $('prjKeepRow').hidden = !isNew;
  $('prjNameInput').value = isNew ? '' : S.project.name;
  $('prjKeep').checked = isNew && (S.markers.length > 0 || S.contours.length > 0 || !!S.bgImage);
  const o = S.project.origin;
  $('prjLocInput').value = o ? `${o.lat.toFixed(7)}, ${o.lon.toFixed(7)}` : '';
  $('prjAddrResults').innerHTML = '';
  $('prjMsg').textContent = S.project.id && !isNew ? '서버에 등록된 프로젝트의 위치는 바꿀 수 없습니다. 새 프로젝트를 만드세요.' : '';
  $('prjCreateBtn').textContent = isNew ? (S.backendOnline ? '서버에 프로젝트 만들기' : '로컬 프로젝트 만들기') : '위치 저장';
  $('prjCreateBtn').disabled = !!(S.project.id && !isNew);
  openModal('projectModal');
}

$('prjNewBtn').addEventListener('click', () => openProjectModal('new'));
$('emptyNewPrjBtn').addEventListener('click', () => openProjectModal('new'));
$('prjLocBtn').addEventListener('click', () => openProjectModal('locate'));
$('prjAddrBtn').addEventListener('click', async () => {
  const q = $('prjAddrInput').value.trim();
  if (!q) return;
  $('prjAddrResults').innerHTML = '<div class="hint">검색 중…</div>';
  try {
    const list = await geocodeAddress(q);
    $('prjAddrResults').innerHTML = list.length ? list.map((r, i) => `<button class="addr-item" data-i="${i}">${esc(r.name)}</button>`).join('') : '<div class="hint">결과가 없습니다. 도로명 주소나 지명을 바꿔 보세요.</div>';
    $('prjAddrResults').onclick = (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const r = list[+b.dataset.i];
      $('prjLocInput').value = `${r.lat.toFixed(7)}, ${r.lon.toFixed(7)}`;
      $('prjAddrResults').innerHTML = `<div class="hint">✅ ${esc(r.name)}</div>`;
    };
  } catch (e) { $('prjAddrResults').innerHTML = `<div class="hint warn">${esc(e.message)} (인터넷 연결 필요)</div>`; }
});
$('prjHereBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { $('prjMsg').textContent = '이 기기는 위치 기능을 지원하지 않습니다.'; return; }
  $('prjMsg').textContent = '현재 위치 확인 중…';
  navigator.geolocation.getCurrentPosition(p => {
    $('prjLocInput').value = `${p.coords.latitude.toFixed(7)}, ${p.coords.longitude.toFixed(7)}`;
    $('prjMsg').textContent = `정확도 ±${Math.round(p.coords.accuracy)}m (PC는 와이파이 기반이라 수십~수백 m 오차가 있을 수 있습니다)`;
  }, e => { $('prjMsg').textContent = '현재 위치를 가져오지 못했습니다: ' + e.message; }, { enableHighAccuracy: true, timeout: 15000 });
});
$('prjMapBtn').addEventListener('click', () => {
  if (!getFrame()) { $('prjMsg').textContent = '지도 선택은 위치가 한 번 정해진 뒤에 쓸 수 있습니다. 먼저 주소 검색이나 좌표로 대략의 위치를 정하세요.'; return; }
  closeModal('projectModal');
  pickOnMap('현장 원점으로 쓸 지점을 지도에서 클릭하세요', ip => {
    const ll = getFrame().toLatLon(ip.x, ip.y);
    $('prjLocInput').value = `${ll.lat.toFixed(7)}, ${ll.lon.toFixed(7)}`;
    openModal('projectModal');
  });
});

$('prjCreateBtn').addEventListener('click', async () => {
  const ll = parseLatLon($('prjLocInput').value);
  if (!ll) { $('prjMsg').textContent = '현장 위치를 위도, 경도로 지정하세요 (주소 검색 / 현재 위치 / 직접 입력).'; return; }
  if (_prjModalMode === 'locate') {
    reoriginLayout(ll);
    S.project.origin = ll;
    closeModal('projectModal');
    changed(); fitView(); updateAttribution(); renderProject();
    toast('현장 위치를 지정했습니다. 배경 지도가 표시됩니다.', 'success');
    return;
  }
  const name = $('prjNameInput').value.trim() || '새 현장';
  const keep = $('prjKeep').checked;
  let id = null;
  if (S.backendOnline) {
    try {
      const r = await api('/api/projects', { method: 'POST', body: { name, lat: ll.lat, lon: ll.lon }, manager: false });
      id = r.project.id; KeyStore.set(id, r.manager_key); PRJ.joinCode = r.project.join_code;
      toast(`서버에 프로젝트를 만들었습니다.\n참여 코드: ${r.project.join_code}\n관리자 키는 이 브라우저에 저장됩니다. 다른 PC에서 관리하려면 「프로젝트 정보」에서 키를 확인하세요.`, 'success', { duration: 9000 });
    } catch (e) { toast('서버 프로젝트 생성 실패: ' + e.message + '\n로컬 프로젝트로 만듭니다.', 'warn'); }
  }
  stopSims();
  if (keep) {
    reoriginLayout(ll);
    S.project = { id, name, origin: ll };
    changed(); History.init();
  } else {
    await loadDocument({ units: 'm', project: { id, name, origin: ll } }, null);
  }
  closeModal('projectModal');
  fitView(); updateAttribution(); monReconnect(); renderProject();
  if (id) { PRJ.sync = true; publishSite(true); }
});

/** 원점이 바뀌어도 실제 위치가 유지되도록 배치 전체를 평행 이동 (현장 규모에서 접평면 회전 차이는 무시 가능) */
function reoriginLayout(newOrigin) {
  const old = S.project.origin;
  if (!old) return;
  const d = new LocalFrame(newOrigin.lat, newOrigin.lon).toLocal(old.lat, old.lon);
  if (Math.hypot(d.x, d.y) < 1e-6) return;
  transformLayout(p => ({ x: p.x + d.x, y: p.y + d.y }), 0, true);
}

/** 배치 요소 전체에 좌표 변환 적용. rot: 장비 방향 회전(라디안), withPlan: 도면도 함께 */
function transformLayout(fn, rot = 0, withPlan = false) {
  const flat = (a) => { for (let i = 0; i + 1 < a.length; i += 2) { const q = fn({ x: a[i], y: a[i + 1] }); a[i] = +q.x.toFixed(3); a[i + 1] = +q.y.toFixed(3); } };
  for (const m of S.markers) { const q = fn(m); m.x = +q.x.toFixed(3); m.y = +q.y.toFixed(3); if (m.isEquipment) m.heading = (m.heading || 0) + rot; }
  for (const n of S.nodes) { const q = fn({ x: n.cx, y: n.cy }); n.cx = q.x; n.cy = q.y; }
  S.contours = S.contours.map(c => c.map(pt => { const a = Array.isArray(pt[0]) ? pt[0] : pt, q = fn({ x: +a[0], y: +a[1] }); return [[+q.x.toFixed(3), +q.y.toFixed(3)]]; }));
  S.polylines.forEach(l => flat(l.points)); S.fences.forEach(l => flat(l.points)); flat(S.walkableAreaPolygon);
  S.siteEnvironment.envZones.forEach(z => { flat(z.polygon); delete z._bbox; });
  if (S.route) { S.route.points = S.route.points.map(fn); S.route.result = null; }
  if (withPlan && S.plan.transform) {
    const [a, b, c, d, e, f] = S.plan.transform, o = fn({ x: c, y: f });
    S.plan.transform = [a, b, o.x, d, e, o.y];   // 평행 이동만 반영
  }
}

// ── 서버 프로젝트 열기 ──
$('prjOpenBtn').addEventListener('click', async () => {
  if (!S.backendOnline) await checkBackend();
  if (!S.backendOnline) { toast('서버가 꺼져 있습니다. 현장모니터링_실행.bat 으로 서버를 켜세요.', 'error'); return; }
  try {
    const list = await api('/api/projects', { manager: false });
    $('prjList').innerHTML = list.length ? list.map(p => `
      <button class="prj-item" data-pid="${esc(p.id)}">
        <b>${esc(p.name)}</b> ${KeyStore.get(p.id) ? '<span class="badge" style="background:rgba(16,185,129,.2);color:#6ee7b7">관리 권한</span>' : ''}
        <span class="label-sm">${p.origin.lat.toFixed(5)}, ${p.origin.lon.toFixed(5)} · 접속 ${p.online}명 · ${new Date(p.created_at * 1000).toLocaleDateString('ko-KR')}</span>
      </button>`).join('') : '<div class="hint">서버에 프로젝트가 없습니다. 「새 프로젝트」로 만드세요.</div>';
    openModal('openModal');
  } catch (e) { toast('프로젝트 목록을 가져오지 못했습니다: ' + e.message, 'error'); }
});
$('prjList').addEventListener('click', async e => {
  const b = e.target.closest('[data-pid]'); if (!b) return;
  const pid = b.dataset.pid;
  let key = KeyStore.get(pid);
  if (!key) {
    key = prompt('이 프로젝트의 관리자 키를 입력하세요 (프로젝트를 만든 PC의 「프로젝트 정보」에서 확인)');
    if (!key) return;
    KeyStore.set(pid, key.trim());
  }
  closeModal('openModal');
  await openServerProject(pid);
});

async function openServerProject(pid) {
  setLoading('프로젝트를 불러오는 중…');
  try {
    const prev = S.project.id;
    S.project.id = pid;   // managerKey() 가 이 id 로 키를 찾도록
    let meta;
    try { meta = await api(`/api/projects/${pid}`); } catch (e) { S.project.id = prev; throw e; }
    let site = null, planSrc = null;
    try { site = await api(`/api/projects/${pid}/site`); } catch (e) { /* 아직 공유 전 */ }
    if (site && site.planVersion) {
      try { planSrc = await blobToDataURL(await api(`/api/projects/${pid}/plan?v=${site.planVersion}`)); } catch (e) { /* 도면 없음 */ }
    }
    stopSims();
    const doc = site ? { ...site.doc, units: 'm' } : { units: 'm' };
    doc.project = { id: pid, name: meta.name, origin: meta.origin };
    if (site && site.doc && site.doc.plan && planSrc && site.phonePlan) {
      // 서버에는 축소한 도면만 있으므로 정합 기준점의 도면 px 좌표도 같은 비율로 맞춘다
      const kx = site.phonePlan.width / (site.doc.plan.width || site.phonePlan.width), ky = site.phonePlan.height / (site.doc.plan.height || site.phonePlan.height);
      doc.plan = { ...site.doc.plan, ...site.phonePlan, refs: (site.doc.plan.refs || []).map(r => ({ ...r, px: { x: r.px.x * kx, y: r.px.y * ky } })) };
    }
    await loadDocument(doc, planSrc);
    PRJ.joinCode = meta.join_code; PRJ.sync = true; PRJ.lastPlanSrc = S.bgImageSrc;
    monReconnect(); renderProject(); updateAttribution();
    toast(`「${meta.name}」 프로젝트를 열었습니다.`, 'success');
  } catch (e) {
    toast('프로젝트를 열 수 없습니다: ' + e.message, 'error');
  } finally { setLoading(null); }
}
const blobToDataURL = (blob) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });

$('prjInfoBtn').addEventListener('click', () => {
  const key = managerKey();
  const o = S.project.origin;
  $('prjInfoBody').innerHTML = `
    <div class="row"><span>프로젝트</span><b>${esc(S.project.name)}</b></div>
    <div class="row"><span>원점</span><span>${o ? `${o.lat.toFixed(7)}, ${o.lon.toFixed(7)}` : '미지정'}</span></div>
    <div class="row"><span>서버 ID</span><span>${S.project.id || '로컬 전용'}</span></div>
    ${PRJ.joinCode ? `<div class="row"><span>참여 코드</span><b style="font-size:18px;letter-spacing:.15em">${PRJ.joinCode}</b></div>` : ''}
    ${key ? `<div><div class="label-sm">관리자 키 (다른 PC에서 이 프로젝트를 관리할 때 필요 — 외부에 공유하지 마세요)</div><input class="input" readonly value="${esc(key)}" onclick="this.select()"></div>` : ''}
    ${S.project.id && key ? '<button class="btn" id="prjNewCode">참여 코드 새로 발급 (기존 코드 무효화)</button>' : ''}`;
  openModal('prjInfoModal');
  const nc = $('prjNewCode');
  if (nc) nc.onclick = async () => {
    if (!confirm('참여 코드를 새로 발급할까요? 이미 접속한 인원은 유지되지만 기존 QR로는 새로 들어올 수 없습니다.')) return;
    const m = await api(`/api/projects/${S.project.id}`, { method: 'PATCH', body: { new_code: true } });
    PRJ.joinCode = m.join_code; closeModal('prjInfoModal'); renderProject(); toast('새 참여 코드: ' + m.join_code, 'success');
  };
});

// ═══════════════════════════════════════════════
//  현장 배치 공유 (휴대폰이 받아가는 데이터)
// ═══════════════════════════════════════════════

function sitePayload(includePlan) {
  const doc = JSON.parse(serializeDoc());
  const site = { doc, extent: docExtent(), planImage: 'keep' };
  if (includePlan) {
    if (S.bgImage && S.plan.transform) {
      // 휴대폰용으로 긴 변 2400px 이하로 축소하고, 그에 맞게 변환 행렬도 보정
      const W = S.plan.width, H = S.plan.height, k = Math.min(1, 2400 / Math.max(W, H));
      const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
      c.getContext('2d').drawImage(S.bgImage, 0, 0, c.width, c.height);
      site.planImage = c.toDataURL('image/jpeg', 0.8);
      // 축소 이미지 px x' = x·kx  →  X = (a/kx)·x' + (b/ky)·y' + c
      const [a, b, cc, d, e, f] = S.plan.transform, kx = c.width / W, ky = c.height / H;
      site.phonePlan = { width: c.width, height: c.height, transform: [a / kx, b / ky, cc, d / kx, e / ky, f] };
    } else site.planImage = null;
  } else if (PRJ.lastPhonePlan) site.phonePlan = PRJ.lastPhonePlan;
  return site;
}

async function publishSite(force = false) {
  clearTimeout(PRJ.publishTimer); PRJ.publishTimer = null;
  if (!PRJ.sync || !S.project.id || !managerKey() || !S.backendOnline) return;
  const planChanged = force || PRJ.lastPlanSrc !== S.bgImageSrc || PRJ.lastPlanT !== JSON.stringify(S.plan.transform);
  try {
    const payload = sitePayload(planChanged);
    const r = await api(`/api/projects/${S.project.id}/site`, { method: 'POST', body: payload });
    if (planChanged) { PRJ.lastPlanSrc = S.bgImageSrc; PRJ.lastPlanT = JSON.stringify(S.plan.transform); PRJ.lastPhonePlan = payload.phonePlan; }
    PRJ.siteVersion = r.version;
    renderProject();
  } catch (e) { toast('현장 배치 공유 실패: ' + e.message, 'error'); }
}
function schedulePublish() {
  if (!PRJ.sync || !S.project.id) return;
  clearTimeout(PRJ.publishTimer);
  PRJ.publishTimer = setTimeout(publishSite, 700);
}

const _prevDocReplaced = onDocReplaced;
onDocReplaced = () => { _prevDocReplaced(); renderProject(); };
const _prevDocChanged = onDocChanged;
onDocChanged = (opts) => { _prevDocChanged(opts); schedulePublish(); if (S.mode === 'align') renderModeUI(); };

$('syncToggle').addEventListener('change', async e => {
  if (e.target.checked) {
    if (!S.project.id) { e.target.checked = false; toast('서버 프로젝트에서만 동기화할 수 있습니다. 「새 프로젝트」를 서버에 만들거나 「서버 프로젝트」를 여세요.', 'warn'); return; }
    PRJ.sync = true; monBeep(660, 0.05); await publishSite(true);
  } else PRJ.sync = false;
  renderProject();
});

// ═══════════════════════════════════════════════
//  실시간 연결
// ═══════════════════════════════════════════════

function monReconnect() {
  if (PRJ.ws) { PRJ.ws.onclose = null; try { PRJ.ws.close(); } catch (e) { /* noop */ } }
  PRJ.ws = null; PRJ.connected = false;
  PRJ.clients = new Map(); PRJ.events = []; PRJ.survey = []; S.live = {}; invalidateRisk();
  monConnect();
}
function monConnect() {
  if (PRJ.ws && PRJ.ws.readyState <= 1) return;
  if (!S.backendOnline || !S.project.id || !managerKey()) { renderProject(); renderMonitor(); return; }
  const ws = new WebSocket(wsUrl(`/ws/p/${S.project.id}/manager?key=${encodeURIComponent(managerKey())}`));
  PRJ.ws = ws;
  let opened = false;
  ws.onopen = async () => {
    opened = true;
    PRJ.connected = true;
    try { PRJ.info = await api('/api/server/info', { manager: false }); } catch (e) { PRJ.info = null; }
    try { const m = await api(`/api/projects/${S.project.id}`); PRJ.joinCode = m.join_code; } catch (e) { /* noop */ }
    if (PRJ.sync) publishSite(true);
    renderProject(); renderMonitor();
  };
  ws.onmessage = (e) => onServerMessage(JSON.parse(e.data));
  ws.onclose = (e) => {
    PRJ.connected = false; renderProject(); renderMonitor();
    // 핸드셰이크 단계에서 거부되면(프로젝트 삭제·키 오류) 브라우저에는 1006 으로 보인다
    if (e.code === 4403 || (!opened && S.backendOnline)) onProjectRejected();
  };
  ws.onerror = () => ws.close();
}
setInterval(() => { if (!PRJ.connected) monConnect(); }, 5000);

/** 서버가 연결을 거부: 프로젝트가 삭제됐거나 관리자 키가 틀림 */
async function onProjectRejected() {
  const pid = S.project.id;
  try {
    const r = await fetch(`${BACKEND_URL}/api/projects/${pid}`, { headers: { 'X-Manager-Key': managerKey() || '' } });
    if (r.status === 404) {
      S.project.id = null; PRJ.sync = false; PRJ.joinCode = null;
      changed({ risk: false }); renderProject(); renderMonitor();
      toast('서버에서 이 프로젝트를 찾을 수 없어 로컬 프로젝트로 전환했습니다.\n휴대폰 연동이 필요하면 프로젝트 메뉴의 「새 프로젝트」로 다시 등록하세요 (현재 배치 유지 가능).', 'warn', { duration: 9000 });
      return;
    }
    if (r.ok) return;   // 일시적 연결 실패 — 5초 뒤 자동 재시도
  } catch (err) { return; /* 서버 꺼짐 */ }
  toast('관리자 키가 맞지 않아 실시간 연결이 거부되었습니다. 프로젝트 정보에서 키를 확인하세요.', 'error');
}

function onServerMessage(msg) {
  switch (msg.type) {
    case 'snapshot':
      PRJ.clients = new Map(msg.clients.map(c => [c.id, c]));
      PRJ.events = msg.events.slice().reverse();
      PRJ.survey = msg.survey || [];
      PRJ.clients.forEach(updateLive);
      break;
    case 'client': PRJ.clients.set(msg.client.id, msg.client); updateLive(msg.client); break;
    case 'left': PRJ.clients.delete(msg.id); break;
    case 'event':
      PRJ.events.unshift(msg.event); PRJ.events = PRJ.events.slice(0, 150);
      onMonitorEvent(msg.event);
      break;
    case 'ack': for (const ev of PRJ.events) if (ev.id === msg.event_id) ev.acked = true; updateAlertState(); break;
    case 'survey': PRJ.survey = msg.survey; if (S.mode === 'align') renderModeUI(); break;
  }
  renderMonitor(); requestRender();
}

/** 운전원 휴대폰 위치 → 연결된 장비의 실시간 위치 */
function updateLive(c) {
  if (c.role !== 'operator' || !c.equipment || c.x == null) return;
  if (!S.markers.some(m => m.id === c.equipment)) return;
  const prev = S.live[c.equipment], online = c.online !== false;
  // 같은 장비에 연결된 다른 운전원이 접속 중이면, 끊긴 쪽 정보로 덮어쓰지 않는다
  if (prev && prev.cid !== c.id && prev.online && !online) return;
  S.live[c.equipment] = { cid: c.id, x: c.x, y: c.y, heading: c.heading != null ? bearingToHeading(c.heading) : undefined, ts: c.last_seen, online, by: c.name };
  invalidateRisk();
}

function monSend(obj) {
  if (PRJ.ws && PRJ.ws.readyState === 1) { PRJ.ws.send(JSON.stringify(obj)); return true; }
  toast('현장 서버에 연결되어 있지 않습니다.', 'error');
  return false;
}

// ═══════════════════════════════════════════════
//  경보
// ═══════════════════════════════════════════════

function monBeep(freq, dur, when = 0) {
  try {
    PRJ.audio = PRJ.audio || new (window.AudioContext || window.webkitAudioContext)();
    const a = PRJ.audio, t = a.currentTime + when, o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
  } catch (e) { /* noop */ }
}

function onMonitorEvent(ev) {
  if (ev.severity === 'critical') {
    for (let i = 0; i < 3; i++) { monBeep(1000, 0.2, i * 0.45); monBeep(650, 0.2, i * 0.45 + 0.22); }
    toast(ev.text, 'error', { duration: 10000, action: ev.x != null ? { label: '위치 보기', fn: () => centerOn(ev.x, ev.y, fitScale() * 3) } : null });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('SOC-MAP 안전 경보', { body: ev.text, tag: ev.id, requireInteraction: true }); } catch (e) { /* noop */ }
    }
  } else if (ev.severity === 'warning') {
    monBeep(880, 0.15); monBeep(880, 0.15, 0.25);
    toast(ev.text, 'warn', { duration: 5000 });
  }
  updateAlertState();
}
function updateAlertState() {
  const n = PRJ.events.filter(e => e.severity === 'critical' && !e.acked).length;
  stage.classList.toggle('alerting', n > 0);
  $('bellCount').hidden = !n; $('bellCount').textContent = n;
  $('alertBell').classList.toggle('ringing', n > 0);
}
function ackAll() {
  for (const ev of PRJ.events) if (ev.severity === 'critical' && !ev.acked) { monSend({ type: 'ack', event_id: ev.id }); ev.acked = true; }
  updateAlertState(); renderMonitor();
}

// ═══════════════════════════════════════════════
//  사이드바 렌더
// ═══════════════════════════════════════════════

function serverBase(https) {
  const info = PRJ.info, ip = (info && info.lan && info.lan[0]) || new URL(BACKEND_URL).hostname;
  if (https && info && info.https_port) return `https://${ip}:${info.https_port}`;
  return `http://${ip}:${(info && info.http_port) || new URL(BACKEND_URL).port || 8000}`;
}

function renderProject() {
  const P = S.project, o = P.origin;
  $('prjName').textContent = P.name || '새 현장';
  $('prjLoc').innerHTML = o ? `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}` : '<span style="color:var(--warn)">위치 미지정</span>';
  $('joinEmpty').hidden = !!(P.id && PRJ.connected && PRJ.joinCode);
  $('prjBadge').textContent = P.id ? '서버' : '로컬';
  $('prjBadge').className = 'badge ' + (P.id ? 'badge-ok' : 'badge-muted');
  $('prjLocBtn').hidden = !!P.id;
  $('syncToggle').checked = PRJ.sync && !!P.id;
  $('syncRow').hidden = !P.id;
  $('prjStatus').innerHTML = !P.id ? (S.backendOnline ? '로컬 프로젝트입니다. 휴대폰 연동은 「새 프로젝트」로 서버에 등록하세요.' : '서버 꺼짐 · 로컬 작업')
    : !managerKey() ? '<span style="color:var(--warn)">관리자 키 없음 — 보기 전용</span>'
    : !PRJ.connected ? '서버 연결 중…'
    : `실시간 연결됨 · 배치 v${PRJ.siteVersion || '-'}${PRJ.sync ? '' : ' · <span style="color:var(--warn)">동기화 꺼짐</span>'}`;

  const card = $('joinCard');
  if (!P.id || !PRJ.connected || !PRJ.joinCode) { card.hidden = true; return; }
  card.hidden = false;
  const hasHttps = PRJ.info && PRJ.info.https_port;
  const url = `${serverBase(true)}/j/${PRJ.joinCode}`;
  const local = /^(localhost|127\.)/.test(new URL(url).hostname);
  $('joinCode').textContent = PRJ.joinCode;
  $('joinUrl').innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
  $('joinNote').innerHTML = local ? '⚠️ 서버가 이 PC에서만 열려 있습니다. 휴대폰 연동은 <b>현장모니터링_실행.bat</b>으로 서버를 켜세요.'
    : hasHttps ? '같은 와이파이에서 QR을 찍으세요. 처음에 “안전하지 않음” 경고가 나오면 <b>고급 → 계속</b>(자체 인증서).'
    : '⚠️ HTTPS 가 꺼져 있어 휴대폰 GPS가 막힙니다. <b>현장모니터링_실행.bat</b>으로 서버를 켜세요(시연 모드는 가능).';
  const qr = $('qrBox');
  if (qr.dataset.url !== url) {
    qr.dataset.url = url; qr.innerHTML = '';
    if (window.QRCode) new QRCode(qr, { text: url, width: 128, height: 128, correctLevel: QRCode.CorrectLevel.M });
    else qr.innerHTML = '<span class="hint">QR 표시에는 인터넷이 필요합니다</span>';
  }
}

function renderMonitor() {
  const list = [...PRJ.clients.values()].sort((a, b) =>
    (b.online !== false) - (a.online !== false) || LEVELS[b.level || 'safe'].rank - LEVELS[a.level || 'safe'].rank || String(a.name).localeCompare(b.name));
  const online = list.filter(c => c.online !== false);
  const danger = online.filter(c => c.level === 'danger').length;
  const ops = online.filter(c => c.role === 'operator').length;
  const warn = online.filter(c => c.level === 'warning').length;
  $('monStatus').innerHTML = !S.project.id ? '<div class="alert info">서버 프로젝트를 열면 현장 앱으로 합류한 인원이 여기에 표시됩니다.</div>'
    : !PRJ.connected ? '<div class="alert warn">현장 서버에 연결하는 중입니다…</div>'
    : `<div class="kpis"><div><b>${online.length - ops}</b><span>작업자</span></div><div><b>${ops}</b><span>운전 장비</span></div>
       <div class="${warn ? 'kpi-warn' : ''}"><b>${warn}</b><span>접근 경고</span></div><div class="${danger ? 'kpi-danger' : ''}"><b>${danger}</b><span>위험 진입</span></div></div>`;
  const badge = $('monBadge');
  badge.textContent = danger ? danger : online.length ? online.length : '';
  badge.className = 'rail-badge' + (danger ? ' danger' : '');
  badge.hidden = !badge.textContent;

  $('workerList').innerHTML = list.length ? list.map(c => {
    const lv = LEVELS[c.level || 'safe'], off = c.online === false;
    const eqName = c.role === 'operator' ? (S.markers.find(m => m.id === c.equipment) || {}).label || '장비 미지정' : '';
    const detail = off ? `신호 끊김 · ${ago(c.last_seen)}`
      : c.role === 'operator'
        ? `🚜 ${eqName}${(c.intrusions || []).length ? ` · <b style="color:#fca5a5">반경 내 ${(c.intrusions || []).length}명</b>` : ''}${c.speed ? ` · ${(c.speed * 3.6).toFixed(1)}km/h` : ''}`
        : `${c.inside_site === false ? '현장 밖' : lv.label}${c.risk ? ` · R${c.risk}` : ''}${c.nearest_m != null && c.level !== 'danger' ? ` · 위험구역 ${c.nearest_m}m` : ''}`;
    const acc = c.sigma != null ? ` · ±${c.sigma.toFixed(1)}m` : c.acc ? ` · ±${Math.round(c.acc)}m` : '';
    return `<div class="worker-item ${off ? 'off' : ''} lv-${c.level || 'safe'}" style="--c:${off ? '#64748b' : c.role === 'operator' ? '#f59e0b' : lv.color}" data-wid="${esc(c.id)}">
      <span class="wdot"></span>
      <div class="flex1" style="min-width:0"><b>${c.role === 'operator' ? '🚜' : '👷'} ${esc(c.name)}</b>${c.sim ? ' <span class="label-sm">가상</span>' : ''}<div class="label-sm wdetail">${detail}${off ? '' : acc}</div></div>
      <button class="icon-btn" data-wact="focus" title="지도에서 보기">📍</button>
      <button class="icon-btn" data-wact="msg" title="메시지" ${off ? 'disabled' : ''}>💬</button>
    </div>`;
  }).join('') : '<div class="hint">접속한 인원이 없습니다. 휴대폰으로 QR을 찍어 합류하세요.</div>';

  const unacked = PRJ.events.filter(e => e.severity === 'critical' && !e.acked).length;
  $('ackAllBtn').hidden = !unacked; $('ackAllBtn').textContent = `긴급 ${unacked}건 확인`;
  $('eventList').innerHTML = PRJ.events.slice(0, 40).map(ev => `
    <div class="event-item sev-${ev.severity} ${ev.acked ? 'acked' : ''}" data-ev="${esc(ev.id)}">
      <span class="label-sm">${new Date(ev.ts * 1000).toLocaleTimeString('ko-KR', { hour12: false })}</span>
      <span class="flex1">${esc(ev.text)}</span>
      ${ev.severity === 'critical' && !ev.acked ? '<button class="btn btn-xs" data-evack>확인</button>' : ''}
    </div>`).join('') || '<div class="hint">이벤트 없음</div>';
  $('simWorkersBtn').textContent = PRJ.sims.length ? `🧪 가상 인원 종료 (${PRJ.sims.length})` : '🧪 가상 인원 투입';
}
setInterval(() => { if (PRJ.clients.size) renderMonitor(); }, 5000);

$('workerList').addEventListener('click', e => {
  const item = e.target.closest('[data-wid]'); if (!item) return;
  const c = PRJ.clients.get(item.dataset.wid); if (!c) return;
  if (e.target.closest('[data-wact]')?.dataset.wact === 'msg') {
    const text = prompt(`${c.name}에게 보낼 메시지`, c.role === 'operator' ? '장비 작업을 일시 중지하세요.' : '위험 구역에서 즉시 벗어나세요.');
    if (text && text.trim()) monSend({ type: 'message', to: c.id, text: text.trim(), level: 'info' });
  } else if (c.x != null) { PRJ.focusId = c.id; centerOn(c.x, c.y, fitScale() * 3); }
});
$('eventList').addEventListener('click', e => {
  const item = e.target.closest('[data-ev]'); if (!item) return;
  const ev = PRJ.events.find(x => x.id === item.dataset.ev); if (!ev) return;
  if (e.target.closest('[data-evack]')) { monSend({ type: 'ack', event_id: ev.id }); ev.acked = true; updateAlertState(); renderMonitor(); }
  else if (ev.x != null) centerOn(ev.x, ev.y, fitScale() * 3);
});
$('ackAllBtn').addEventListener('click', ackAll);
$('broadcastBtn').addEventListener('click', () => openModal('broadcastModal'));
document.querySelectorAll('[data-broadcast]').forEach(b => b.addEventListener('click', () => {
  const level = b.dataset.broadcast;
  const text = level === 'evacuate' ? '🚨 즉시 작업을 중지하고 지정된 대피 장소로 이동하세요.' : $('broadcastText').value.trim();
  if (!text) { toast('보낼 내용을 입력하세요.', 'warn'); return; }
  if (monSend({ type: 'message', to: 'all', text, level })) { closeModal('broadcastModal'); toast('전체 인원에게 전송했습니다.', 'success'); }
}));

// ═══════════════════════════════════════════════
//  지도 레이어 (render2d 에서 호출)
// ═══════════════════════════════════════════════

function drawMonitorLayer(ctx, s) {
  const px = (n) => n / s, F = getFrame();
  // 도면 정합 기준점: 도면 위 위치 → 실제 위치 (잔차 선)
  const T = planTransform();
  if (T && (S.mode === 'align' || S.plan.refs.length)) {
    S.plan.refs.forEach((r, i) => {
      const a = T.apply(r.px), show = S.mode === 'align';
      if (F && show) {
        const b = F.toLocal(r.lat, r.lon);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = '#f0abfc'; ctx.lineWidth = px(2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x - px(6), b.y); ctx.lineTo(b.x + px(6), b.y); ctx.moveTo(b.x, b.y - px(6)); ctx.lineTo(b.x, b.y + px(6)); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(a.x, a.y, px(show ? 9 : 6), 0, Math.PI * 2);
      ctx.fillStyle = '#a855f7'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = px(2); ctx.stroke();
      label(String(i + 1), a.x, a.y, px(show ? 10 : 8), '#fff');
    });
  }
  // 현장 측량점
  if (F && S.mode === 'align') for (const sp of PRJ.survey) {
    const p = F.toLocal(sp.lat, sp.lon);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#22d3ee'; ctx.fillRect(-px(5), -px(5), px(10), px(10)); ctx.restore();
    label(`${sp.name} ±${sp.estError.toFixed(1)}m`, p.x, p.y + px(16), px(10.5), '#a5f3fc');
  }
  // 현장 인원
  const t = performance.now() / 1000;
  for (const c of PRJ.clients.values()) {
    if (c.x == null || c.role === 'operator') continue;
    const off = c.online === false, color = off ? '#64748b' : LEVELS[c.level || 'safe'].color;
    if (!off && c.level === 'danger') {
      const k = t % 1;
      ctx.beginPath(); ctx.arc(c.x, c.y, px(14 + k * 26), 0, Math.PI * 2); ctx.strokeStyle = `rgba(239,68,68,${1 - k})`; ctx.lineWidth = px(4); ctx.stroke();
    }
    if (c.sigma && !c.sim) { ctx.beginPath(); ctx.arc(c.x, c.y, c.sigma, 0, Math.PI * 2); ctx.fillStyle = 'rgba(96,165,250,0.12)'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(c.x, c.y, px(11), 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = c.id === PRJ.focusId ? '#60a5fa' : '#fff'; ctx.lineWidth = px(c.id === PRJ.focusId ? 4 : 2.5); ctx.stroke();
    emoji('👷', c.x, c.y, px(13));
    label(c.name + (off ? ' (끊김)' : ''), c.x, c.y - px(19), px(11), off ? '#cbd5e1' : '#fff');
  }
  // 운전원과 연결된 장비 표시
  for (const [id, lv] of Object.entries(S.live)) {
    const m = S.markers.find(mm => mm.id === id); if (!m) continue;
    ctx.beginPath(); ctx.arc(lv.x, lv.y, px(19), 0, Math.PI * 2);
    ctx.strokeStyle = lv.online ? '#f59e0b' : '#64748b'; ctx.lineWidth = px(2.5); ctx.setLineDash([px(4), px(3)]); ctx.stroke(); ctx.setLineDash([]);
    label(`🚜 ${lv.by}${lv.online ? '' : ' (마지막 위치)'}`, lv.x, lv.y + px(30), px(10.5), '#fcd34d');
  }
}
setInterval(() => { for (const c of PRJ.clients.values()) if (c.level === 'danger' && c.online !== false) { requestRender(); break; } }, 60);

// ═══════════════════════════════════════════════
//  도면 정합 (도면 위 점 ↔ 실제 위치)
// ═══════════════════════════════════════════════

function hitAlignRef(ix, iy) {
  const T = planTransform(); if (!T) return -1;
  const s = getT().s;
  return S.plan.refs.findIndex(r => { const a = T.apply(r.px); return Math.hypot(ix - a.x, iy - a.y) <= 12 / s; });
}

let _alignEdit = null;
function onAlignClick(ip) {
  if (!getFrame()) { toast('먼저 프로젝트의 현장 위치를 지정하세요 (🏗️ 프로젝트 → 📍 위치).', 'warn'); return; }
  if (!S.bgImage || !planTransform()) { toast('정합할 배치도가 없습니다. 먼저 배치도를 업로드하세요.', 'warn'); return; }
  const idx = hitAlignRef(ip.x, ip.y);
  if (idx >= 0) { _alignEdit = { idx }; }
  else {
    const px = planTransform().inverse(ip);
    if (px.x < 0 || px.y < 0 || px.x > S.plan.width || px.y > S.plan.height) { toast('도면 이미지 안쪽을 클릭하세요.', 'warn'); return; }
    _alignEdit = { px: { x: +px.x.toFixed(1), y: +px.y.toFixed(1) } };
  }
  const r = idx >= 0 ? S.plan.refs[idx] : null;
  $('alignTitle').textContent = r ? `기준점 ${idx + 1} 수정` : `새 기준점 (도면 ${Math.round(_alignEdit.px.x)}, ${Math.round(_alignEdit.px.y)} px)`;
  $('alignInput').value = r ? `${r.lat.toFixed(7)}, ${r.lon.toFixed(7)}` : '';
  $('alignDelete').hidden = !r;
  $('alignSurvey').innerHTML = PRJ.survey.length
    ? '<option value="">— 현장 측량점에서 선택 —</option>' + PRJ.survey.map(sp => `<option value="${esc(sp.id)}">${esc(sp.name)} (±${sp.estError.toFixed(1)}m, ${sp.n}회 평균${sp.by ? ' · ' + esc(sp.by) : ''})</option>`).join('')
    : '<option value="">현장 측량점 없음 (현장 앱 「📐 측량」으로 추가)</option>';
  $('alignMsg').textContent = '';
  openModal('alignModal');
}
$('alignSurvey').addEventListener('change', e => {
  const sp = PRJ.survey.find(x => x.id === e.target.value);
  if (sp) $('alignInput').value = `${sp.lat.toFixed(7)}, ${sp.lon.toFixed(7)}`;
});
$('alignPick').addEventListener('click', () => {
  closeModal('alignModal');
  const prevOpacity = S.plan.opacity; S.plan.opacity = 0.25; requestRender();
  pickOnMap('같은 지점을 배경 지도(위성)에서 클릭하세요', ip => {
    S.plan.opacity = prevOpacity;
    const ll = getFrame().toLatLon(ip.x, ip.y);
    $('alignInput').value = `${ll.lat.toFixed(7)}, ${ll.lon.toFixed(7)}`;
    $('alignMsg').textContent = '위성 지도 자체에도 수 m 오차가 있을 수 있습니다. 정밀하게 하려면 현장 측량점을 쓰세요.';
    openModal('alignModal'); requestRender();
  });
});
$('alignSave').addEventListener('click', () => {
  const ll = parseLatLon($('alignInput').value);
  if (!ll) { $('alignMsg').textContent = '위도, 경도를 입력하세요. 예: 35.1760123, 126.9065123'; return; }
  if (_alignEdit.idx != null) Object.assign(S.plan.refs[_alignEdit.idx], ll);
  else S.plan.refs.push({ id: newId('g'), px: _alignEdit.px, ...ll });
  closeModal('alignModal');
  applyAlignment();
});
$('alignDelete').addEventListener('click', () => {
  S.plan.refs.splice(_alignEdit.idx, 1);
  closeModal('alignModal');
  applyAlignment();
});

/**
 * 기준점으로 도면 변환을 다시 계산하고, 도면 위에 그렸던 배치 요소(건물·도로·장비 등)도 같이 옮긴다.
 * 1점: 이동만 / 2점: 이동·회전·축척 / 3점 이상: 아핀(최소제곱)
 */
function applyAlignment() {
  const F = getFrame(), oldT = planTransform();
  if (!F || !oldT) return;
  const refs = S.plan.refs;
  let newT;
  if (refs.length >= 2) newT = fitTransform(refs.map(r => ({ src: r.px, dst: F.toLocal(r.lat, r.lon) })));
  else if (refs.length === 1) {
    const r = refs[0], cur = oldT.apply(r.px), dst = F.toLocal(r.lat, r.lon), [a, b, c, d, e, f] = oldT.matrix;
    newT = makeTransform([a, b, c + dst.x - cur.x, d, e, f + dst.y - cur.y], [{ src: r.px, dst }], 'translate');
  }
  if (!newT) { changed(); renderModeUI(); return; }
  const moveLayout = $('alignMoveLayout') ? $('alignMoveLayout').checked : true;
  if (moveLayout) transformLayout(p => newT.apply(oldT.inverse(p)), (newT.rotation - oldT.rotation) * Math.PI / 180);
  S.plan.transform = newT.matrix;
  changed(); renderModeUI(); requestRender();
  const q = newT.count >= 3 ? `오차(RMS) ${newT.rms.toFixed(2)}m` : newT.count === 2 ? '2점: 오차 검증을 위해 3번째 점을 권장' : '1점: 위치만 맞춤 (축척·방향은 2점부터)';
  toast(`도면을 실제 위치에 맞췄습니다. 축척 1px = ${newT.scale.toFixed(4)}m · 회전 ${newT.rotation.toFixed(1)}° · ${q}`, newT.rms > 3 ? 'warn' : 'success', { duration: 6000 });
}

function alignModeOptions() {
  const T = planTransform(), refs = S.plan.refs, F = getFrame();
  if (!F) return '<div class="alert warn">현장 위치가 지정되지 않았습니다. 🏗️ 프로젝트에서 위치를 먼저 지정하세요.</div>';
  if (!S.bgImage) return '<div class="alert warn">배치도가 없습니다. 배치도를 업로드한 뒤 정합하세요.</div>';
  const resid = refs.map(r => { const a = T.apply(r.px), b = F.toLocal(r.lat, r.lon); return Math.hypot(a.x - b.x, a.y - b.y); });
  const rms = resid.length ? Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / resid.length) : 0;
  return `<div class="hint">도면에서 <b>위치가 확실한 지점</b>(건물 모서리·출입구·측량 말뚝)을 클릭하고 실제 위치를 지정하세요. 서로 멀리 떨어진 <b>3점 이상</b>이면 오차를 검증할 수 있습니다.</div>
    <label class="row label-sm"><span>배치 요소도 도면과 함께 이동</span><input type="checkbox" id="alignMoveLayout" checked></label>
    <div class="list">${refs.map((r, i) => `<div class="list-item" style="--c:${resid[i] > 3 ? '#ef4444' : '#a855f7'}"><span>${i + 1}. ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)} <span class="label-sm">오차 ${resid[i].toFixed(2)}m</span></span><button class="icon-btn" data-del-ref="${i}" title="삭제">✕</button></div>`).join('')}</div>
    <div class="alert ${refs.length >= 3 && rms < 2 ? 'info' : 'warn'}">축척 1px = ${T.scale.toFixed(4)} m · 회전 ${T.rotation.toFixed(1)}°<br>
      ${refs.length === 0 ? '기준점 없음 — 임시 배치 상태입니다.' : refs.length < 3 ? `기준점 ${refs.length}개 — 3점 이상이면 오차를 확인할 수 있습니다.` : `오차(RMS) ${rms.toFixed(2)} m ${rms < 1 ? '(매우 좋음)' : rms < 2 ? '(좋음)' : rms < 5 ? '(보통 — 기준점 재확인 권장)' : '(나쁨 — 잘못 찍은 점이 있습니다)'}`}</div>
    ${PRJ.survey.length ? `<div class="label-sm">현장 측량점 ${PRJ.survey.length}개 사용 가능 (◆ 표시)</div>` : ''}`;
}
$('modeOptions').addEventListener('click', e => {
  const b = e.target.closest('[data-del-ref]');
  if (!b) return;
  S.plan.refs.splice(+b.dataset.delRef, 1);
  applyAlignment();
});

// ═══════════════════════════════════════════════
//  가상 인원 (시연용) — 실제 휴대폰과 같은 WebSocket 경로로 보고
// ═══════════════════════════════════════════════

class SimClient {
  constructor(name, i, role, equipment) {
    const e = docExtent();
    this.name = name; this.id = `sim_${role}_${i}`; this.role = role; this.equipment = equipment;
    const m = equipment && S.markers.find(mm => mm.id === equipment);
    this.x = m ? m.x : e.minX + e.w * (0.15 + 0.7 * Math.random());
    this.y = m ? m.y : e.minY + e.h * (0.15 + 0.7 * Math.random());
    this.home = { x: this.x, y: this.y };
    this.heading = m ? m.heading || 0 : 0;
    this.tracker = new SafetyTracker(); this.leg = 0;
    const q = `id=${this.id}&name=${encodeURIComponent(name)}&role=${role}&sim=1&key=${encodeURIComponent(managerKey())}${equipment ? '&equipment=' + equipment : ''}`;
    this.ws = new WebSocket(wsUrl(`/ws/p/${S.project.id}/client?${q}`));
    this.timer = setInterval(() => this.step(), 1000);
  }
  pickTarget() {
    const e = docExtent(), field = getRiskField();
    this.leg++;
    if (this.role === 'operator') {   // 장비: 원래 위치 주변 ±12m 를 천천히 왕복
      this.target = { x: this.home.x + (Math.random() - 0.5) * 24, y: this.home.y + (Math.random() - 0.5) * 24 };
    } else if (field.equipments.length && this.leg % 4 === 0) {
      const eq = field.equipments[Math.floor(Math.random() * field.equipments.length)];
      this.target = { x: eq.xc + (Math.random() - 0.5) * 6, y: eq.yc + (Math.random() - 0.5) * 6 };
    } else this.target = { x: e.minX + e.w * (0.08 + 0.84 * Math.random()), y: e.minY + e.h * (0.08 + 0.84 * Math.random()) };
  }
  step() {
    if (!this.target || Math.hypot(this.target.x - this.x, this.target.y - this.y) < 1) this.pickTarget();
    const sp = this.role === 'operator' ? 0.8 : 1.4;   // m/s
    const dx = this.target.x - this.x, dy = this.target.y - this.y, d = Math.hypot(dx, dy), k = Math.min(1, sp / d);
    this.x += dx * k + (Math.random() - 0.5) * 0.3; this.y += dy * k + (Math.random() - 0.5) * 0.3;
    if (d > 0.5) this.heading = Math.atan2(dy, dx);
    const F = getFrame(), ll = F ? F.toLatLon(this.x, this.y) : {};
    const msg = { type: 'pos', x: this.x, y: this.y, lat: ll.lat ?? null, lon: ll.lon ?? null, sigma: 0.5, speed: sp };
    if (this.role === 'operator') {
      msg.heading = headingToBearing(this.heading);
      // 내 장비 위험 반경 안에 있는 작업자
      const m = S.markers.find(mm => mm.id === this.equipment);
      if (m) {
        const eq = createEquipment({ ...m, x: this.x, y: this.y, heading: this.heading }, S.siteEnvironment);
        msg.intrusions = [...PRJ.clients.values()].filter(c => c.role !== 'operator' && c.online !== false && c.x != null && ['full', 'red', 'orange'].includes(eq.zoneAt(c.x, c.y))).map(c => c.id);
      }
      msg.level = 'safe';
    } else {
      const a = assessSafety(getRiskField(), this.x, this.y, 0.5);
      this.tracker.update(a.level);
      if (this.tracker.level === 'danger' && !this.leaving) { this.leaving = true; setTimeout(() => { this.pickTarget(); this.leaving = false; }, 4000); }
      Object.assign(msg, { risk: a.risk, level: this.tracker.level, nearest_m: a.nearestDangerM, source: a.source });
    }
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
  stop() { clearInterval(this.timer); try { this.ws.close(); } catch (e) { /* noop */ } monSend({ type: 'remove', id: this.id }); }
}

function stopSims() { PRJ.sims.forEach(s => s.stop()); PRJ.sims = []; S.live = {}; invalidateRisk(); renderMonitor(); }

$('simWorkersBtn').addEventListener('click', async () => {
  if (PRJ.sims.length) { stopSims(); requestRender(); return; }
  if (!S.project.id || !managerKey()) { toast('가상 인원은 서버 프로젝트에서 실행됩니다. 「새 프로젝트」를 서버에 만드세요 (샘플 현장도 가능).', 'warn', { duration: 6000 }); return; }
  if (!PRJ.connected) { monConnect(); toast('서버에 연결 중입니다. 잠시 후 다시 누르세요.', 'info'); return; }
  const movable = S.markers.find(m => m.isEquipment && ['excavator', 'mobileCrane', 'concretePumpCar'].includes(m.type));
  PRJ.sims = ['가상 A', '가상 B', '가상 C'].map((n, i) => new SimClient(n, i, 'worker'));
  if (movable) PRJ.sims.push(new SimClient(`가상 운전원 (${movable.label})`, 0, 'operator', movable.id));
  toast(`가상 작업자 3명${movable ? `과 ${movable.label} 운전원 1명` : ''}이 투입되었습니다.\n장비가 움직이면 위험 반경도 함께 움직입니다.`, 'info', { duration: 6000 });
  renderMonitor();
});

// ── 초기화 ──
setTimeout(() => { monConnect(); renderProject(); renderMonitor(); }, 1200);
