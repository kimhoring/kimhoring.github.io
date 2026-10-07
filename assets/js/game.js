/* ═══════════════════════════════════════════════════════════════
 *  김호성의 마을 — 횡스크롤 NPC 홈페이지
 *  캐릭터는 모두 아래 문자 격자로 직접 그린 픽셀 아트입니다.
 * ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';
  const DATA = window.GAME_DATA;
  const CFG = window.SITE_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
  };

  // ═══════════════════════════ 픽셀 스프라이트 ═══════════════════════════
  const W = 16;   // 스프라이트 가로 픽셀
  const HAIR = [
    '....oooooooo....',
    '...ohhhhhhhho...',
    '..ohhhhhhhhhho..',
    '.ohhhhhhhhhhhho.',
    '.ohhhhhhhhhhhho.',
  ];
  const HELMET = [
    '....oooooooo....',
    '...oyyyyyyyyo...',
    '..oyyyyYyyyyyo..',
    '.oyyyyyYyyyyyyo.',
    'oYYYYYYYYYYYYYYo',
  ];
  const CAP = [
    '................',
    '....oooooooo....',
    '...oqqqqqqqqo...',
    '..oqqqqQqqqqqo..',
    '.oQQQQQQQQQQQQo.',
  ];
  const FACE = [   // 눈: 2칸 + 반짝이(w), 볼: r
    '.ohhsssssssshho.',
    '.ohssssssssssho.',
    '.ohsewssssewsho.',
    '.ohseesssseesho.',
    '.osrrssmmssrrso.',
    '.oSssssssssssSo.',
    '..ooSssssssSoo..',
  ];
  const BODY = [
    '...occcccccco...',
    '..occcccccccco..',
    '.osccccccccccso.',
    '.osCccccccccCso.',
    '..oCccccccccCo..',
    '...oppppppppo...',
    '...opppPPpppo...',
  ];
  const BODY_VEST = [
    '...occcccccco...',
    '..occvccccvcco..',
    '.osccvccccvccso.',
    '.osCcvccccvcCso.',
    '..oCcvccccvcCo..',
    '...oppppppppo...',
    '...opppPPpppo...',
  ];
  const BODY_JERSEY = [
    '...occwwwwcco...',
    '..occcccccccco..',
    '.osccccwwccccso.',
    '.osCcccwwcccCso.',
    '..oCccccccccCo..',
    '...oppppppppo...',
    '...opppPPpppo...',
  ];
  const BODY_STRAP = [
    '...ozccccccco...',
    '..occzccccccco..',
    '.osccczccccccso.',
    '.osCcccczccZZso.',
    '..oCcccccczZZo..',
    '...oppppppppo...',
    '...opppPPpppo...',
  ];
  const LEGS = [
    '...oppo..oppo...',
    '...oppo..oppo...',
    '..obbbo..obbbo..',
    '..ooooo..ooooo..',
  ];
  const LEGS_SOCKS = [
    '...okko..okko...',
    '...okko..okko...',
    '..obbbo..obbbo..',
    '..ooooo..ooooo..',
  ];
  const LEGS_WALK = [
    '..oppo....oppo..',
    '..oppo....oppo..',
    '.obbbo....obbbo.',
    '.ooooo....ooooo.',
  ];
  const BALL = [
    '..oooo..',
    '.owwwwo.',
    'owwkkwwo',
    'owkkkkwo',
    'owwkkwwo',
    'owwwwwwo',
    '.owwwwo.',
    '..oooo..',
  ];
  const BASE_PAL = { o: '#2a1d16', s: '#fbdcc0', S: '#eab490', e: '#2a1d16', r: '#ffa3a3', m: '#c24a3a', b: '#3b2e25', w: '#ffffff', k: '#2a1d16' };
  const SPRITES = {
    me: { top: HAIR, body: BODY, legs: LEGS, pal: { h: '#3b2a20', c: '#c0532a', C: '#9e4220', p: '#4a4f63', P: '#3a3e4f' } },
    safety: { top: HELMET, body: BODY_VEST, legs: LEGS, pal: { y: '#f2c230', Y: '#d29a1e', h: '#2a1d16', c: '#ef7d2d', C: '#cf6420', v: '#fbf3df', p: '#5b6070', P: '#474b59' } },
    soccer: { top: HAIR, body: BODY_JERSEY, legs: LEGS_SOCKS, pal: { h: '#1f1a17', c: '#3f7d4e', C: '#2f6440', p: '#f2efe8', P: '#d6d0c4', k: '#3f7d4e' } },
    post: { top: CAP, body: BODY_STRAP, legs: LEGS, pal: { q: '#3b4e73', Q: '#2c3b58', h: '#5a3a26', c: '#3b4e73', C: '#2c3b58', z: '#c49a5c', Z: '#9a6c35', p: '#2c3b58', P: '#1f2a40' } },
    player: { top: HAIR, body: BODY, legs: LEGS, pal: { h: '#8a5a3a', c: '#e9d6b9', C: '#cdb592', p: '#556b8d', P: '#43577a' } },
  };

  function rowsOf(def, walk) { return [...def.top, ...FACE, ...def.body, ...(walk ? LEGS_WALK : def.legs)]; }
  function draw(rows, pal, scale) {
    const w = Math.max(...rows.map(r => r.length)), h = rows.length;
    rows.forEach((r, i) => { if (r.length !== w) console.warn('스프라이트 폭이 다른 줄', i, r); });
    const cv = document.createElement('canvas');
    cv.width = w * scale; cv.height = h * scale;
    const g = cv.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const col = pal[ch] || BASE_PAL[ch];
      if (!col || ch === '.') return;
      g.fillStyle = col; g.fillRect(x * scale, y * scale, scale, scale);
    }));
    return cv.toDataURL();
  }
  const spriteCache = {};
  function sprite(name, scale, walk = false) {
    const key = `${name}|${scale}|${walk}`;
    if (!spriteCache[key]) {
      const d = SPRITES[name];
      spriteCache[key] = draw(rowsOf(d, walk), { ...BASE_PAL, ...d.pal }, scale);
    }
    return spriteCache[key];
  }
  const SPRITE_H = HAIR.length + FACE.length + BODY.length + LEGS.length;   // 23

  // ═══════════════════════════ 월드 구성 ═══════════════════════════
  const stage = $('#stage'), world = $('#world');
  const far = $('#far'), mid = $('#mid');
  const player = { el: $('#player'), img: $('#player img'), x: 0, target: null, talkTo: null, walking: false, frame: 0, frameT: 0 };
  const npcs = DATA.npcs.map(n => ({ ...n }));
  const byId = Object.fromEntries(npcs.map(n => [n.id, n]));
  let worldW = 0, camX = 0, scale = 4;
  const keys = { left: false, right: false };

  function buildNpcs() {
    const layer = $('#npcs');
    npcs.forEach(n => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `npc ${n.kind === 'board' ? 'is-board' : ''} ${n.host ? 'is-host' : ''}`;
      b.dataset.id = n.id;
      b.setAttribute('aria-label', `${n.name}${n.kind === 'board' ? ' 읽기' : '와 대화하기'}`);
      b.innerHTML = `
        <span class="quest" aria-hidden="true">!</span>
        <span class="near-hint" aria-hidden="true">Space</span>
        ${n.chatter && n.chatter.length ? '<span class="bubble" aria-hidden="true"></span>' : ''}
        ${n.kind === 'board'
          ? '<span class="board-art" aria-hidden="true"><span class="board-face"><b>이력</b><i></i><i></i><i></i></span><span class="leg l"></span><span class="leg r"></span></span>'
          : '<img class="sprite" alt="">'}
        <span class="tag">${n.name}</span>`;
      b.addEventListener('click', e => { e.stopPropagation(); walkAndTalk(n.id); });
      b.addEventListener('focus', () => { if (!dialog.open) followTo(n); });
      layer.appendChild(b);
      n.el = b;
    });
  }

  function layout() {
    const vw = stage.clientWidth;
    scale = vw < 640 ? 3 : 4;
    const prevFrac = worldW ? player.x / worldW : null;
    worldW = Math.max(vw, vw < 640 ? 1300 : 1500);
    world.style.width = worldW + 'px';
    npcs.forEach(n => {
      n.px = Math.round(n.x * worldW);
      n.el.style.left = n.px + 'px';
      const img = n.el.querySelector('img.sprite');
      if (img) { img.src = sprite(n.sprite, scale); img.width = W * scale; img.height = SPRITE_H * scale; }
    });
    // 소품 위치
    document.querySelectorAll('[data-at]').forEach(el => { el.style.left = Math.round(parseFloat(el.dataset.at) * worldW) + 'px'; });
    $('#ball').src = draw(BALL, { ...BASE_PAL, w: '#ffffff', k: '#2a1d16' }, scale);
    player.img.width = W * scale; player.img.height = SPRITE_H * scale;
    player.x = prevFrac == null ? byId.me.px + (vw < 640 ? 50 : 90) : prevFrac * worldW;
    setPlayerFrame(true);
    buildMinimap();
    render(0);
  }

  // ═══════════════════════════ 이동 · 카메라 ═══════════════════════════
  const SPEED = 300;   // px/s
  function standSpot(n) { return n.px + (player.x < n.px ? -70 : 70); }
  function walkAndTalk(id) {
    const n = byId[id];
    if (!n) return;
    if (dialog.open) closeDialog(false);
    const spot = Math.max(30, Math.min(worldW - 30, standSpot(n)));
    if (REDUCE || Math.abs(spot - player.x) < 6) { player.x = spot; player.target = null; openDialog(id); render(0); return; }
    player.target = spot; player.talkTo = id;
  }
  function followTo(n) { player.target = Math.max(30, Math.min(worldW - 30, standSpot(n))); player.talkTo = null; }

  function setPlayerFrame(force) {
    const walk = player.walking && player.frame % 2 === 1;
    const src = sprite('player', scale, walk);
    if (force || player.img.src !== src) player.img.src = src;
  }

  let last = 0;
  function loop(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    update(dt);
    render(dt);
    requestAnimationFrame(loop);
  }
  function update(dt) {
    let dir = 0;
    if (!dialog.open) {
      if (keys.left) dir -= 1;
      if (keys.right) dir += 1;
    }
    let moving = false;
    if (dir) { player.target = null; player.talkTo = null; player.x += dir * SPEED * dt; moving = true; player.face = dir; }
    else if (player.target != null) {
      const d = player.target - player.x, step = SPEED * dt;
      player.face = Math.sign(d) || player.face;
      if (Math.abs(d) <= step) {
        player.x = player.target; player.target = null;
        if (player.talkTo) { const id = player.talkTo; player.talkTo = null; openDialog(id); }
      } else { player.x += Math.sign(d) * step; moving = true; }
    }
    player.x = Math.max(24, Math.min(worldW - 24, player.x));
    if (moving !== player.walking) { player.walking = moving; player.el.classList.toggle('walking', moving); }
    if (moving) {
      player.frameT += dt;
      if (player.frameT > 0.14) { player.frameT = 0; player.frame++; setPlayerFrame(); }
    } else if (player.frame % 2) { player.frame = 0; setPlayerFrame(); }
  }
  function render() {
    const vw = stage.clientWidth;
    const goal = Math.max(0, Math.min(worldW - vw, player.x - vw / 2));
    camX += (goal - camX) * (REDUCE ? 1 : 0.12);
    if (Math.abs(goal - camX) < 0.5) camX = goal;
    world.style.transform = `translate3d(${-camX.toFixed(1)}px,0,0)`;
    far.style.backgroundPositionX = `${(-camX * 0.2).toFixed(1)}px`;
    mid.style.backgroundPositionX = `${(-camX * 0.45).toFixed(1)}px`;
    player.el.style.left = player.x.toFixed(1) + 'px';
    player.el.style.setProperty('--face', player.face < 0 ? -1 : 1);
    // 가까운 NPC 표시
    const near = nearest(90);
    npcs.forEach(n => n.el.classList.toggle('near', n === near && !dialog.open));
    // 말풍선: 화면 밖 NPC 는 숨기고, 좁은 화면에서는 가운데 가장 가까운 NPC 만 말하게
    const narrow = vw < 640, center = camX + vw / 2;
    let focus = null;
    if (narrow) {
      let bd = Infinity;
      npcs.forEach(n => { if (n.bubble) { const d = Math.abs(n.px - center); if (d < bd) { bd = d; focus = n; } } });
    }
    npcs.forEach(n => {
      if (!n.bubble) return;
      const x = n.px - camX;
      const mute = x < -20 || x > vw + 20 || (narrow && n !== focus);
      n.bubble.classList.toggle('mute', mute);
      if (mute || !n.bubble.classList.contains('on')) return;
      const w = n.bubbleW || 0, left = x - w / 2, lim = Math.max(0, w / 2 - 18);
      const shift = Math.max(-lim, Math.min(lim, Math.min(vw - 8 - w, Math.max(8, left)) - left));
      n.bubble.style.setProperty('--shift', shift.toFixed(0) + 'px');
    });
    // 미니맵
    if (mm.player) mm.player.style.left = (player.x / worldW * 100).toFixed(2) + '%';
  }
  function nearest(range) {
    let best = null, bd = range;
    npcs.forEach(n => { const d = Math.abs(n.px - player.x); if (d < bd) { bd = d; best = n; } });
    return best;
  }

  // 바닥 클릭 → 이동
  stage.addEventListener('click', e => {
    if (dialog.open || e.target.closest('.npc, .hud, .dialog, a, button')) return;
    const r = world.getBoundingClientRect();
    player.target = Math.max(24, Math.min(worldW - 24, e.clientX - r.left)); player.talkTo = null;
  });

  // 키보드
  const LEFT = ['ArrowLeft', 'a', 'A'], RIGHT = ['ArrowRight', 'd', 'D'];
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (dialog.open) { dialogKey(e); return; }
    if (LEFT.includes(e.key)) { keys.left = true; e.preventDefault(); }
    else if (RIGHT.includes(e.key)) { keys.right = true; e.preventDefault(); }
    else if ((e.key === ' ' || e.key === 'ArrowUp') && !e.target.closest('button, a')) {
      const n = nearest(100);
      if (n) { e.preventDefault(); walkAndTalk(n.id); }
    }
  });
  window.addEventListener('keyup', e => {
    if (LEFT.includes(e.key)) keys.left = false;
    if (RIGHT.includes(e.key)) keys.right = false;
  });
  window.addEventListener('blur', () => { keys.left = keys.right = false; });

  // ═══════════════════════════ 대화창 ═══════════════════════════
  const dialog = { open: false, npc: null, page: 0, typing: null, full: '' };
  const dlg = $('#dialog'), dText = $('#dText'), dName = $('#dName'), dTitle = $('#dTitle'), dPortrait = $('#dPortrait');
  const dPrev = $('#dPrev'), dNext = $('#dNext'), dEnd = $('#dEnd'), dChoices = $('#dChoices'), dPage = $('#dPage');
  let returnFocus = null;

  function contactChoices() {
    const out = [];
    if (CFG.email) out.push({ label: `이메일 보내기 (${CFG.email})`, href: `mailto:${CFG.email}` });
    if (CFG.github) out.push({ label: 'GitHub 보기', href: CFG.github });
    return out;
  }
  function pagesOf(n) {
    if (!n.contact) return n.pages;
    return [...n.pages, contactChoices().length ? '아래에서 원하는 방법을 골라 주세요.' : '아직 연락처가 등록되지 않았어요. 곧 추가될 예정이에요!'];
  }
  function choicesOf(n) {
    if (!n.contact) return n.choices || [];
    return [...contactChoices(), { label: '알겠어요', action: 'close' }];
  }

  function openDialog(id) {
    const n = byId[id];
    if (!n) return;
    returnFocus = document.activeElement;
    dialog.open = true; dialog.npc = n; dialog.page = 0;
    keys.left = keys.right = false;
    dName.textContent = n.name; dTitle.textContent = n.title || '';
    if (n.kind === 'board') { dPortrait.innerHTML = '<span class="board-art big" aria-hidden="true"><span class="board-face"><b>이력</b><i></i><i></i><i></i></span><span class="leg l"></span><span class="leg r"></span></span>'; }
    else { dPortrait.innerHTML = `<img alt="" src="${sprite(n.sprite, 5)}" width="${W * 5}" height="${SPRITE_H * 5}">`; }
    dlg.hidden = false;
    requestAnimationFrame(() => dlg.classList.add('show'));
    n.el.classList.add('talking');
    if (n.bubble) n.bubble.classList.remove('on');
    showPage();
    dNext.focus({ preventScroll: true });
  }
  function closeDialog(restoreFocus = true) {
    if (!dialog.open) return;
    const n = dialog.npc;
    stopTyping();
    dialog.open = false;
    dlg.classList.remove('show');
    dlg.hidden = true;
    n.el.classList.remove('talking');
    markVisited(n.id);
    if (restoreFocus && returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
  }

  function parse(text) {   // **굵게** → 조각
    const segs = []; let bold = false;
    text.split('**').forEach(part => { if (part) segs.push({ t: part, b: bold }); bold = !bold; });
    return segs;
  }
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function htmlUpTo(segs, n) {
    let out = '', left = n;
    for (const s of segs) {
      if (left <= 0) break;
      const chars = [...s.t], part = chars.slice(0, left).join('');
      left -= chars.length;
      out += s.b ? `<b>${esc(part)}</b>` : esc(part);
    }
    return out;
  }
  function stopTyping() { if (dialog.typing) { clearInterval(dialog.typing); dialog.typing = null; } }
  function showPage() {
    const n = dialog.npc, pages = pagesOf(n), last = dialog.page === pages.length - 1;
    const segs = parse(pages[dialog.page]);
    const total = segs.reduce((a, s) => a + [...s.t].length, 0);
    stopTyping();
    dChoices.hidden = true; dChoices.innerHTML = '';
    dPage.textContent = pages.length > 1 ? `${dialog.page + 1} / ${pages.length}` : '';
    dPrev.disabled = dialog.page === 0;
    dNext.hidden = last;
    dEnd.hidden = !last || choicesOf(n).length > 0;
    const finish = () => { stopTyping(); dText.innerHTML = htmlUpTo(segs, total); if (last) showChoices(); };
    if (REDUCE) { finish(); return; }
    let i = 0;
    dText.innerHTML = '';
    dialog.typing = setInterval(() => { i += 1; dText.innerHTML = htmlUpTo(segs, i); if (i >= total) finish(); }, 24);
    dialog.finish = finish;
  }
  function showChoices() {
    const list = choicesOf(dialog.npc);
    if (!list.length) { dEnd.hidden = false; return; }
    dChoices.innerHTML = list.map((c, i) => {
      const ext = c.href && /^(https?:|mailto:)/.test(c.href);
      return c.href
        ? `<li><a href="${esc(c.href)}"${ext && !c.href.startsWith('mailto:') ? ' target="_blank" rel="noopener"' : ''}>${esc(c.label)}</a></li>`
        : `<li><button type="button" data-act="${esc(c.action || 'close')}">${esc(c.label)}</button></li>`;
    }).join('');
    dChoices.hidden = false;
    const first = dChoices.querySelector('a, button');
    if (first) first.focus({ preventScroll: true });
  }
  dChoices.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) {
      const act = b.dataset.act;
      if (act.startsWith('talk:')) { const id = act.slice(5); closeDialog(false); walkAndTalk(id); }
      else closeDialog();
      return;
    }
    if (e.target.closest('a')) markVisited(dialog.npc.id);
  });
  function next() {
    if (dialog.typing) { dialog.finish(); return; }
    const pages = pagesOf(dialog.npc);
    if (dialog.page < pages.length - 1) { dialog.page++; showPage(); }
  }
  function prev() {
    if (dialog.typing) { dialog.finish(); return; }
    if (dialog.page > 0) { dialog.page--; showPage(); }
  }
  dNext.addEventListener('click', next);
  dPrev.addEventListener('click', prev);
  dEnd.addEventListener('click', () => closeDialog());
  $('#dClose').addEventListener('click', () => closeDialog());
  dText.addEventListener('click', () => { if (dialog.typing) dialog.finish(); });
  function dialogKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(); return; }
    const onChoice = e.target.closest && e.target.closest('#dChoices');
    if ((e.key === 'Enter' || e.key === ' ') && !onChoice && !(e.target.closest && e.target.closest('#dPrev, #dEnd, #dClose'))) { e.preventDefault(); next(); }
    else if (e.key === 'ArrowRight' && !onChoice) { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' && !onChoice) { e.preventDefault(); prev(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && onChoice) {
      const items = [...dChoices.querySelectorAll('a, button')], i = items.indexOf(document.activeElement);
      const j = (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[j].focus(); e.preventDefault();
    }
  }

  // ═══════════════════════════ 퀘스트 진행 · HUD ═══════════════════════════
  const visited = new Set(store.get('hs.visited', []).filter(id => byId[id]));
  function markVisited(id) {
    if (visited.has(id)) return;
    visited.add(id);
    store.set('hs.visited', [...visited]);
    updateQuest(true);
  }
  function updateQuest(justNow) {
    const total = npcs.length, v = visited.size;
    npcs.forEach(n => n.el.classList.toggle('visited', visited.has(n.id)));
    $('#expFill').style.width = (v / total * 100) + '%';
    $('#expText').textContent = `대화 ${v} / ${total}`;
    mm.dots && mm.dots.forEach(d => d.classList.toggle('visited', visited.has(d.dataset.id)));
    if (justNow && v === total && !store.get('hs.done', false)) {
      store.set('hs.done', true);
      toast('🎉 모든 마을 사람과 이야기했어요! 이제 김호성에 대해 꽤 잘 알게 됐네요.');
    } else if (justNow) {
      toast(`EXP +1 · ${byNameVisited()}`);
    }
  }
  // 받침 유무로 '와/과' 고르기
  const josa = (w) => { const c = w.charCodeAt(w.length - 1) - 0xAC00; return c >= 0 && c <= 11171 && c % 28 ? '과' : '와'; };
  function byNameVisited() { const n = byId[[...visited].pop()]; return n.kind === 'board' ? `${n.name} 읽기 완료` : `${n.name}${josa(n.name)} 대화 완료`; }
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 300); }, 2600);
  }

  // ── 말풍선: NPC 마다 짧은 한마디를 번갈아 보여 줌 ──
  function startChatter() {
    npcs.forEach((n, i) => {
      const el = n.el.querySelector('.bubble');
      if (!el) return;
      n.bubble = el; n.chatIdx = 0;
      const show = () => {
        if (!(dialog.open && dialog.npc === n)) {
          el.textContent = n.chatter[n.chatIdx++ % n.chatter.length];
          el.classList.add('on');
          n.bubbleW = el.offsetWidth;
        }
        n.chatT = setTimeout(hide, REDUCE ? 7000 : 4600);
      };
      const hide = () => { el.classList.remove('on'); n.chatT = setTimeout(show, REDUCE ? 300 : 1300); };
      n.chatT = setTimeout(show, 500 + i * 650);
    });
  }

  // 미니맵
  const mm = { dots: null, player: null };
  function buildMinimap() {
    const track = $('#mmTrack');
    track.innerHTML = npcs.map(n => `<button type="button" class="mm-dot ${n.kind === 'board' ? 'obj' : ''}" data-id="${n.id}" style="left:${(n.x * 100).toFixed(1)}%" aria-label="${n.name}에게 가기" title="${n.name}"></button>`).join('')
      + '<span class="mm-player" aria-hidden="true"></span>';
    mm.dots = [...track.querySelectorAll('.mm-dot')];
    mm.player = track.querySelector('.mm-player');
    mm.dots.forEach(d => d.addEventListener('click', () => walkAndTalk(d.dataset.id)));
    updateQuest(false);
  }

  // 빠른 메뉴: data-talk 버튼
  document.querySelectorAll('[data-talk]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); walkAndTalk(b.dataset.talk); }));

  // ═══════════════════════════ 시작 ═══════════════════════════
  $('#mapName').textContent = DATA.mapName;
  buildNpcs();
  layout();
  startChatter();
  camX = Math.max(0, Math.min(worldW - stage.clientWidth, player.x - stage.clientWidth / 2));
  window.addEventListener('resize', layout);
  requestAnimationFrame(loop);
  document.documentElement.classList.add('game-ready');
})();
