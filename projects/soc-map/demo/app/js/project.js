/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 관리자: 공사 프로젝트 · 도면 정합 · 현장 인원 실시간 모니터링
 *
 *  프로젝트 = GPS 원점이 정해진 공사 현장. 서버에 등록하면 참여 코드(QR)로 휴대폰이 합류한다.
 *  관리자 키는 이 브라우저(localStorage)에만 보관하고 서버에는 해시만 있다.
 *  v14: 휴대폰 앱 2종 — 근로자 앱(/worker, 참여 코드 QR) · 관리감독자 앱(/supervisor, 관리자 키 QR)
 *       대피 장소·목적지(places), 근로자 앱 정책(policy), 정식 인증서 주소(터널) QR
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

/** v14.7 안드로이드 앱(APK) 받는 고정 주소 — 개인 홈페이지(GitHub Pages). 홈페이지 sync-demo.ps1 이 app/download.html·APK 를 복사 */
const APP_HOME_URL = 'https://kimhoring.github.io/projects/soc-map/app/';
const APP_GO_URL = 'https://kimhoring.github.io/projects/soc-map/go/';   // v14.10 고정 초대 주소: 켜져 있는 서버로 넘겨 준다 (app/go.html)

const PRJ = {
  ws: null, connected: false, info: null,
  clients: new Map(), events: [], survey: [],
  sync: false, publishTimer: null, lastPlanSrc: undefined, siteVersion: 0, joinCode: null, gpsJoin: true,
  sims: [], audio: null, focusId: null, places: [], policy: {}, joinApp: 'worker',
};

/** v14.14 휴대폰 반영(동기화) 기억 — 현장마다 { v: 이 PC 가 마지막으로 보낸·받은 배치 버전, off: 사용자가 직접 끔 } */
const SyncMemo = {
  all() { try { return JSON.parse(localStorage.getItem('socmap.v14.sync') || '{}'); } catch (e) { return {}; } },
  get(pid) { return (pid && this.all()[pid]) || {}; },
  set(pid, patch) { if (!pid) return; try { const a = this.all(); a[pid] = { ...(a[pid] || {}), ...patch }; localStorage.setItem('socmap.v14.sync', JSON.stringify(a)); } catch (e) { /* noop */ } },
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
    let list = [];
    if (VWORLD.key) { try { list = await vworldSearch(q); } catch (e) { /* 아래 OSM 검색으로 */ } }   // 한국 주소는 브이월드가 정확
    if (!list.length) list = await geocodeAddress(q);
    $('prjAddrResults').innerHTML = list.length ? list.map((r, i) => `<button class="addr-item" data-i="${i}">${esc(r.name)}${r.kind ? ` <span class="label-sm">${esc(r.kind)}</span>` : ''}</button>`).join('') : '<div class="hint">결과가 없습니다. 도로명 주소나 지명을 바꿔 보세요.</div>';
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
  const id = S.backendOnline ? await registerServerProject(name, ll) : null;
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

/** 서버에 프로젝트를 등록하고 관리자 키를 저장한다 → 프로젝트 id (실패하면 null) */
async function registerServerProject(name, ll) {
  try {
    const r = await api('/api/projects', { method: 'POST', body: { name, lat: ll.lat, lon: ll.lon }, manager: false });
    KeyStore.set(r.project.id, r.manager_key); PRJ.joinCode = r.project.join_code; PRJ.gpsJoin = r.project.gps_join !== false;
    toast(`서버에 프로젝트를 만들었습니다.\n참여 코드: ${r.project.join_code}\n관리자 키는 이 브라우저에 저장됩니다. 다른 PC에서 관리하려면 「프로젝트 정보」에서 키를 확인하세요.`, 'success', { duration: 9000 });
    return r.project.id;
  } catch (e) { toast('서버 프로젝트 생성 실패: ' + e.message + '\n로컬 프로젝트로 만듭니다.', 'warn'); return null; }
}

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
  if (!S.backendOnline) { toast('서버가 꺼져 있습니다. SOC-MAP_노트북_실행.bat 으로 서버를 켜세요.', 'error'); return; }
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
      const dc = site.doc.plan.dimCheck, sc = (p) => ({ x: p.x * kx, y: p.y * ky });
      doc.plan = { ...site.doc.plan, ...site.phonePlan, refs: (site.doc.plan.refs || []).map(r => ({ ...r, px: sc(r.px) })),
        knownMpp: site.doc.plan.knownMpp ? site.doc.plan.knownMpp / kx : undefined, dimCheck: dc ? { ...dc, pa: sc(dc.pa), pb: sc(dc.pb) } : undefined };
    }
    await loadDocument(doc, planSrc);
    PRJ.joinCode = meta.join_code; PRJ.gpsJoin = meta.gps_join !== false; PRJ.sync = true; PRJ.lastPlanSrc = S.bgImageSrc;
    SyncMemo.set(pid, { v: site ? site.version : 0, off: false });
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
    ${S.project.id && key ? `<label class="row" style="cursor:pointer"><span>📍 GPS 위치로 합류 허용<br><small style="color:var(--muted)">현장 근처(배치 범위에서 50 m + 위치 오차) 휴대폰이 참여 코드 없이 현장을 찾아 합류</small></span><input type="checkbox" id="prjGpsJoin" ${PRJ.gpsJoin ? 'checked' : ''}></label>` : ''}
    ${S.project.id && key ? `<div class="label-sm" style="margin-top:6px">근로자 앱 정책 — 근로자는 바꿀 수 없습니다</div>
    <label class="row" style="cursor:pointer"><span>🔒 경보음·진동 잠금<br><small style="color:var(--muted)">근로자가 경보 소리·진동을 끌 수 없음</small></span><input type="checkbox" data-policy="alarm_locked" ${PRJ.policy.alarm_locked !== false ? 'checked' : ''}></label>
    <label class="row" style="cursor:pointer"><span>🎓 시연 모드 허용<br><small style="color:var(--muted)">GPS 대신 지도를 눌러 위치를 정하는 교육·발표용</small></span><input type="checkbox" data-policy="allow_sim" ${PRJ.policy.allow_sim ? 'checked' : ''}></label>` : ''}
    ${S.project.id && key ? '<button class="btn" id="prjNewCode">참여 코드 새로 발급 (기존 코드 무효화)</button>' : ''}`;
  openModal('prjInfoModal');
  const gj = $('prjGpsJoin');
  if (gj) gj.onchange = async () => {
    try {
      const m = await api(`/api/projects/${S.project.id}`, { method: 'PATCH', body: { gps_join: gj.checked } });
      PRJ.gpsJoin = m.gps_join !== false;
      toast(PRJ.gpsJoin ? 'GPS 위치로 합류를 허용했습니다.' : 'GPS 합류를 껐습니다. 참여 코드로만 들어올 수 있습니다.', 'success');
    } catch (e) { gj.checked = PRJ.gpsJoin; toast('설정을 바꾸지 못했습니다: ' + e.message, 'error'); }
  };
  $('prjInfoBody').querySelectorAll('[data-policy]').forEach(cb => {
    cb.onchange = async () => {
      try { const m = await api(`/api/projects/${S.project.id}`, { method: 'PATCH', body: { policy: { [cb.dataset.policy]: cb.checked } } }); PRJ.policy = m.policy || PRJ.policy; toast('근로자 앱에 바로 적용했습니다.', 'success'); }
      catch (e) { cb.checked = !cb.checked; toast('설정을 바꾸지 못했습니다: ' + e.message, 'error'); }
    };
  });
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
    SyncMemo.set(S.project.id, { v: r.version });
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
onDocChanged = (opts) => { _prevDocChanged(opts); schedulePublish(); warnNoSync(); if (S.mode === 'align') renderModeUI(); };

/**
 * v14.14 이전 작업이 자동 복원된 뒤(노트북 서버를 다시 켰을 때)에도 휴대폰에 실시간 반영.
 * 전에는 「새 프로젝트」·「서버 프로젝트 열기」 때만 동기화가 켜져서, 다시 켠 뒤 추가한 장비가 휴대폰에 가지 않았다.
 *  - 사용자가 직접 끈 현장은 그대로 둔다
 *  - 이 PC 가 마지막으로 본 버전보다 서버가 새것이면(다른 PC 가 그 뒤에 바꿈) 덮어쓰지 않고 묻는다
 */
async function autoSync() {
  const pid = S.project.id, memo = SyncMemo.get(pid);
  if (!pid || !managerKey() || memo.off || PRJ.sync) return;
  let srv = null;
  try { srv = await api(`/api/projects/${pid}/site`); } catch (e) { /* 아직 공유 전 */ }
  if (pid !== S.project.id || PRJ.sync) return;
  if (srv && memo.v && srv.version > memo.v) {
    toast(`다른 PC가 이 현장 배치를 바꿨습니다(서버 v${srv.version}, 이 PC v${memo.v}). 덮어쓰지 않도록 휴대폰 반영을 멈췄습니다.`, 'warn',
      { duration: 20000, action: { label: '서버 배치 불러오기', fn: () => openServerProject(pid) } });
    renderProject();
    return;
  }
  PRJ.sync = true;
  await publishSite(true);
  if (PRJ.siteVersion) toast('📱 휴대폰과 실시간 연동 중 — 장비·위험 구역을 바꾸면 바로 반영됩니다.', 'success');
}
/** 휴대폰 반영이 꺼진 채로 배치를 바꾸면 한 번 알린다 */
function warnNoSync() {
  if (PRJ.sync || !S.project.id || !PRJ.connected || !managerKey() || PRJ.warnedNoSync) return;
  PRJ.warnedNoSync = true;
  toast('휴대폰 반영(실시간 동기화)이 꺼져 있어 이 변경은 휴대폰에 가지 않습니다.', 'warn',
    { duration: 12000, action: { label: '켜기', fn: () => { const t = $('syncToggle'); t.checked = true; t.dispatchEvent(new Event('change')); } } });
}

$('syncToggle').addEventListener('change', async e => {
  if (e.target.checked) {
    if (!S.project.id) { e.target.checked = false; toast('서버 프로젝트에서만 동기화할 수 있습니다. 「새 프로젝트」를 서버에 만들거나 「서버 프로젝트」를 여세요.', 'warn'); return; }
    PRJ.sync = true; SyncMemo.set(S.project.id, { off: false }); monBeep(660, 0.05); await publishSite(true);
  } else { PRJ.sync = false; SyncMemo.set(S.project.id, { off: true }); }
  renderProject();
});

// ═══════════════════════════════════════════════
//  실시간 연결
// ═══════════════════════════════════════════════

function monReconnect() {
  if (PRJ.ws) { PRJ.ws.onclose = null; try { PRJ.ws.close(); } catch (e) { /* noop */ } }
  PRJ.ws = null; PRJ.connected = false;
  PRJ.clients = new Map(); PRJ.events = []; PRJ.survey = []; PRJ.places = []; S.live = {}; invalidateRisk();
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
    try { const m = await api(`/api/projects/${S.project.id}`); PRJ.joinCode = m.join_code; PRJ.gpsJoin = m.gps_join !== false; PRJ.policy = m.policy || {}; } catch (e) { /* noop */ }
    if (PRJ.sync) publishSite(true); else autoSync();
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
      PRJ.places = msg.places || []; PRJ.policy = msg.policy || PRJ.policy;
      PRJ.clients.forEach(updateLive);
      if (msg.weather) wxFromServer(msg.weather);
      break;
    case 'client': PRJ.clients.set(msg.client.id, msg.client); updateLive(msg.client); break;
    case 'left': PRJ.clients.delete(msg.id); break;
    case 'weather': wxFromServer(msg.weather); break;
    case 'event':
      PRJ.events.unshift(msg.event); PRJ.events = PRJ.events.slice(0, 150);
      onMonitorEvent(msg.event);
      break;
    case 'ack': for (const ev of PRJ.events) if (ev.id === msg.event_id) ev.acked = true; updateAlertState(); break;
    case 'survey': PRJ.survey = msg.survey; if (S.mode === 'align') renderModeUI(); break;
    case 'places': PRJ.places = msg.places || []; break;
    case 'policy': PRJ.policy = msg.policy || PRJ.policy; break;
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

/** 부드러운 사인파 (앱 알림음 크기) */
function monTone(freq, dur, when = 0, vol = 0.12) {
  try {
    PRJ.audio = PRJ.audio || new (window.AudioContext || window.webkitAudioContext)();
    const a = PRJ.audio, t = a.currentTime + when, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* noop */ }
}
/** SOS 사이렌 약 2.8초: 700↔1050 Hz 로 오르내리는 사인파, 너무 크지 않게 */
function monSiren() {
  try {
    PRJ.audio = PRJ.audio || new (window.AudioContext || window.webkitAudioContext)();
    const a = PRJ.audio, t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    for (let i = 0; i < 4; i++) { o.frequency.setValueAtTime(700, t + i * 0.7); o.frequency.linearRampToValueAtTime(1050, t + i * 0.7 + 0.35); o.frequency.linearRampToValueAtTime(700, t + i * 0.7 + 0.7); }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.12); g.gain.setValueAtTime(0.16, t + 2.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 2.85);
  } catch (e) { /* noop */ }
}
const unackedSos = () => PRJ.events.filter(e => e.kind === 'sos' && !e.acked);
function desktopNotify(title, body, tag, sticky) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, tag, requireInteraction: sticky }); } catch (e) { /* noop */ }
}

/** 알림 단계: SOS = 위치 설명 + 사이렌(작게, 확인 전까지 20초마다), 그 밖의 긴급 = 알림음 + 알림, 접근 경고 = 소리 없는 알림 */
function onMonitorEvent(ev) {
  const locate = ev.x != null ? { label: '위치 보기', fn: () => centerOn(ev.x, ev.y, fitScale() * 3) } : null;
  if (ev.kind === 'sos') {
    monSiren();
    toast(ev.text, 'error', { duration: 20000, action: locate });
    desktopNotify(`🆘 긴급 호출 — ${ev.name || '근로자'}`, ev.location ? `📍 ${ev.location}` : ev.text, ev.id, true);
    if (ev.x != null) centerOn(ev.x, ev.y, fitScale() * 2);
  } else if (ev.severity === 'critical') {
    monTone(988, 0.16); monTone(1319, 0.24, 0.14);
    toast(ev.text, 'error', { duration: 8000, action: locate });
    desktopNotify('SOC-MAP 안전 알림', ev.text, ev.id, false);
  } else if (ev.severity === 'warning') {
    toast(ev.text, 'warn', { duration: 5000 });
  }
  updateAlertState();
}
setInterval(() => { if (unackedSos().length) monSiren(); }, 20000);   // 확인할 때까지 다시 알림
function updateAlertState() {
  const n = PRJ.events.filter(e => e.severity === 'critical' && !e.acked).length, sos = unackedSos().length;
  stage.classList.toggle('alerting', sos > 0);   // 붉은 테두리는 SOS 만
  $('bellCount').hidden = !n; $('bellCount').textContent = n;
  $('alertBell').classList.toggle('ringing', sos > 0);
}
function ackAll() {
  for (const ev of PRJ.events) if (ev.severity === 'critical' && !ev.acked) { monSend({ type: 'ack', event_id: ev.id }); ev.acked = true; }
  updateAlertState(); renderMonitor();
}

// ═══════════════════════════════════════════════
//  사이드바 렌더
// ═══════════════════════════════════════════════

function serverBase(https) {
  const info = PRJ.info;
  if (info && info.public_url && info.tunnel_ready !== false) return info.public_url;   // 터널 등 정식 인증서 주소 (v14.12 실제로 응답할 때만)
  const ip = (info && info.lan && info.lan[0]) || new URL(BACKEND_URL).hostname;
  if (https && info && info.https_port) return `https://${ip}:${info.https_port}`;
  return `http://${ip}:${(info && info.http_port) || new URL(BACKEND_URL).port || 8000}`;
}

function renderProject() {
  const P = S.project, o = P.origin;
  $('prjName').textContent = P.name || '새 현장';
  $('prjLoc').innerHTML = o ? `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}` : '<span style="color:var(--warn)">위치 미지정</span>';
  $('joinEmpty').hidden = !!(P.id && PRJ.connected && PRJ.joinCode);
  const ready = S.backendOnline && !P.id;
  $('joinEmptyText').textContent = !S.backendOnline ? '서버가 꺼져 있습니다. SOC-MAP_노트북_실행.bat 으로 켜 주세요.'
    : P.id ? '서버에 연결하는 중…' : o ? '버튼을 누르면 이 현장에 휴대폰을 연결할 수 있습니다.' : '현장 위치를 정하면 휴대폰을 연결할 수 있습니다.';
  $('joinStartBtn').hidden = !ready;
  $('joinStartBtn').textContent = o ? '📡 휴대폰 연결 시작' : '📍 현장 위치 정하기';
  $('prjBadge').textContent = P.id ? '서버' : '로컬';
  $('prjBadge').className = 'badge ' + (P.id ? 'badge-ok' : 'badge-muted');
  $('prjLocBtn').hidden = !!P.id;
  $('syncToggle').checked = PRJ.sync && !!P.id;
  $('syncRow').hidden = !P.id;
  $('prjStatus').innerHTML = !P.id ? (S.backendOnline ? '로컬 프로젝트입니다. 휴대폰 연동은 「새 프로젝트」로 서버에 등록하세요.' : '서버 꺼짐 · 로컬 작업')
    : !managerKey() ? '<span style="color:var(--warn)">관리자 키 없음 — 보기 전용</span>'
    : !PRJ.connected ? '서버 연결 중…'
    : `실시간 연결됨 · 배치 v${PRJ.siteVersion || '-'}${PRJ.sync ? ' · 📱 휴대폰에 바로 반영' : ' · <span style="color:var(--warn)">휴대폰 반영 꺼짐</span>'}`;

  const card = $('joinCard');
  $('joinSeg').hidden = !(P.id && PRJ.connected && PRJ.joinCode);
  if (!P.id || !PRJ.connected || !PRJ.joinCode) { card.hidden = true; $('joinCopyBtn').hidden = true; $('joinSteps').hidden = true; $('joinNote').textContent = ''; return; }
  card.hidden = false;
  const hasHttps = PRJ.info && PRJ.info.https_port, pub = PRJ.info && PRJ.info.public_url && PRJ.info.tunnel_ready !== false;
  const opening = PRJ.info && PRJ.info.public_url && PRJ.info.tunnel_ready === false;   // 터널 주소는 나왔지만 아직 응답 없음
  const board = pub && PRJ.info.directory === 'ok', boardFailed = pub && PRJ.info.directory === 'failed';
  const sup = PRJ.joinApp === 'supervisor', dl = PRJ.joinApp === 'download', key = managerKey();
  const url = dl ? `${serverBase(true)}/worker.apk`   // v14.11 찍으면 바로 앱 파일 (홈페이지 안내 페이지는 노트북이 꺼져 있을 때만)
    : sup ? `${serverBase(true)}/supervisor#p=${encodeURIComponent(S.project.id)}&k=${encodeURIComponent(key || '')}` : joinLink();
  const local = /^(localhost|127\.)/.test(new URL(url).hostname);
  $('joinCodeLabel').textContent = dl ? '안드로이드 앱 파일 바로 받기' : sup ? '로그인 QR' : '현장 참여 코드';
  $('joinCode').textContent = dl ? '앱 받기' : sup ? '관리감독자' : PRJ.joinCode;
  $('joinCode').style.letterSpacing = sup || dl ? '0' : '';
  $('joinUrl').innerHTML = sup ? '<span class="hint">⚠️ 이 QR에는 관리자 키가 들어 있습니다. 관리감독자에게만 보여 주세요.</span>' : `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
  $('joinSteps').hidden = sup || dl;
  $('joinCopyBtn').hidden = sup || local;   // 관리감독자 QR 에는 관리자 키가 들어 있어 메시지로 보내지 않는다
  $('joinCopyBtn').dataset.label = dl ? '📋 앱 설치 메시지 복사' : '📋 초대 메시지 복사';
  if (!$('joinCopyBtn').textContent.startsWith('✅')) $('joinCopyBtn').textContent = $('joinCopyBtn').dataset.label;
  $('joinNote').innerHTML = dl ? `📲 휴대폰 카메라로 찍으면 <b>바로 앱 파일이 내려받아집니다</b> → 알림에서 열기 → 설치. 카톡에는 「앱 설치 메시지 복사」로 <b>링크</b>를 보내세요(카톡은 앱 파일 자체는 보내지 못합니다).<br>🦺 관리감독자 앱: <a href="${esc(serverBase(true))}/supervisor.apk" target="_blank" rel="noopener">${esc(serverBase(true))}/supervisor.apk</a><br><span class="hint">노트북이 꺼져 있을 때는 홈페이지 <a href="${esc(APP_HOME_URL)}" target="_blank" rel="noopener">앱 받기 페이지</a>. 설치할 때 안드로이드가 「출처를 알 수 없는 앱」·Play 프로텍트 확인을 한 번씩 묻습니다(앱스토어를 거치지 않는 앱이라서).</span>`
    : (local ? '⚠️ 서버가 이 PC에서만 열려 있습니다. 휴대폰 연동은 <b>SOC-MAP_노트북_실행.bat</b>으로 서버를 켜세요.'
    : opening ? '⏳ 인터넷 주소를 여는 중입니다(보통 1분 안팎). 지금 QR은 같은 와이파이에서만 됩니다 — 준비되면 저절로 바뀝니다.'
    : boardFailed ? '⚠️ 주소 안내판을 고치지 못했습니다. 지금은 접속되지만 노트북을 다시 켜면 휴대폰이 따라오지 못합니다. 노트북에서 <b>gh auth status</b>로 GitHub 로그인을 확인하세요.'
    : board && !sup && fixedLink() ? '✅ <b>이 QR·초대 링크는 바뀌지 않습니다.</b> 출력해서 현장에 붙여 두어도 됩니다. 노트북을 다시 켜도 앱은 저절로 다시 연결됩니다.'
    : board ? '✅ 노트북을 다시 켜도 앱은 저절로 다시 연결됩니다. 새 휴대폰은 앱에서 참여 코드만 넣으면 됩니다.'
    : pub ? '✅ 어디서나 접속되는 주소입니다. 노트북을 다시 켜면 주소가 바뀌니 그때는 QR·초대 링크를 새로 보내 주세요. 참여 코드와 휴대폰에 저장된 이름은 그대로입니다.'
    : hasHttps ? '같은 와이파이에서 QR을 찍으세요. 처음에 “안전하지 않음” 경고가 나오면 <b>고급 → 계속</b>(자체 인증서). 인터넷 주소를 만드는 중이면 몇 초 뒤 QR이 저절로 바뀝니다.'
    : '⚠️ HTTPS 가 꺼져 있어 휴대폰 GPS가 막힙니다. <b>SOC-MAP_노트북_실행.bat</b>으로 서버를 켜세요(시연 모드는 가능).')
    + (sup ? '<br>관리감독자 앱: 실시간 인원 위치 · 위험 진입 알림 · 대피 지시 · 근로자 앱 정책' : '');
  const qr = $('qrBox');
  if (qr.dataset.url !== url) {
    qr.dataset.url = url; qr.innerHTML = '';
    if (window.QRCode) new QRCode(qr, { text: url, width: 128, height: 128, correctLevel: QRCode.CorrectLevel.M });
    else qr.innerHTML = '<span class="hint">QR 표시에는 인터넷이 필요합니다</span>';
  }
}

// v14.9 초대 메시지: 카카오톡 단체방에 붙여 넣으면 QR 없이 들어온다
function inviteText() {
  if (PRJ.joinApp === 'download') return `[SOC-MAP] 앱 설치 (안드로이드)\n링크를 누르면 앱 파일이 바로 내려받아집니다 → 열기 → 설치\n👷 근로자: ${serverBase(true)}/worker.apk\n🦺 관리감독자: ${serverBase(true)}/supervisor.apk`;
  const board = PRJ.info && PRJ.info.directory === 'ok', code = PRJ.joinCode;
  return [`[SOC-MAP] ${S.project.name || '현장'} 합류 안내`,
    `① 안드로이드 앱 설치(처음 한 번만, 누르면 바로 내려받기): ${serverBase(true)}/worker.apk`,
    board ? `② 앱을 열고 참여 코드 ${code} 입력 → 이름 → 합류` : `② 아래 링크를 누르고 이름만 넣으면 합류 (참여 코드 ${code})`,
    board ? `앱 없이 바로 쓰기(아이폰 등): ${joinLink()}` : joinLink()].join('\n');
}
/** 안내판이 동작하고 고정 초대 페이지가 홈페이지에 올라가 있으면 바뀌지 않는 주소를 쓴다 */
function fixedLink() { return !!(PRJ.goReady && PRJ.info && PRJ.info.public_url && PRJ.info.tunnel_ready !== false && PRJ.info.directory === 'ok'); }
function joinLink() { return fixedLink() ? `${APP_GO_URL}?c=${PRJ.joinCode}` : `${serverBase(true)}/j/${PRJ.joinCode}`; }
async function checkGoPage() {
  if (PRJ.goReady) return;
  try { PRJ.goReady = (await fetch(APP_GO_URL + 'directory.js', { method: 'HEAD', cache: 'no-store' })).ok; } catch (e) { PRJ.goReady = false; }
  renderProject();
}
$('joinCopyBtn').addEventListener('click', async () => {
  const btn = $('joinCopyBtn'), text = inviteText();
  try { await navigator.clipboard.writeText(text); }
  catch (e) {   // http 로 연 화면 등
    const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  btn.textContent = '✅ 복사했습니다 — 카카오톡에 붙여 넣으세요';   // 알림 줄은 이 창 뒤에 가려진다
  setTimeout(() => { btn.textContent = btn.dataset.label || '📋 초대 메시지 복사'; }, 2500);
});

// 프로젝트를 따로 찾아가 만들지 않아도 이 창에서 바로 시작
$('joinStartBtn').addEventListener('click', async () => {
  const P = S.project;
  if (!P.origin) { closeModal('joinModal'); openProjectModal('new'); return; }
  const id = await registerServerProject(P.name || '새 현장', P.origin);
  if (!id) return;
  S.project = { ...P, id, name: P.name || '새 현장' };
  changed(); monReconnect(); renderProject();
  PRJ.sync = true; publishSite(true);
});

// 터널 주소는 서버가 켜지고 몇 초 뒤에 나온다 → 이 창이 열려 있는 동안 QR 을 저절로 바꾼다
let _infoTimer = null;
async function refreshServerInfo() {
  try { PRJ.info = await api('/api/server/info', { manager: false }); renderProject(); } catch (e) { /* 서버 꺼짐 */ }
}
function watchServerInfo() {
  clearInterval(_infoTimer);
  refreshServerInfo();
  checkGoPage();
  _infoTimer = setInterval(() => {
    if ($('joinModal').hidden) clearInterval(_infoTimer);
    else if (!(PRJ.info && PRJ.info.public_url && PRJ.info.tunnel_ready !== false && PRJ.info.directory)) refreshServerInfo();
  }, 3000);
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
  $('placeList').innerHTML = PRJ.places.length ? PRJ.places.map(pl => `<div class="list-item" style="--c:${pl.kind === 'assembly' ? '#10b981' : '#8b5cf6'}" data-place="${esc(pl.id)}">
      <span>${pl.kind === 'assembly' ? '🟢' : '📍'} ${esc(pl.name)} <span class="label-sm">${pl.kind === 'assembly' ? '대피 장소' : '목적지'}</span></span>
      <button class="icon-btn" data-place-del title="삭제">✕</button></div>`).join('')
    : `<div class="hint">${S.project.id ? '등록된 장소가 없습니다.' : '서버 프로젝트에서 쓸 수 있습니다.'}</div>`;
}
$('placeAddBtn').addEventListener('click', () => {
  if (!S.project.id || !managerKey() || !PRJ.connected) { toast('대피 장소는 서버 프로젝트에 연결된 상태에서 추가할 수 있습니다.', 'warn'); return; }
  pickOnMap('대피 장소(집결지)·목적지로 쓸 지점을 지도에서 클릭하세요', async ip => {
    const name = prompt('장소 이름 (예: 정문 집결지)\n목적지(대피 장소가 아님)로 등록하려면 이름 앞에 # 을 붙이세요.', '');
    if (name === null) return;
    const dest = name.trim().startsWith('#');
    try { await api(`/api/projects/${S.project.id}/places`, { method: 'POST', body: { kind: dest ? 'dest' : 'assembly', name: name.trim().replace(/^#\s*/, ''), x: ip.x, y: ip.y } }); toast('장소를 추가했습니다. 근로자·관리감독자 앱에 바로 표시됩니다.', 'success'); }
    catch (e) { toast('장소를 추가하지 못했습니다: ' + e.message, 'error'); }
  });
});
$('placeList').addEventListener('click', async e => {
  const item = e.target.closest('[data-place]'); if (!item) return;
  const pl = PRJ.places.find(x => x.id === item.dataset.place); if (!pl) return;
  if (e.target.closest('[data-place-del]')) {
    if (!confirm(`「${pl.name}」을(를) 지울까요?`)) return;
    try { await api(`/api/projects/${S.project.id}/places/${pl.id}`, { method: 'DELETE' }); } catch (err) { toast(err.message, 'error'); }
  } else centerOn(pl.x, pl.y, fitScale() * 2.5);
});
document.querySelectorAll('input[name="joinApp"]').forEach(r => r.addEventListener('change', () => { PRJ.joinApp = r.value; renderProject(); }));
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
      ctx.fillStyle = r.check ? '#0891b2' : '#a855f7'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = px(2); ctx.stroke();
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
  // 대피 장소 · 목적지
  for (const pl of PRJ.places) {
    const evac = pl.kind === 'assembly';
    ctx.beginPath(); ctx.arc(pl.x, pl.y, px(12), 0, Math.PI * 2);
    ctx.fillStyle = evac ? '#059669' : '#7c3aed'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = px(2.5); ctx.stroke();
    label(evac ? '대피' : '📍', pl.x, pl.y, px(evac ? 9.5 : 11), '#fff');
    label(pl.name, pl.x, pl.y + px(20), px(11), evac ? '#6ee7b7' : '#ddd6fe');
  }
  // 치수 확인 선 (측정 중이면 노랑, 정합 화면에서는 저장된 치수를 초록으로)
  const dl = S.dimLine && S.dimLine.a ? S.dimLine : (S.mode === 'align' && S.plan.dimCheck && T ? { a: T.apply(S.plan.dimCheck.pa), b: T.apply(S.plan.dimCheck.pb), real: S.plan.dimCheck.real } : null);
  if (dl) {
    const col = dl.real ? '#4ade80' : '#fde047';
    ctx.beginPath(); ctx.arc(dl.a.x, dl.a.y, px(4), 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    if (dl.b) {
      ctx.beginPath(); ctx.moveTo(dl.a.x, dl.a.y); ctx.lineTo(dl.b.x, dl.b.y); ctx.strokeStyle = col; ctx.lineWidth = px(2.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(dl.b.x, dl.b.y, px(4), 0, Math.PI * 2); ctx.fill();
      label(dl.real ? `치수 ${dl.real} m` : `${Math.hypot(dl.b.x - dl.a.x, dl.b.y - dl.a.y).toFixed(2)} m`, (dl.a.x + dl.b.x) / 2, (dl.a.y + dl.b.y) / 2 - px(12), px(11), col);
    }
  }
  // 그림자 높이 측정 선
  if (S.shadow && S.shadow.a) {
    const a = S.shadow.a, b = S.shadow.b;
    ctx.beginPath(); ctx.arc(a.x, a.y, px(5), 0, Math.PI * 2); ctx.fillStyle = '#fde047'; ctx.fill();
    if (b) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = '#fde047'; ctx.lineWidth = px(3); ctx.setLineDash([px(6), px(4)]); ctx.stroke(); ctx.setLineDash([]);
      label(`그림자 ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(1)} m`, (a.x + b.x) / 2, (a.y + b.y) / 2 - px(12), px(11), '#fde047');
    }
  }
  // 근로자 SOS 위치 (확인 전까지 퍼지는 원)
  for (const ev of unackedSos()) {
    if (ev.x == null) continue;
    const k = (performance.now() / 1400) % 1;
    for (const r of [k, (k + 0.5) % 1]) { ctx.beginPath(); ctx.arc(ev.x, ev.y, px(16 + r * 40), 0, Math.PI * 2); ctx.strokeStyle = `rgba(239,68,68,${0.85 * (1 - r)})`; ctx.lineWidth = px(3); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(ev.x, ev.y, px(14), 0, Math.PI * 2); ctx.fillStyle = '#dc2626'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = px(3); ctx.stroke();
    label('SOS', ev.x, ev.y, px(9.5), '#fff');
    label(`${ev.name || ''}${ev.location ? ' · ' + ev.location : ''}`, ev.x, ev.y - px(26), px(11), '#fecaca');
  }
  // 현장 인원 (보기 막대 「👷 인원」으로 켜고 끔)
  const t = performance.now() / 1000;
  if (S.layers.people !== false) for (const c of PRJ.clients.values()) {
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
  if (S.layers.people !== false) for (const [id, lv] of Object.entries(S.live)) {
    const m = S.markers.find(mm => mm.id === id); if (!m) continue;
    ctx.beginPath(); ctx.arc(lv.x, lv.y, px(19), 0, Math.PI * 2);
    ctx.strokeStyle = lv.online ? '#f59e0b' : '#64748b'; ctx.lineWidth = px(2.5); ctx.setLineDash([px(4), px(3)]); ctx.stroke(); ctx.setLineDash([]);
    label(`🚜 ${lv.by}${lv.online ? '' : ' (마지막 위치)'}`, lv.x, lv.y + px(30), px(10.5), '#fcd34d');
  }
}
setInterval(() => {
  if (unackedSos().some(e => e.x != null)) { requestRender(); return; }
  for (const c of PRJ.clients.values()) if (c.level === 'danger' && c.online !== false) { requestRender(); break; }
}, 60);

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
  fillCrsOptions();
  if (r && r.tm && KOREA_CRS[r.tm.code]) { setAlignCrs(String(r.tm.code)); $('alignInput').value = `${r.tm.x}, ${r.tm.y}`; }
  else { setAlignCrs(r ? 'll' : _alignCrs); $('alignInput').value = r ? `${r.lat.toFixed(7)}, ${r.lon.toFixed(7)}` : ''; }
  previewAlign();
  $('alignCheck').checked = !!(r && r.check);
  $('alignDelete').hidden = !r;
  $('alignSurvey').innerHTML = PRJ.survey.length
    ? '<option value="">— 현장 측량점에서 선택 —</option>' + PRJ.survey.map(sp => `<option value="${esc(sp.id)}">${esc(sp.name)} (±${sp.estError.toFixed(1)}m, ${sp.n}회 평균${sp.by ? ' · ' + esc(sp.by) : ''})</option>`).join('')
    : '<option value="">현장 측량점 없음 (현장 앱 「📐 측량」으로 추가)</option>';
  $('alignMsg').textContent = '';
  openModal('alignModal');
}
$('alignSurvey').addEventListener('change', e => {
  const sp = PRJ.survey.find(x => x.id === e.target.value);
  if (sp) { setAlignCrs('ll'); $('alignInput').value = `${sp.lat.toFixed(7)}, ${sp.lon.toFixed(7)}`; previewAlign(); }
});

// ── 좌표 입력: 위경도 또는 한국 TM (측량 성과표 순서 X = 북, Y = 동) ──
let _alignCrs = 'll';
try { _alignCrs = localStorage.getItem('socmap.v14.alignCrs') || 'll'; } catch (e) { /* noop */ }
function fillCrsOptions() {
  const o = S.project.origin, sug = o ? suggestKoreaCrs(o.lon) : 5186;
  const codes = [sug, ...Object.keys(KOREA_CRS).map(Number).filter(c => c !== sug)];
  $('alignCrs').innerHTML = '<option value="ll">위도, 경도</option>' + codes.map(c => `<option value="${c}">${KOREA_CRS[c].label}${c === sug ? ' · 이 현장 권장' : ''}</option>`).join('');
}
function setAlignCrs(v) {
  if (![...$('alignCrs').options].some(o => o.value === v)) v = 'll';
  $('alignCrs').value = v;
  $('alignInput').placeholder = v === 'll' ? '위도, 경도 (예: 35.1760123, 126.9065123)' : 'X(북), Y(동) — 측량 성과표 순서 (예: 286437.847, 190604.380)';
}
/** 입력값 → 위경도. TM 은 X = 북, Y = 동 으로 읽고, 현장에서 20 km 넘게 떨어지는데 순서를 바꾸면 가까우면 바꿔 읽는다 */
function parseAlignInput() {
  const crs = $('alignCrs').value, F = getFrame();
  const dist = (ll) => (F ? Math.hypot(F.toLocal(ll.lat, ll.lon).x, F.toLocal(ll.lat, ll.lon).y) : 0);
  if (crs === 'll') { const ll = parseLatLon($('alignInput').value); return ll ? { ...ll, dist: dist(ll) } : null; }
  const nums = ($('alignInput').value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length < 2) return null;
  const [X, Y] = nums, code = +crs, a = tmInverse(Y, X, code), b = tmInverse(X, Y, code);
  const da = dist(a), db = dist(b), swapped = F && da > 20000 && db < da / 10;
  const ll = swapped ? b : a;
  return { lat: ll.lat, lon: ll.lon, tm: { code, x: swapped ? Y : X, y: swapped ? X : Y }, swapped, dist: swapped ? db : da };
}
function previewAlign() {
  const r = parseAlignInput(), fm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`);
  $('alignPreview').innerHTML = !r ? '' : `${r.tm ? `→ ${r.lat.toFixed(7)}, ${r.lon.toFixed(7)} · ` : ''}현장 원점에서 ${fm(r.dist)}`
    + (r.swapped ? ' · <b>X·Y 순서를 바꿔 읽었습니다</b> (성과표는 X = 북쪽 값이 먼저)' : '')
    + (r.dist > 5000 ? ' · <span style="color:var(--warn)">현장에서 너무 멉니다 — 좌표계(원점)·숫자를 확인하세요</span>' : '');
}
$('alignCrs').addEventListener('change', e => {
  _alignCrs = e.target.value; try { localStorage.setItem('socmap.v14.alignCrs', _alignCrs); } catch (err) { /* noop */ }
  setAlignCrs(_alignCrs); previewAlign();
});
$('alignInput').addEventListener('input', previewAlign);

/** 지적 경계점에 붙이기: 누른 곳 주변 필지 꼭짓점 중 화면 14 px(최소 1.5 m) 안에서 가장 가까운 점 */
async function snapToParcelVertex(ip) {
  const F = getFrame(), c = F.toLatLon(ip.x, ip.y), R = 40, dLat = R / 111320, dLon = R / (111320 * Math.cos(c.lat * D2R));
  const list = await vworldParcels(c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon);
  const tol = Math.max(1.5, 14 / getT().s);
  let best = null;
  for (const p of list) for (const ring of p.rings) for (const [lat, lon] of ring) {
    const q = F.toLocal(lat, lon), d = Math.hypot(q.x - ip.x, q.y - ip.y);
    if (d <= tol && (!best || d < best.d)) best = { d, lat, lon, addr: p.addr };
  }
  return best;
}

$('alignPick').addEventListener('click', () => {
  closeModal('alignModal');
  const prevOpacity = S.plan.opacity; S.plan.opacity = 0.25; requestRender();
  const snap = S.layers.cadastral && VWORLD.key;
  pickOnMap(snap ? '같은 지점을 지도에서 클릭하세요 — 지적 경계점 근처를 누르면 그 점에 붙습니다' : '같은 지점을 배경 지도(위성)에서 클릭하세요', async ip => {
    S.plan.opacity = prevOpacity;
    let ll = getFrame().toLatLon(ip.x, ip.y), msg = '위성 지도 자체에도 수 m 오차가 있을 수 있습니다. 정밀하게 하려면 도면의 TM 좌표나 현장 측량점을 쓰세요.';
    if (snap) {
      try {
        const sn = await snapToParcelVertex(ip);
        if (sn) { ll = { lat: sn.lat, lon: sn.lon }; msg = `📐 지적 경계점에 붙였습니다 — ${sn.addr || ''} (누른 곳에서 ${sn.d.toFixed(1)} m). 지적도도 지역에 따라 오차가 있으니 검증점으로 확인하세요.`; }
        else msg = '가까운 지적 경계점이 없어 누른 위치를 그대로 씁니다. 경계선 모서리를 더 확대해서 누르세요.';
      } catch (e) { msg = `지적 경계점을 가져오지 못했습니다(${e.message}). 누른 위치를 그대로 씁니다.`; }
    }
    setAlignCrs('ll'); $('alignInput').value = `${ll.lat.toFixed(7)}, ${ll.lon.toFixed(7)}`; previewAlign();
    $('alignMsg').textContent = msg;
    openModal('alignModal'); requestRender();
  });
});
$('alignSave').addEventListener('click', () => {
  const r = parseAlignInput();
  if (!r) { $('alignMsg').textContent = $('alignCrs').value === 'll' ? '위도, 경도를 입력하세요. 예: 35.1760123, 126.9065123' : 'X(북), Y(동) 두 값을 입력하세요. 예: 286437.847, 190604.380'; return; }
  const ll = { lat: r.lat, lon: r.lon, tm: r.tm };
  const check = $('alignCheck').checked || undefined;
  if (_alignEdit.idx != null) Object.assign(S.plan.refs[_alignEdit.idx], ll, { check });
  else S.plan.refs.push({ id: newId('g'), px: _alignEdit.px, ...ll, check });
  closeModal('alignModal');
  applyAlignment();
});
$('alignDelete').addEventListener('click', () => {
  S.plan.refs.splice(_alignEdit.idx, 1);
  closeModal('alignModal');
  applyAlignment();
});

/** 지금 기준점 (도면 px ↔ 현장 m) */
const alignRefsNow = (F) => S.plan.refs.map(r => ({ ...r, dst: F.toLocal(r.lat, r.lon) }));
const ALIGN_METHOD_LABEL = { translate: '이동만', fixedScale: '축척 고정 (회전·이동)', similarity: '닮음 (회전·축척)', affine: '아핀 (왜곡 보정)' };
const alignQuality = (e) => (e < 1 ? '매우 좋음' : e < 2 ? '좋음' : e < 5 ? '보통 — 기준점 재확인 권장' : '나쁨 — 잘못 찍은 점이 있을 수 있습니다');

/**
 * 기준점으로 도면 변환을 다시 계산하고, 도면 위에 그렸던 배치 요소(건물·도로·장비 등)도 같이 옮긴다.
 * 기준점 1개: 이동만 / 2~4개: 닮음 / 5개 이상: 아핀 (S.plan.alignMethod 로 고정 가능). 검증점은 계산에서 뺀다.
 * 정합 오차(S.plan.alignError)는 근로자 앱 경고 거리에 GPS 오차와 함께 반영된다: √(GPS² + 정합²)
 */
function applyAlignment() {
  const F = getFrame(), oldT = planTransform();
  if (!F || !oldT) return;
  const refs = alignRefsNow(F), fit = refs.filter(r => !r.check);
  let newT = null, st = null;
  if (fit.length >= 2) {
    const sol = solveAlignment(refs, S.plan.alignMethod || 'auto', S.plan.knownMpp);
    if (sol) { newT = sol.transform; st = sol; }
  } else if (fit.length === 1) {
    const r = fit[0], cur = oldT.apply(r.px), [a, b, c, d, e, f] = oldT.matrix;
    newT = makeTransform([a, b, c + r.dst.x - cur.x, d, e, f + r.dst.y - cur.y], [{ src: r.px, dst: r.dst }], 'translate');
    st = alignmentStats(newT, refs, ALIGN_PARAMS.translate);
  }
  if (!newT) { S.plan.alignError = null; changed(); renderModeUI(); return; }
  const moveLayout = $('alignMoveLayout') ? $('alignMoveLayout').checked : true;
  if (moveLayout) transformLayout(p => newT.apply(oldT.inverse(p)), (newT.rotation - oldT.rotation) * Math.PI / 180);
  S.plan.transform = newT.matrix;
  S.plan.alignError = st.error != null ? +st.error.toFixed(2) : null;
  changed(); renderModeUI(); requestRender();
  const q = st.error != null ? `정합 오차 ${st.error.toFixed(2)} m (${st.errorSource === 'check' ? '검증점' : '여유 관측으로 추정'})`
    : fit.length === 1 ? '1점: 위치만 맞춤 (축척·방향은 2점부터)' : '정합 오차는 아직 알 수 없음 — 기준점 1개 더 또는 검증점을 추가하세요';
  toast(`도면을 실제 위치에 맞췄습니다 · ${ALIGN_METHOD_LABEL[newT.method] || newT.method} · 1px = ${newT.scale.toFixed(4)} m · 회전 ${newT.rotation.toFixed(1)}°\n${q}`,
    st.error > 3 ? 'warn' : 'success', { duration: 7000 });
}

function alignModeOptions() {
  const T = planTransform(), F = getFrame();
  if (!F) return '<div class="alert warn">현장 위치가 지정되지 않았습니다. 🏗️ 프로젝트에서 위치를 먼저 지정하세요.</div>';
  if (!S.bgImage) return '<div class="alert warn">배치도가 없습니다. 배치도를 업로드한 뒤 정합하세요.</div>';
  const refs = alignRefsNow(F), fit = refs.filter(r => !r.check), nChk = refs.length - fit.length;
  const sol = fit.length >= 2 ? solveAlignment(refs, S.plan.alignMethod || 'auto', S.plan.knownMpp) : null;
  const method = sol ? sol.method : fit.length === 1 ? 'translate' : null;
  const st = alignmentStats(T, refs, ALIGN_PARAMS[method || 'translate']);
  const worst = st.residuals.length ? st.residuals.indexOf(Math.max(...st.residuals)) : -1;
  const why = !fit.length ? '기준점 없음 — 도면이 임시 위치(가정 축척)에 놓여 있습니다.'
    : fit.length === 1 ? '기준점 1개 — 위치만 맞춘 상태입니다. 축척·방향은 2개부터 맞춰집니다.'
    : st.dof <= 0 ? `${method === 'affine' ? '아핀 3점' : '기준점 2개'}은 항상 정확히 맞아 떨어져 <b>오차를 알 수 없습니다</b>. 기준점이나 검증점을 1개 더 추가하세요.` : '';
  const err = st.error != null
    ? `정합 오차 <b>${st.error.toFixed(2)} m</b> — ${alignQuality(st.error)}<br><span class="label-sm">${st.errorSource === 'check' ? `정합에 쓰지 않은 검증점 ${nChk}개의 실제 어긋남` : `기준점 ${fit.length}개의 여유 관측으로 추정 · 검증점을 넣으면 더 믿을 수 있습니다`}. 근로자 앱 경고 거리에 √(GPS 오차² + ${st.error.toFixed(1)}²)로 반영</span>`
    : why;
  const dc = S.plan.dimCheck;
  const dim = dc ? (() => { const m = Math.hypot(T.apply(dc.pb).x - T.apply(dc.pa).x, T.apply(dc.pb).y - T.apply(dc.pa).y), pct = (m / dc.real - 1) * 100;
    return `<div class="alert ${Math.abs(pct) > 2 ? 'warn' : 'info'}">📏 치수 확인: 도면 치수 ${dc.real} m ↔ 지금 축척 ${m.toFixed(2)} m (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</div>`; })() : '';
  return `<div class="hint">도면에서 <b>위치가 확실한 지점</b>(건물 모서리·출입구·측량 말뚝)을 클릭하고 실제 위치를 지정하세요. 서로 멀리 떨어진 <b>기준점 3~4개</b>에, 정합에 쓰지 않는 <b>검증점 2개 이상</b>을 더하면 실제 오차를 알 수 있습니다.</div>
    <div class="field-row"><span>변환 방식</span></div>
    <div class="seg seg-tight"><label><input type="radio" name="alignMethod" value="auto" ${!S.plan.alignMethod ? 'checked' : ''}>자동</label><label title="${S.plan.knownMpp ? '' : 'PDF 축척을 넣거나 치수로 축척을 확인하면 쓸 수 있습니다'}"><input type="radio" name="alignMethod" value="fixedScale" ${S.plan.alignMethod === 'fixedScale' ? 'checked' : ''} ${S.plan.knownMpp ? '' : 'disabled'}>축척 고정</label><label><input type="radio" name="alignMethod" value="similarity" ${S.plan.alignMethod === 'similarity' ? 'checked' : ''}>닮음</label><label><input type="radio" name="alignMethod" value="affine" ${S.plan.alignMethod === 'affine' ? 'checked' : ''}>아핀</label></div>
    <div class="label-sm">자동 = 도면 축척을 알면 축척 고정(회전·이동만 GPS로), 모르면 닮음(회전·축척), 기준점 5개 이상이면 아핀(스캔 왜곡 보정)<br>
      ${S.plan.knownMpp ? `알려진 도면 축척: 1px = ${S.plan.knownMpp.toFixed(4)} m (${esc(S.plan.knownMppSrc || '')})` : '도면 축척 모름 — PDF 축척(1/N)을 넣거나 「📏 치수로 축척 확인」을 하면 축척을 고정해 더 정확해집니다'}</div>
    <label class="row label-sm"><span>배치 요소도 도면과 함께 이동</span><input type="checkbox" id="alignMoveLayout" checked></label>
    <div class="list">${refs.map((r, i) => `<div class="list-item" style="--c:${i === worst && st.residuals[i] > 3 ? '#ef4444' : r.check ? '#0891b2' : '#a855f7'}">
      <span>${i + 1}. <b style="color:${r.check ? '#67e8f9' : '#d8b4fe'}">${r.check ? '검증점' : '기준점'}</b>${r.tm ? ' <span class="label-sm">TM</span>' : ''} <span class="label-sm">어긋남 ${st.residuals[i].toFixed(2)} m</span></span>
      <button class="icon-btn" data-toggle-check="${i}" title="${r.check ? '기준점으로 바꾸기' : '검증점으로 바꾸기'}">⇄</button><button class="icon-btn" data-del-ref="${i}" title="삭제">✕</button></div>`).join('')}</div>
    <div class="alert ${st.error != null && st.error < 2 ? 'info' : 'warn'}">${method ? ALIGN_METHOD_LABEL[method] : '정합 전'} · 1px = ${T.scale.toFixed(4)} m · 회전 ${T.rotation.toFixed(1)}°<br>기준점 ${fit.length}개 · 검증점 ${nChk}개<br>${err}</div>
    ${dim}
    <button class="btn" data-act="dimCheck" title="도면에 적힌 치수(예: 건물 길이)로 지금 축척이 맞는지 확인">📏 치수로 축척 확인</button>
    ${VWORLD.key ? `<label class="row label-sm" style="cursor:pointer"><span>🗺️ 연속지적도 겹쳐 보기 — 지도에서 찍을 때 지적 경계점에 붙음</span><input type="checkbox" data-align-cadastral ${S.layers.cadastral ? 'checked' : ''}></label>` : ''}
    ${PRJ.survey.length ? `<div class="label-sm">현장 측량점 ${PRJ.survey.length}개 사용 가능 (◆ 표시)</div>` : ''}`;
}
$('modeOptions').addEventListener('click', e => {
  const del = e.target.closest('[data-del-ref]'), tog = e.target.closest('[data-toggle-check]');
  if (del) { S.plan.refs.splice(+del.dataset.delRef, 1); applyAlignment(); }
  else if (tog) { const r = S.plan.refs[+tog.dataset.toggleCheck]; r.check = !r.check || undefined; applyAlignment(); }
});
$('modeOptions').addEventListener('change', e => {
  if (e.target.dataset.alignCadastral !== undefined) { setCadastral(e.target.checked); return; }
  if (e.target.name !== 'alignMethod') return;
  S.plan.alignMethod = e.target.value === 'auto' ? undefined : e.target.value;
  applyAlignment();
});

/** 도면 치수로 축척 확인: 두 점을 고르고 도면에 적힌 실제 길이를 넣는다. 기준점이 2개 미만이면 축척을 그 치수로 맞출 수 있다 */
function startDimCheck() {
  if (!S.bgImage || !planTransform()) { toast('먼저 배치도를 업로드하세요.', 'warn'); return; }
  if (S.mode === '3d') setMode('select');
  pickOnMap('📏 ① 도면에서 치수를 아는 선의 한쪽 끝을 클릭하세요 (예: 건물 모서리)', a => {
    S.dimLine = { a, b: null }; requestRender();
    pickOnMap('📏 ② 같은 선의 다른 쪽 끝을 클릭하세요', b => {
      S.dimLine = { a, b }; requestRender();
      setTimeout(() => finishDimCheck(a, b), 50);   // 선이 먼저 그려지도록
    });
  });
}
function finishDimCheck(a, b) {
  const T = planTransform(), cur = Math.hypot(b.x - a.x, b.y - a.y);
  const v = prompt(`지금 축척으로 이 선은 ${cur.toFixed(2)} m 입니다.\n도면에 적힌 실제 치수(m)를 입력하세요.`, '');
  S.dimLine = null;
  const real = parseFloat(String(v || '').replace(',', '.'));
  if (!(real > 0)) { requestRender(); return; }
  const pa = T.inverse(a), pb = T.inverse(b);
  S.plan.dimCheck = { pa, pb, real };
  S.plan.knownMpp = real / Math.hypot(pb.x - pa.x, pb.y - pa.y); S.plan.knownMppSrc = `치수 ${real} m`;   // 이후 정합은 이 축척으로 고정(자동)
  const pct = (cur / real - 1) * 100, fit = S.plan.refs.filter(r => !r.check);
  const msg = `지금 축척은 도면 치수보다 ${Math.abs(pct).toFixed(1)}% ${pct > 0 ? '큽니다' : '작습니다'}`;
  if (fit.length >= 2 && (!S.plan.alignMethod || S.plan.alignMethod === 'fixedScale')) {
    applyAlignment();
    toast(`📏 ${Math.abs(pct) <= 0.5 ? '축척이 도면 치수와 맞습니다' : msg}. 축척을 이 치수로 고정하고 회전·이동만 기준점으로 다시 맞췄습니다.`, 'success', { duration: 7000 });
  } else if (fit.length < 2 && Math.abs(pct) > 0.5 && confirm(`${msg}.\n기준점이 2개 미만이므로 이 치수로 도면 축척을 맞출까요?`)) {
    const F = getFrame(), anchor = fit.length === 1 && F ? F.toLocal(fit[0].lat, fit[0].lon) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const k = real / cur, [ta, tb, tc, td, te, tf] = S.plan.transform;
    transformLayout(p => ({ x: anchor.x + (p.x - anchor.x) * k, y: anchor.y + (p.y - anchor.y) * k }), 0);
    S.plan.transform = [ta * k, tb * k, anchor.x + (tc - anchor.x) * k, td * k, te * k, anchor.y + (tf - anchor.y) * k];
    toast(`도면 축척을 치수 ${real} m 에 맞췄습니다 (1px = ${(Math.sqrt(Math.abs(ta * te - tb * td)) * k).toFixed(4)} m). 위치·방향은 기준점으로 맞추세요.`, 'success', { duration: 6000 });
  } else {
    toast(Math.abs(pct) <= 1 ? `📏 축척 확인: 도면 치수와 ${Math.abs(pct).toFixed(1)}% 차이 — 정합이 잘 맞습니다.` : `📏 ${msg}. 기준점 위치를 다시 확인하세요.`, Math.abs(pct) <= 2 ? 'success' : 'warn', { duration: 6000 });
  }
  changed({ risk: false }); renderModeUI(); requestRender();
}

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

// ═══════════════════════════════════════════════
//  기상청 날씨 (v14.5) — 현장 위치(브이월드 검색·📍 위치로 정한 원점)의 초단기실황·예보
//  서버 weather.py 가 기상청을 부르고 법정 기준 판정까지 한다(키는 backend/.env). 여기서는 표시와 순간풍속 반영만.
// ═══════════════════════════════════════════════
const WX = {
  enabled: null, gf: 1.66, data: null, err: '', key: '', at: 0, loading: false, lastLevel: 'ok',
  auto: (() => { try { return localStorage.getItem('socmap.v14.wxAuto') !== '0'; } catch (e) { return true; } })(),
};
const WX_STATUS = { ok: '정상', info: '참고', caution: '주의', warn: '예보', stop: '중지' };
const WX_RANK = { ok: 0, info: 1, caution: 2, warn: 3, stop: 4 };
const wxDir = (deg) => deg == null ? '' : ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const wxSky = (h) => h.pty ? ({ 1: '🌧️', 2: '🌨️', 3: '❄️', 4: '🌦️', 5: '🌦️', 6: '🌨️', 7: '❄️' }[h.pty] || '🌧️') : ({ 1: '☀️', 3: '⛅', 4: '☁️' }[h.sky] || '·');
const wxHour = (iso) => `${new Date(iso).getHours()}시`;

async function wxRefresh(force = false) {
  const o = S.project.origin;
  if (!S.backendOnline || !o) { renderWeather(); return; }
  if (WX.enabled === null || (force && !WX.enabled)) {
    try {
      const c = await (await fetch(`${BACKEND_URL}/api/weather/config`, { cache: 'no-store' })).json();
      WX.enabled = !!c.enabled; WX.gf = c.gust_factor || WX.gf;
    } catch (e) { renderWeather(); return; }
  }
  if (!WX.enabled) { renderWeather(); return; }
  const key = `${o.lat.toFixed(4)},${o.lon.toFixed(4)}`;
  if (!force && WX.key === key && Date.now() - WX.at < 9 * 60e3) return;   // 서버도 10분 캐시
  WX.loading = true; renderWeather();
  try {
    const r = await fetch(`${BACKEND_URL}/api/weather?lat=${o.lat}&lon=${o.lon}`, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
    WX.key = key; WX.at = Date.now();
    wxSet(d);
  } catch (e) { WX.err = e.message; }
  finally { WX.loading = false; renderWeather(); }
}

/** 서버 프로젝트: 서버가 10분마다 보내는 날씨(WebSocket) */
function wxFromServer(w) {
  if (!w || !S.project.origin) return;
  WX.enabled = true; WX.at = Date.now(); WX.key = `${S.project.origin.lat.toFixed(4)},${S.project.origin.lon.toFixed(4)}`;
  wxSet(w); renderWeather();
}

function wxSet(d) {
  WX.data = d; WX.err = '';
  wxApplyWind();
  // 기준을 새로 넘으면 한 번 알림 (서버 프로젝트는 서버가 경보 기록에도 남긴다)
  if (WX_RANK[d.level] >= WX_RANK.warn && WX_RANK[d.level] > WX_RANK[WX.lastLevel]) {
    const c = d.checks.find(x => x.status === d.level);
    if (c) toast(`🌦️ 기상청 — ${c.text}\n(${c.law})`, d.level === 'stop' ? 'error' : 'warn', { duration: 8000 });
  }
  WX.lastLevel = d.level;
}

/** 자동 반영: 위험도 엔진의 순간풍속 = 기상청 평균풍속 × 돌풍계수 (장비 전면 통제 · 근로자 앱 위험 구역까지 반영) */
function wxApplyWind() {
  const g = WX.data && WX.data.now ? WX.data.now.gust_est : null;
  if (!WX.auto || g == null || S.siteEnvironment.windSpeed === g) return;
  S.siteEnvironment.windSpeed = g;
  renderEnvControls(); refreshEquipmentFormula();
  changed({ history: false });   // 실행 취소 기록에는 남기지 않음 · 서버 프로젝트면 휴대폰에도 공유
}

function renderWeather() {
  const card = $('wxCard'), off = $('wxOff'), chip = $('wxChip'), o = S.project.origin, d = WX.data;
  const show = !!(WX.enabled && o && S.backendOnline);
  card.hidden = !show;
  off.hidden = show || !S.backendOnline || (WX.enabled === null && !!o);
  off.innerHTML = !o ? '☁️ 현장 위치를 지정하면(📍 위치 · 주소 검색) 기상청 날씨를 받아 풍속을 자동으로 넣습니다.'
    : '☁️ 기상청 날씨: <code>backend/.env</code>에 <code>SOCMAP_KMA_KEY</code>(공공데이터포털 「기상청_단기예보 조회서비스」 인증키)를 넣고 서버를 다시 켜면 현장 날씨·풍속이 자동으로 들어옵니다. 지금은 풍속을 직접 넣습니다.';
  chip.hidden = !(show && d);
  $('wxAuto').checked = WX.auto;
  $('wxGf').textContent = WX.gf;
  if (!show) return;
  $('wxMeta').textContent = WX.loading ? '받는 중…' : d ? `격자 ${d.grid.nx},${d.grid.ny} · ${new Date(d.now.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 관측` : '';
  if (!d) {
    $('wxNow').innerHTML = `<span class="wx-wind">${WX.err ? `⚠️ ${esc(WX.err)}` : '날씨를 받는 중입니다…'}</span>`;
    $('wxHours').innerHTML = ''; $('wxChecks').innerHTML = ''; $('wxMiss').hidden = true;
    return;
  }
  const n = d.now, f = (v, u = '') => v == null ? '-' : `${v}${u}`;
  $('wxNow').innerHTML = `
    <span>🌡️ <b>${f(n.temp, '℃')}</b>${n.feels_like != null && n.feels_like !== n.temp ? ` · 체감 ${n.feels_like}℃` : ''}</span>
    <span>💧 습도 <b>${f(n.humidity, '%')}</b></span>
    <span>${n.pty ? wxSky(n) + ' ' + esc(n.pty_text) : '🌂 강수'} <b>${esc(n.rain_text)}</b> <small>(1시간)</small></span>
    <span>🧭 ${wxDir(n.wind_dir)}풍</span>
    <span class="wx-wind">🌬️ 평균 <b>${f(n.wind, ' m/s')}</b> → 순간 추정 <b>${f(n.gust_est, ' m/s')}</b></span>
    ${WX.err ? `<span class="wx-wind" style="color:var(--warn)">⚠️ 마지막 갱신 실패: ${esc(WX.err)}</span>` : ''}`;
  $('wxHours').innerHTML = d.hours.slice(0, 12).map(h => {
    const bad = (h.gust_est || 0) > 10 || (h.wind || 0) >= 10 || (h.rain || 0) >= 1 || (h.snow || 0) >= 1;
    const tip = `${wxHour(h.time)} · 평균 ${f(h.wind, ' m/s')} · 강수 ${h.rain_text || '-'}${h.snow ? ` · 신적설 ${h.snow_text}` : ''}${h.lightning ? ' · 낙뢰' : ''}`;
    return `<div class="wx-h${bad ? ' lv-warn' : ''}" title="${esc(tip)}"><b>${wxHour(h.time)}</b>${wxSky(h)}${h.lightning ? '⚡' : ''}<br>${f(h.gust_est)}<small>m/s</small>${h.rain ? `<br>${h.rain}mm` : ''}</div>`;
  }).join('');
  // 받지 못한 예보(API허브 기능별 미신청 등) — 예보 없이 지금 날씨로만 판정한다는 것을 알림
  const miss = d.missing || [];
  $('wxMiss').hidden = !miss.length;
  $('wxMiss').innerHTML = miss.length ? `⚠️ <b>${miss.map(m => esc(m.label)).join(' · ')}</b>를 받지 못해 ${d.hours.length ? '일부 예보로' : '<b>지금 날씨로만</b>'} 판정합니다.<br><small>${esc(miss[0].error)}</small>` : '';
  $('wxChecks').innerHTML = d.checks.filter(c => c.basis !== '참고' || c.status !== 'ok').map(c => {
    const detail = c.status === 'ok'
      ? `${esc(c.law)} · 기준 ${c.limit}${c.unit} ${c.op} · 지금 ${c.now == null ? '-' : c.now + c.unit}`
      : `${esc(c.text)}${c.status === 'warn' && c.peak_time ? ` (${wxHour(c.peak_time)} 최대 ${c.peak6h}${c.unit})` : ''} · ${esc(c.law)}`;
    return `<div class="wx-check st-${c.status}"><span class="st">${WX_STATUS[c.status]}</span><span>${esc(c.title)} <small>${detail}${c.note ? ` · ${esc(c.note)}` : ''}</small></span></div>`;
  }).join('');
  chip.className = `status-chip wx-chip lv-${d.level}`;
  chip.textContent = `${d.level === 'stop' ? '⛔' : d.level === 'warn' ? '⚠️' : '🌬️'} 순간 ${f(n.gust_est)} m/s · ${f(n.temp, '℃')}`;
}

$('wxRefresh').addEventListener('click', () => wxRefresh(true));
$('wxChip').addEventListener('click', () => setWorkspace('site'));
$('wxAuto').addEventListener('change', e => {
  WX.auto = e.target.checked;
  try { localStorage.setItem('socmap.v14.wxAuto', WX.auto ? '1' : '0'); } catch (err) { /* noop */ }
  if (WX.auto) wxApplyWind();
  renderWeather();
});
// 풍속을 손으로 바꾸면 자동 반영을 끈다 (장비 풍속계 값을 쓰는 경우)
$('windSlider').addEventListener('input', () => {
  if (!WX.auto || !WX.data) return;
  WX.auto = false;
  try { localStorage.setItem('socmap.v14.wxAuto', '0'); } catch (err) { /* noop */ }
  renderWeather();
  toast('기상청 풍속 자동 반영을 껐습니다. 직접 넣은 순간풍속을 씁니다.', 'info');
});
const _prevDocReplacedWx = onDocReplaced;
onDocReplaced = () => { _prevDocReplacedWx(); WX.lastLevel = 'ok'; wxRefresh(); };
setTimeout(() => wxRefresh(), 2500);
setInterval(() => wxRefresh(), 60e3);   // 위치가 바뀌었거나 9분이 지났으면 다시 받음

// 3D 보기: 현장 인원 실시간 표시 (View3D 가 0.3초마다 읽음)
View3D.peopleSource = () => [...PRJ.clients.values()].filter(c => c.x != null).map(c => ({
  id: c.id, x: c.x, y: c.y, name: c.name, role: c.role, online: c.online !== false, level: c.level || 'safe',
  color: c.online === false ? '#64748b' : c.role === 'operator' ? '#f59e0b' : (LEVELS[c.level || 'safe'] || LEVELS.safe).color,
}));

// ═══════════════════════════════════════════════
//  실제 건물 (v14.6) — 브이월드 GIS건물통합정보(국토교통부): 외곽선 · 층수 · 높이 · 구조 · 용도
//   🏢 불러오기: 현장 주변 실제 건물을 실제 축척으로 추가 (준공 건물, 층고 = 높이 ÷ 층수)
//   🧭 자동 맞추기: AI 가 도면에서 찾은 건물 ↔ 실제 건물 매칭(geo.js matchFootprints) → 짝을 기준점으로 → 기존 정합(applyAlignment)
// ═══════════════════════════════════════════════
async function fetchRealBuildings(F, box) {
  const a = F.toLatLon(box.minX, box.maxY), b = F.toLatLon(box.maxX, box.minY);   // y 는 남쪽이 + 라 minY 가 북쪽
  const q = `minlat=${Math.min(a.lat, b.lat).toFixed(7)}&minlon=${Math.min(a.lon, b.lon).toFixed(7)}&maxlat=${Math.max(a.lat, b.lat).toFixed(7)}&maxlon=${Math.max(a.lon, b.lon).toFixed(7)}`;
  const r = await fetch(`${BACKEND_URL}/api/vworld/buildings?${q}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
  return (d.buildings || []).map(bd => {
    const poly = [];
    const ring = bd.ring.length > 1 && bd.ring[0][0] === bd.ring[bd.ring.length - 1][0] && bd.ring[0][1] === bd.ring[bd.ring.length - 1][1] ? bd.ring.slice(0, -1) : bd.ring;
    for (const [lat, lon] of ring) { const p = F.toLocal(lat, lon); poly.push(+p.x.toFixed(2), +p.y.toFixed(2)); }
    return poly.length >= 6 ? { ...bd, poly, c: polygonCentroid(poly), areaM: footprintArea(poly) } : null;
  }).filter(Boolean);
}
function realBldgReady() {
  if (!getFrame()) { toast('현장 위치(📍)를 먼저 지정하세요. 프로젝트 메뉴 → 위치 · 주소 검색', 'warn'); return false; }
  if (!S.backendOnline) { toast('서버가 꺼져 있어 실제 건물을 불러올 수 없습니다.', 'error'); return false; }
  if (!VWORLD.key) { toast('브이월드 인증키가 없어 실제 건물을 불러올 수 없습니다. backend/.env 에 SOCMAP_VWORLD_KEY 를 넣으세요.', 'warn'); return false; }
  return true;
}
/** 조회 범위: 지금 배치 범위 + 여유(최소 반경 250 m, 최대 ±600 m) */
function realBldgBox(minHalf = 250, pad = 80) {
  const E = docExtent(), cx = (E.minX + E.maxX) / 2, cy = (E.minY + E.maxY) / 2;
  const hx = Math.min(600, Math.max(minHalf, (E.maxX - E.minX) / 2 + pad)), hy = Math.min(600, Math.max(minHalf, (E.maxY - E.minY) / 2 + pad));
  return { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy };
}
function realBldgData(b) {
  const bd = { name: b.name || undefined, stage: 'done', source: 'vworld' };
  if (b.floors > 0) bd.floors = b.floors;
  if (b.basements > 0) bd.basements = b.basements;
  if (b.structure) bd.structure = b.structure;
  if (b.height > 0 && b.floors > 0) bd.floorHeight = +(b.height / b.floors).toFixed(2);   // 실제 높이가 3D 에 그대로
  if (b.use) bd.use = b.use;
  if (b.structure_name) bd.structureName = b.structure_name;
  if (b.approved) bd.approved = b.approved;
  return bd;
}

async function importRealBuildings() {
  if (!realBldgReady()) return;
  setLoading('브이월드에서 실제 건물을 불러오는 중…');
  try {
    const F = getFrame(), list = await fetchRealBuildings(F, realBldgBox());
    const polys = getContourPolys(), more = [];
    let added = 0, dup = 0, tiny = 0;
    for (const b of list) {
      if (b.areaM < 15) { tiny++; continue; }   // 경비실·변전실 같은 아주 작은 부속 건물
      if (polys.some(p => p.length >= 6 && isPointInPolygon(b.c.x, b.c.y, p))) { dup++; continue; }   // 이미 그린(인식한) 건물 자리
      S.buildingData[S.contours.length + more.length] = realBldgData(b);
      more.push(toContour(b.poly));
      added++;
    }
    // 배열을 새로 만든다 — getContourPolys() 캐시가 배열 객체 기준이라 push 로 늘리면 옛 목록이 그대로 쓰였음
    if (more.length) S.contours = [...S.contours, ...more];
    changed(); renderInspector(); updateEmptyState();
    if (S.mode === '3d') View3D.rebuild();
    $('realBldgInfo').textContent = `브이월드 ${list.length}동 중 ${added}동 추가${dup ? ` · 이미 있는 자리 ${dup}동` : ''}${tiny ? ` · 15 m² 미만 ${tiny}동` : ''} — 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.`;
    toast(added ? `실제 건물 ${added}동을 불러왔습니다 (브이월드 GIS건물통합정보 · 실제 축척 · 층수·높이·구조 포함).\n3D 보기에서 실제 높이로 보입니다.` : '새로 추가할 건물이 없습니다 (범위 안 건물이 이미 모두 있습니다).', added ? 'success' : 'info', { duration: 7000 });
  } catch (e) {
    toast('실제 건물을 불러오지 못했습니다: ' + e.message, 'error');
  } finally { setLoading(null); }
}

async function autoAlignWithBuildings() {
  if (!realBldgReady()) return;
  const F = getFrame(), T = planTransform();
  if (!S.bgImage || !T) { toast('배치도를 올리고 AI 건물 인식을 먼저 하세요.', 'warn'); return; }
  // 도면 위 AI 인식 건물 (도면 px) — 불러온 실제 건물은 빼고
  const src = [];
  getContourPolys().forEach((p, i) => {
    if (p.length < 6 || ((S.buildingData[i] || {}).source === 'vworld')) return;
    const px = [];
    for (let k = 0; k < p.length; k += 2) { const q = T.inverse({ x: p[k], y: p[k + 1] }); px.push(q.x, q.y); }
    const c = polygonCentroid(px);
    src.push({ x: c.x, y: c.y, area: footprintArea(px), idx: i });
  });
  if (src.length < 5) { toast(`AI 인식 건물이 ${src.length}동입니다. 자동 맞추기는 실제로 있는 건물이 5동 이상 필요합니다.`, 'warn'); return; }
  if (S.plan.refs.length && !confirm(`기준점 ${S.plan.refs.length}개를 지우고 실제 건물로 자동 정합할까요?\n(Ctrl+Z 로 되돌릴 수 있습니다)`)) return;
  setLoading('실제 건물과 도면 건물을 짝 짓는 중…');
  try {
    const real = await fetchRealBuildings(F, realBldgBox(400, 200));
    const dst = real.filter(b => b.areaM >= 30).map(b => ({ x: b.c.x, y: b.c.y, area: b.areaM, b }));
    const k = S.plan.knownMpp > 0 ? S.plan.knownMpp : null;
    const m = matchFootprints(src, dst, { scaleRange: k ? [k * 0.92, k * 1.08] : [0.003, 3] });
    if (!m) {
      $('realBldgInfo').textContent = `실제 건물 ${dst.length}동과 비교했지만 확실하게 맞는 배치를 찾지 못했습니다 (맞는 건물 5동 미만).`;
      toast('실제 건물과 맞는 배치를 찾지 못했습니다.\n새로 짓는 건물만 있는 배치도이거나 현장 위치가 멀면 자동으로 맞출 수 없습니다 — 「📍 도면 정합」으로 기준점을 직접 찍으세요.', 'warn', { duration: 9000 });
      return;
    }
    // 짝 → 기준점 (7쌍 이상이면 4번째마다 검증점으로 빼서 정합 오차를 정직하게 잼)
    S.plan.refs = m.pairs.map(({ i, j }, n) => {
      const ll = F.toLatLon(dst[j].x, dst[j].y);
      return { id: newId('g'), px: { x: +src[i].x.toFixed(1), y: +src[i].y.toFixed(1) }, lat: +ll.lat.toFixed(8), lon: +ll.lon.toFixed(8),
               auto: true, check: m.pairs.length >= 7 && n % 4 === 3 ? true : undefined };
    });
    if (!S.plan.alignMethod || S.plan.alignMethod === 'auto') S.plan.alignMethod = k ? 'fixedScale' : 'similarity';   // 건물 중심은 아핀보다 닮음이 안정적
    applyAlignment();
    // 짝 지은 건물 = 이미 있는 건물 → 실제 층수·높이·구조·이름 (사용자가 넣은 값은 유지)
    for (const { i, j } of m.pairs) {
      const idx = src[i].idx, cur = S.buildingData[idx] || {}, add = realBldgData(dst[j].b);
      S.buildingData[idx] = { ...add, ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v != null && v !== '')), source: 'vworld-matched' };
    }
    changed(); renderInspector(); renderModeUI();
    const t = m.transform;
    $('realBldgInfo').textContent = `자동 정합: 도면 건물 ${src.length}동 중 ${m.pairs.length}동이 실제 건물과 맞음 · 1px = ${t.scale.toFixed(4)} m · 회전 ${t.rotation.toFixed(1)}° · 짝 중심 오차 RMS ${m.rms.toFixed(2)} m. 기준점으로 저장했으니 「📍 도면 정합」에서 확인·수정할 수 있습니다.`;
  } catch (e) {
    toast('자동 맞추기에 실패했습니다: ' + e.message, 'error');
  } finally { setLoading(null); }
}
$('realBldgBtn').addEventListener('click', importRealBuildings);
$('autoAlignBtn').addEventListener('click', autoAlignWithBuildings);
