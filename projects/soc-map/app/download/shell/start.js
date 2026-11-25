/* SOC-MAP 안드로이드 앱 시작 화면 — 「현장 들어가기」(인증)
 * v14.7: 앱은 홈페이지 고정 주소에서 미리 받아 두고, 현장에 들어갈 때 인증한다.
 * v14.9: 이 화면은 처음 한 번과 서버 주소가 바뀌었을 때만 나온다. 그다음은 앱을 열면 바로 합류(field.js entryPlan).
 * v14.10: 서버 주소는 안내판(directory.js)에서 찾는다 → 새 휴대폰도 코드 6자리만으로 들어오고, 서버가 안 보이면 켜질 때까지 기다렸다 들어간다.
 *   근로자     — 현장 QR(서버 주소 + 참여 코드), 초대 링크, 또는 참여 코드 6자리(지난 현장 서버)
 *   관리감독자 — 관리자 화면의 「🦺 관리감독자 앱」 QR(관리자 키 포함)
 * 서버 주소(…trycloudflare.com)는 노트북에서 서버를 켤 때마다 바뀌므로 앱에 고정할 수 없다 → 안내판(없으면 QR)이 서버 주소를 알려 준다.
 * QR 해석: jsQR (Apache-2.0, https://github.com/cozmo/jsQR) */
'use strict';
const $ = (id) => document.getElementById(id);
const N = window.SOCMAPNative;
let info = { role: 'worker', version: '', server: '', error: '' };
try { if (N) info = JSON.parse(N.info()); } catch (e) { /* 앱 밖에서 열었을 때 */ }

const SUP = info.role === 'supervisor';
const CODE_RE = /^[A-Z0-9]{6}$/;
$('appName').textContent = SUP ? 'SOC-MAP 관리감독자' : 'SOC-MAP 근로자';
$('roleIc').textContent = SUP ? '🦺' : '👷';
$('howtoPick').innerHTML = SUP ? '「🦺 관리감독자 앱」 QR을 이 앱으로 찍습니다. <br>(관리자 키가 들어 있어 비밀번호 없이 로그인됩니다)'
  : '「👷 근로자 앱」 QR을 이 앱으로 찍거나, 그 아래 <b>참여 코드</b>를 넣습니다.';
$('lead').textContent = SUP ? '노트북 화면의 「🦺 관리감독자 앱」 QR을 찍으면 바로 로그인됩니다.'
  : Directory.enabled() ? '관리자에게 받은 참여 코드 6자리를 넣거나 QR을 찍으면 바로 들어갑니다.' : '노트북 화면의 QR을 찍으면 바로 들어갑니다. 초대 링크를 받았다면 그 링크를 누르세요.';
// v14.14 화면 패치 번호(만든 시각)도 보여 준다 → 업데이트가 들어왔는지 눈으로 확인
const patchAt = info.shell ? new Date(info.shell * 1000) : null, two = (n) => String(n).padStart(2, '0');
// v14.16 「업데이트 확인」 — 앱 안에서 바로 (본체가 지원할 때만)
if (N && typeof N.updateNow === 'function') {
  const b = document.createElement('button');
  b.className = 'btn-ghost'; b.id = 'updBtn'; b.textContent = '🔄 업데이트 확인'; b.style.cssText = 'display:block;margin:6px auto 0;text-align:center';
  b.onclick = () => updateNow();
  $('foot').after(b);
}
// SOC-MAP 버전은 화면 패치(version.js)가 정함 — 앱 본체(APK)는 휴대폰 기능 코드가 바뀔 때만 올라가 둘이 다를 수 있다
const socmapV = window.SOCMAP_VERSION || info.version || '-';
$('foot').textContent = `SOC-MAP v${socmapV}${patchAt ? ` · 화면 ${two(patchAt.getMonth() + 1)}-${two(patchAt.getDate())} ${two(patchAt.getHours())}:${two(patchAt.getMinutes())}` : ''}${info.version && info.version !== socmapV ? ` · 본체 v${info.version}` : ''}${info.model ? ` · ${info.model}` : ''}`;
// 지난 서버가 안 보이면(노트북을 껐다 켰으면) 안내판으로 찾아 들어간다. 서버가 켜질 때까지 기다리므로 누를 것이 없다
const autoFind = info.lost && Directory.enabled();
if (info.error && !autoFind) showErr(info.error);
if (info.server) {
  $('lastBtn').hidden = false;
  $('lastBtn').onclick = () => go(info.server + (SUP ? '/supervisor' : '/worker'));
}

function showErr(msg) { $('err').textContent = msg; $('err').hidden = !msg; if (msg) window.scrollTo(0, 0); }
function go(url) {
  if (!url) return;
  if (N) N.open(url); else location.href = url;
}

/**
 * 찍은 QR(또는 입력한 주소) → 이 앱이 열 주소. 다른 역할의 QR·앱 받기 페이지 QR 이면 안내만.
 * @returns {{url?: string, error?: string}}
 */
function routeFor(text) {
  let u;
  // 초대 메시지를 통째로 붙여 넣어도 주소만 골라 쓴다
  const found = String(text).match(/(?:https?|socmap[a-z-]*):\/\/[^\s<>"']+/i);
  try { u = new URL(found ? found[0] : String(text).trim()); } catch (e) { return { error: 'SOC-MAP QR이 아닙니다. 노트북 관리자 화면의 QR을 찍으세요.' }; }
  if (/^socmap[a-z-]*:$/i.test(u.protocol)) return { url: u.href };                 // 앱 링크는 그대로
  if (!/^https?:$/.test(u.protocol)) return { error: 'SOC-MAP QR이 아닙니다. 노트북 관리자 화면의 QR을 찍으세요.' };
  const p = u.pathname, q = u.searchParams, h = new URLSearchParams(u.hash.slice(1));
  if (/\/projects\/soc-map\/go\/?$/.test(p)) {                                    // 고정 초대 QR·링크
    const c = (q.get('c') || '').toUpperCase();
    if (SUP) return { error: '근로자용 QR입니다.\n관리감독자는 관리자 화면 📱 현장 합류 → 「🦺 관리감독자 앱」 QR을 찍으세요.' };
    return CODE_RE.test(c) ? { code: c } : { error: '초대 주소가 올바르지 않습니다. 관리자에게 다시 받으세요.' };
  }
  // v14.16 앱 받기 QR·앱 파일 QR: 앱은 이미 있으니 파일을 다시 받지 않고 앱 안에서 업데이트 확인
  if (/\/projects\/soc-map\//.test(p) || /\.apk$/i.test(p)) return { update: true, error: '앱 받기 QR입니다. 앱은 이미 설치되어 있어 파일을 다시 받을 필요가 없습니다 — 새 버전은 앱 안에서 받습니다.\n현장에 들어가려면 「현장 합류」 QR을 찍으세요.' };
  if (p.startsWith('/download')) {                                                   // 노트북의 앱 받기 QR → 바로 들어가기
    const c = (q.get('code') || '').toUpperCase();
    if (!SUP && CODE_RE.test(c)) return { url: `${u.origin}/j/${c}` };
    return { url: u.origin + (SUP ? '/supervisor' : '/worker') };
  }
  const isSup = p.startsWith('/supervisor') || (h.get('p') && h.get('k'));
  const isWork = p.startsWith('/j/') || p.startsWith('/worker') || p.startsWith('/field');
  if (SUP && isWork) return { error: '근로자용 QR입니다.\n관리감독자는 관리자 화면 📱 현장 합류 → 「🦺 관리감독자 앱」 QR을 찍으세요.' };
  if (!SUP && isSup) return { error: '관리감독자용 QR입니다.\n이 앱(근로자)은 「👷 근로자 앱」 QR이나 참여 코드로 들어갑니다. 관리감독자는 「SOC 관리감독」 앱을 쓰세요.' };
  if (p === '/' || p === '') return { url: u.origin + (SUP ? '/supervisor' : '/worker') };
  return { url: u.href };
}
/** v14.16 앱 안에서 바로 업데이트 확인 (새것이면 받아 설치, 최신이면 알림). 옛 본체면 아무것도 안 함 */
function updateNow() { try { if (N && typeof N.updateNow === 'function') { N.updateNow(); return true; } } catch (e) { /* noop */ } return false; }
function openRoute(text) {
  const r = routeFor(text);
  if (r.update) updateNow();
  if (r.error) { showErr(r.error); return false; }
  showErr('');
  enterRoute(r);
  return true;
}
/** QR·링크 해석 결과로 들어가기: 고정 초대는 코드로, 나머지는 주소로 */
function enterRoute(r) {
  if (r.code) { $('codeInput').value = r.code; enterCode(); } else go(r.url);
}
$('urlGo').onclick = () => openRoute($('urlInput').value);
$('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') openRoute($('urlInput').value); });

// ── 근로자: 참여 코드 6자리 — 안내판으로 서버를 찾으므로 새 휴대폰도 된다. 안내판이 없으면 서버 주소를 알 때만 ──
if (!SUP && (Directory.enabled() || info.server)) {
  $('codeCard').hidden = false;
  $('codeHint').textContent = Directory.enabled() ? '관리자에게 받은 6자리 코드입니다.' : '지난 현장 서버의 다른 현장으로 들어갑니다.';
}
$('codeInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') enterCode(); });
$('codeGo').onclick = enterCode;
let codeBusy = false;
async function enterCode() {
  const c = $('codeInput').value.toUpperCase().trim();
  if (!CODE_RE.test(c)) { showErr('참여 코드는 영문·숫자 6자리입니다.'); return; }
  if (codeBusy) return;
  codeBusy = true; $('codeGo').textContent = '찾는 중…';
  showErr('');
  try {
    let server = '';
    if (Directory.enabled()) {
      // v14.12 노트북을 막 켰으면 인터넷 주소가 준비되는 데 시간이 걸린다 → 바로 포기하지 않고 2분까지 기다린다
      const r = await findServer(120000);
      if (r.url) server = r.url;
      else if (!info.server) { showErr(`${r.error}\n급하면 노트북 화면의 QR을 찍으세요.`); return; }
    }
    server = server || info.server;
    if (!server) { showErr('현장 서버를 찾지 못했습니다.\n노트북 화면의 「📷 QR 찍기」로 들어가세요.'); return; }
    // https 서버면 코드를 미리 확인(틀린 코드·꺼진 서버를 바로 알림). http(같은 와이파이)는 시작 화면(https)에서 못 부르므로 바로 연다
    if (/^https:/.test(server)) {
      let res;
      try {
        res = await fetch(server + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }), signal: AbortSignal.timeout(6000) });
      } catch (e) {
        showErr('지난 현장 서버에 연결할 수 없습니다.\n노트북 서버가 꺼졌거나 다시 켜져 주소가 바뀌었습니다. 「📷 QR 찍기」로 들어가세요.');
        return;
      }
      if (res.status === 404) { showErr(`참여 코드 ${c} 에 해당하는 현장이 없습니다. 코드를 다시 확인하세요.`); return; }
    }
    showErr('');
    go(`${server}/j/${c}`);
  } finally { codeBusy = false; $('codeGo').textContent = '들어가기'; }
}

// ── QR 스캐너 ──
let stream = null, raf = 0;
const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });

$('scanBtn').onclick = async () => {
  $('scanMsg').textContent = 'QR 코드를 네모 안에 맞추세요.';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    showErr('카메라를 열 수 없습니다. 휴대폰 설정 → 앱 → 권한에서 카메라를 허용하세요.' + (SUP ? '' : '\n또는 참여 코드를 넣으세요.'));
    return;
  }
  video.srcObject = stream;
  $('scan').hidden = false;
  await video.play().catch(() => {});
  // v14.15 자동 초점(되는 휴대폰만) — 노트북 화면 QR 은 가까이 찍어 초점이 안 맞으면 뿌옇게 보인다
  try {
    const t = stream.getVideoTracks()[0], caps = t.getCapabilities ? t.getCapabilities() : {};
    if ((caps.focusMode || []).includes('continuous')) await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch (e) { /* 지원 안 함 */ }
  scanStart = Date.now(); hinted = false;
  tick();
};
$('scanClose').onclick = stopScan;

function stopScan() {
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  $('scan').hidden = true;
}

let lastBad = '', frameNo = 0, scanStart = 0, hinted = false;
/** v14.15 한 장면에서 해석할 부분: 번갈아 넓게(가운데 80 %, 480px 로 줄임) / 좁게(가운데 50 %, 줄이지 않고 최대 720px).
 *  좁게 = 2배쯤 확대한 효과 → 작거나 촘촘한 QR(관리자 키가 든 관리감독자 QR)도 칸이 뭉개지지 않는다 */
function scanWindow(vw, vh, n) {
  const wide = n % 2 === 0, s = Math.min(vw, vh) * (wide ? 0.8 : 0.5);
  return { s, sx: (vw - s) / 2, sy: (vh - s) / 2, size: wide ? 480 : Math.min(720, Math.round(s)) };
}
function tick() {
  if (!stream) return;
  if (!hinted && scanStart && Date.now() - scanStart > 6000) {
    hinted = true;
    $('scanMsg').textContent = '잘 안 읽히면 15~30 cm 거리에서 천천히 앞뒤로 움직여 보세요. 노트북 화면의 QR 을 누르면 크게 보입니다.';
  }
  if (video.readyState >= 2 && video.videoWidth) {
    // 화면 가운데(네모 안)만 잘라 해석 — 빠르고 주변 다른 QR 을 덜 읽는다
    const { s, sx, sy, size } = scanWindow(video.videoWidth, video.videoHeight, frameNo++);
    canvas.width = size; canvas.height = size;
    ctx.drawImage(video, sx, sy, s, s, 0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    const code = window.jsQR && jsQR(img.data, size, size, { inversionAttempts: 'dontInvert' });
    if (code && code.data) {
      const text = code.data.trim(), r = routeFor(text);
      if (r.update) { if (navigator.vibrate) navigator.vibrate(60); stopScan(); showErr(r.error); updateNow(); return; }
      if (r.url || r.code) {
        if (navigator.vibrate) navigator.vibrate(60);
        stopScan();
        showErr('');
        enterRoute(r);
        return;
      }
      if (text !== lastBad) { lastBad = text; if (navigator.vibrate) navigator.vibrate([30, 60, 30]); }
      $('scanMsg').textContent = r.error;
    }
  }
  raf = requestAnimationFrame(tick);
}

// ── 서버 찾기 (주소 안내판) ──
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hhmm = (sec) => { const d = new Date(sec * 1000); return `${d.getHours()}시 ${String(d.getMinutes()).padStart(2, '0')}분`; };
/** 지금 상황을 사람 말로: 안내판을 못 읽음 / 노트북이 안 켜짐 / 켜졌지만 아직 응답 없음 */
function boardMsg(b, final) {
  if (!b) return '서버 주소 안내판을 읽지 못했습니다. 휴대폰 인터넷(데이터·와이파이)을 확인하세요.';
  if (!b.url) return '노트북 서버가 아직 켜지지 않았습니다. 노트북에서 SOC-MAP 을 켜 주세요.';
  const when = b.at ? `${hhmm(b.at)}에 켜짐` : '켜짐';
  return final ? `노트북 서버(${when})가 응답하지 않습니다. 노트북의 SOC-MAP 창이 켜져 있고 인터넷에 연결되어 있는지 확인하세요.`
    : `노트북 서버(${when})에 연결하는 중… 노트북을 막 켰다면 1분쯤 걸립니다.`;
}
let findStop = false;
$('findCancel').onclick = () => { findStop = true; };
/** 서버를 찾을 때까지 waitMs 동안 5초마다 다시 본다 → { url } 또는 { error } */
async function findServer(waitMs) {
  findStop = false;
  const until = Date.now() + waitMs;
  try {
    for (;;) {
      const b = await Directory.board();
      if (b && b.url && await Directory.alive(b.url)) return { url: b.url };
      if (findStop) return { error: '기다리기를 그만두었습니다.' };
      if (Date.now() > until) return { error: boardMsg(b, true) };
      $('findCard').hidden = false; $('findMsg').textContent = boardMsg(b, false);
      await sleep(5000);
      if (findStop) return { error: '기다리기를 그만두었습니다.' };
    }
  } finally { $('findCard').hidden = true; }
}
// 지난 서버가 안 보일 때(노트북을 껐다 켰을 때): 켜질 때까지 계속 기다렸다 들어간다
async function waitForServer() {
  const r = await findServer(Infinity);
  if (r.url) go(r.url + (info.path || (SUP ? '/supervisor' : '/worker')));
}
if (autoFind) waitForServer();
// v14.14 앱이 새 첫 화면을 받았을 때 바로 새로 고쳐도 되는가 — QR 찍기·코드 입력·서버 기다리기 중이면 다음에 열 때
window.__socmapIdle = () => !stream && !codeBusy && $('findCard').hidden && !$('codeInput').value;
