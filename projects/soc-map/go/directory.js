/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v14.10 — 서버 주소 안내판 (근로자·관리감독자 앱, 앱 첫 화면, 홈페이지 go 페이지 공용)
 *
 *  노트북을 켤 때마다 터널 주소(…trycloudflare.com)가 바뀐다. 서버가 새 주소를 비밀 GitHub Gist 에 적고
 *  (backend/directory.py), 휴대폰은 여기를 읽어 스스로 찾아간다 → 다시 QR 을 찍지 않아도 된다.
 *  비밀 Gist 는 주소를 아는 사람은 읽을 수 있으므로 서버 주소 말고는 적지 않는다.
 *
 *  GIST_ID 는 `backend/venv/Scripts/python.exe backend/directory.py --setup` 이 채운다. 비어 있으면 안내판 없이 동작.
 *  시험: window.SOCMAP_DIRECTORY(안내판 주소) · window.SOCMAP_SERVER_RE(허용 주소)를 먼저 넣으면 그 값을 쓴다.
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const Directory = (() => {
  const GIST_USER = 'kimhoring', GIST_ID = 'de42bb9b0c20e6fc96ae8425c930d106', FILE = 'socmap-server.json';
  const g = typeof window !== 'undefined' ? window : {};
  const source = () => g.SOCMAP_DIRECTORY || (GIST_ID ? `https://gist.githubusercontent.com/${GIST_USER}/${GIST_ID}/raw/${FILE}` : '');
  // 안내판에 무엇이 적혀 있든 터널 주소가 아니면 따라가지 않는다
  const serverRe = () => g.SOCMAP_SERVER_RE || /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
  const timed = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

  /** 안내판 내용 → 서버 주소 (형식이 틀리면 null) */
  function parse(text) {
    try {
      const d = JSON.parse(text);
      return d && typeof d.url === 'string' && serverRe().test(d.url) ? d.url : null;
    } catch (e) { return null; }
  }
  /** 안내판 읽기 → { url(터널 주소가 아니면 null), at(노트북이 적은 시각, 초) }, 읽지 못하면 null.
   *  주소 뒤의 값은 GitHub CDN 캐시(5분)를 건너뛰기 위한 것 */
  async function board() {
    const src = source();
    if (!src) return null;
    try {
      const r = await fetch(`${src}?t=${Date.now()}`, { cache: 'no-store', signal: timed(8000) });
      if (!r.ok) return null;
      const text = await r.text();
      let at = 0;
      try { at = +JSON.parse(text).at || 0; } catch (e) { /* 깨진 안내판 */ }
      return { url: parse(text), at };
    } catch (e) { return null; }
  }
  async function lookup() { const b = await board(); return b ? b.url : null; }
  async function alive(url) {
    try { return (await fetch(url + '/health', { cache: 'no-store', signal: timed(6000) })).ok; } catch (e) { return false; }
  }
  /** 지금 켜져 있는 서버 주소 (없으면 null) */
  async function find() {
    const url = await lookup();
    return url && (await alive(url)) ? url : null;
  }
  return { enabled: () => !!source(), parse, board, lookup, alive, find };
})();
