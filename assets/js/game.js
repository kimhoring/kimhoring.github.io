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
  const BEANIE = [
    '......oooo......',
    '....oonnnnoo....',
    '..oonnnnnnnnoo..',
    '.onnnnnnnnnnnno.',
    '.oNNNNNNNNNNNNo.',
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
  const DUMMY = [   // 연습용 허수아비
    '.....oooooo.....',
    '....oyyyyyyo....',
    '...oyyyyyyyyo...',
    '...oyeyyyyeyo...',
    '...oyyyyyyyyo...',
    '...oyyymmyyyo...',
    '....oyyyyyyo....',
    '.....oooooo.....',
    'oooooobbbboooooo',
    'obbbbbbbbbbbbbbo',
    'oooooobbbboooooo',
    '.....obbbbo.....',
    '.....obxxbo.....',
    '.....obxxbo.....',
    '.....obbbbo.....',
    '.....obbbbo.....',
    '....oobbbboo....',
    '...oooooooooo...',
  ];
  const BASE_PAL = { o: '#2a1d16', s: '#fbdcc0', S: '#eab490', e: '#2a1d16', r: '#ffa3a3', m: '#c24a3a', b: '#3b2e25', w: '#ffffff', k: '#2a1d16' };
  const SPRITES = {
    me: { top: HAIR, body: BODY, legs: LEGS, pal: { h: '#3b2a20', c: '#c0532a', C: '#9e4220', p: '#4a4f63', P: '#3a3e4f' } },
    safety: { top: HELMET, body: BODY_VEST, legs: LEGS, pal: { y: '#f2c230', Y: '#d29a1e', h: '#2a1d16', c: '#ef7d2d', C: '#cf6420', v: '#fbf3df', p: '#5b6070', P: '#474b59' } },
    soccer: { top: HAIR, body: BODY_JERSEY, legs: LEGS_SOCKS, pal: { h: '#1f1a17', c: '#3f7d4e', C: '#2f6440', p: '#f2efe8', P: '#d6d0c4', k: '#3f7d4e' } },
    post: { top: CAP, body: BODY_STRAP, legs: LEGS, pal: { q: '#3b4e73', Q: '#2c3b58', h: '#5a3a26', c: '#3b4e73', C: '#2c3b58', z: '#c49a5c', Z: '#9a6c35', p: '#2c3b58', P: '#1f2a40' } },
    hobby: { top: BEANIE, body: BODY, legs: LEGS, pal: { n: '#8a6ad6', N: '#6a4fb3', h: '#4a3426', c: '#3aa7a0', C: '#2b8580', p: '#4a4f63', P: '#3a3e4f' } },
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
  const player = { el: $('#player'), img: $('#player .body'), x: 0, y: 0, vy: 0, target: null, talkTo: null, arrive: null, walking: false, frame: 0, frameT: 0 };
  const npcs = DATA.npcs.map(n => ({ ...n }));
  const byId = Object.fromEntries(npcs.map(n => [n.id, n]));
  const npcsByX = [...npcs].sort((a, b) => a.x - b.x);
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
    worldW = Math.max(vw, vw < 640 ? 1450 : 1700);
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
    sizeAttack();
    dummy.px = Math.round(parseFloat(dummy.el.dataset.at) * worldW);
    dummy.img.src = draw(DUMMY, { ...BASE_PAL, y: '#e9c46a', m: '#b8452a', b: '#9a6a40', x: '#d6452f' }, scale);
    dummy.img.width = 16 * scale; dummy.img.height = DUMMY.length * scale;
    player.x = prevFrac == null ? byId.me.px + (vw < 640 ? 50 : 90) : prevFrac * worldW;
    setPlayerFrame(true);
    buildMinimap();
    render(0);
  }

  // ═══════════════════════════ 이동 · 카메라 ═══════════════════════════
  const SPEED = 300;   // px/s
  const JUMP_V = 620, GRAVITY = 1800;   // 점프 속도 · 중력 (px/s, px/s²) → 최고 약 107px
  function jump() {
    if (dialog.open || player.y > 0) return;
    player.vy = JUMP_V; player.y = 0.01;
    setPlayerFrame();
  }
  function land() {
    player.y = 0; player.vy = 0;
    setPlayerFrame();
    const dust = document.createElement('span');
    dust.className = 'dust';
    dust.style.left = player.x.toFixed(0) + 'px';
    $('#fxLayer').appendChild(dust);
    setTimeout(() => dust.remove(), 400);
  }
  function standSpot(n) { return n.px + (player.x < n.px ? -70 : 70); }
  function walkAndTalk(id) {
    const n = byId[id];
    if (!n) return;
    if (dialog.open) closeDialog(false);
    const spot = Math.max(30, Math.min(worldW - 30, standSpot(n)));
    if (REDUCE || Math.abs(spot - player.x) < 6) { player.x = spot; player.target = null; openDialog(id); render(0); return; }
    player.target = spot; player.talkTo = id; player.arrive = null;
  }
  function followTo(n) { player.target = Math.max(30, Math.min(worldW - 30, standSpot(n))); player.talkTo = null; }

  function setPlayerFrame(force) {
    const walk = player.y > 0 || (player.walking && player.frame % 2 === 1);   // 공중에서는 다리 벌린 자세
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
    if (dir) { player.target = null; player.talkTo = null; player.arrive = null; player.x += dir * SPEED * dt; moving = true; player.face = dir; }
    else if (player.target != null) {
      const d = player.target - player.x, step = SPEED * dt;
      player.face = Math.sign(d) || player.face;
      if (Math.abs(d) <= step) {
        player.x = player.target; player.target = null;
        if (player.talkTo) { const id = player.talkTo; player.talkTo = null; openDialog(id); }
        if (player.arrive) { const f = player.arrive; player.arrive = null; f(); }
      } else { player.x += Math.sign(d) * step; moving = true; }
    }
    player.x = Math.max(24, Math.min(worldW - 24, player.x));
    if (player.y > 0) {   // 점프 중: 중력
      player.vy -= GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) land();
    }
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
    player.el.style.setProperty('--jy', player.y.toFixed(1));
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
    // 왼쪽부터 보면서, 앞 말풍선과 겹치는 말풍선은 잠시 숨김
    let lastRight = -Infinity;
    npcsByX.forEach(n => {
      if (!n.bubble) return;
      const x = n.px - camX;
      let mute = x < -20 || x > vw + 20 || (narrow && n !== focus);
      if (!mute && n.bubble.classList.contains('on')) {
        const w = n.bubbleW || 0, left = x - w / 2, lim = Math.max(0, w / 2 - 18);
        const shift = Math.max(-lim, Math.min(lim, Math.min(vw - 8 - w, Math.max(8, left)) - left));
        if (left + shift < lastRight + 8) mute = true;
        else { lastRight = left + shift + w; n.bubble.style.setProperty('--shift', shift.toFixed(0) + 'px'); }
      }
      n.bubble.classList.toggle('mute', mute);
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
    player.target = Math.max(24, Math.min(worldW - 24, e.clientX - r.left)); player.talkTo = null; player.arrive = null;
  });

  // 키보드
  const LEFT = ['ArrowLeft', 'a', 'A'], RIGHT = ['ArrowRight', 'd', 'D'];
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (dialog.open) { dialogKey(e); return; }
    if (LEFT.includes(e.key)) { keys.left = true; e.preventDefault(); }
    else if (RIGHT.includes(e.key)) { keys.right = true; e.preventDefault(); }
    else if ((e.key === 'z' || e.key === 'Z' || e.key === 'ㅋ') && !e.repeat) { e.preventDefault(); slash(); }
    else if (['ArrowUp', 'w', 'W', 'ㅈ', 'Alt'].includes(e.key)) { e.preventDefault(); if (!e.repeat) jump(); }
    else if (e.key === ' ' && !e.target.closest('button, a')) {
      const n = nearest(100);
      if (n) { e.preventDefault(); walkAndTalk(n.id); }
    }
  });
  window.addEventListener('keyup', e => {
    if (LEFT.includes(e.key)) keys.left = false;
    if (RIGHT.includes(e.key)) keys.right = false;
  });
  window.addEventListener('blur', () => { keys.left = keys.right = false; });

  // ═══════════════════════════ 스킬: 화염검 (검술) ═══════════════════════════
  // Z 키 · 🔥 버튼으로 3연속 화염 베기. 연습용 허수아비를 맞히면 데미지 숫자가 뜸
  const dummy = { el: $('#dummy'), img: $('#dummy img'), px: 0 };
  const fxLayer = $('#fxLayer');   // 점프(↑ · W · Alt)와 화염검(Z)은 화면에 안내하지 않는 숨은 기능
  const COOL = 700;   // ms
  const HITS = [110, 230, 433];   // 3연타가 맞는 시각 (ms) — 아래 SWING 에서 칼날이 앞(0°)을 지나는 순간

  // ── 공격 동작: 화면이 바뀔 때마다(초당 약 60번) 검 각도를 부드럽게 바꿔 그림 → 3연타가 하나의 동작으로 이어짐 ──
  // 검 각도는 아래 키프레임 사이를 가속 · 감속 곡선으로 이음. 팔은 검을 따라 돌고, 몸은 휘두르는 쪽으로 기울며,
  // 칼끝이 지나간 자리는 최근 0.12초의 궤적을 띠로 이어 그림.
  const ATK_W = 72, ATK_H = 56, OX = 24, OY = 18;   // 캐릭터(16×23 격자)를 가운데 두고 검 · 불꽃이 퍼질 여유
  const SWING = [   // t: ms, a: 검 각도 (0 = 앞, + = 아래)
    { t: 0, a: -100 }, { t: 50, a: -115 },     // 들어 올림
    { t: 150, a: 45 },                          // 1타: 내려 베기
    { t: 175, a: 47 }, { t: 290, a: -55 },      // 2타: 올려 베기
    { t: 330, a: -70 }, { t: 380, a: -135 },    // 크게 들어 올림
    { t: 470, a: 52 },                          // 마무리 베기
    { t: 700, a: 44 },                          // 자세 유지 (칼끝이 땅에 박히지 않게, 남은 불꽃이 사그라질 동안)
  ];
  const ATK_MS = SWING[SWING.length - 1].t;
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function swingAngle(t) {
    for (let i = 1; i < SWING.length; i++) {
      if (t <= SWING[i].t) { const p = SWING[i - 1], q = SWING[i]; return p.a + (q.a - p.a) * ease((t - p.t) / (q.t - p.t)); }
    }
    return SWING[SWING.length - 1].a;
  }
  const atkBase = {};
  function attackBase(walk) {   // 앞쪽 팔을 지운 캐릭터 그림 (1배)
    const k = String(walk);
    if (!atkBase[k]) {
      const rows = rowsOf(SPRITES.player, walk).map((row, y) => (y === 14 || y === 15 ? row.slice(0, 13) + 'o.' + row.slice(15) : row));
      const img = new Image();
      img.src = draw(rows, { ...BASE_PAL, ...SPRITES.player.pal }, 1);
      atkBase[k] = img;
    }
    return atkBase[k];
  }
  const atkCv = $('#atk'), atkCtx = atkCv.getContext('2d');
  const atk = { on: false, t0: 0, walk: false, trail: [], parts: [], prev: null, lastT: 0 };
  // 불꽃 알갱이용 둥근 빛 (흰색 → 노랑 → 주황 → 빨강 순서로 식어 감)
  const GLOW = [[255, 251, 230], [255, 214, 74], [255, 130, 30], [230, 52, 12]].map(([R, G, B]) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const c = cv.getContext('2d'), gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, `rgba(${R},${G},${B},1)`); gr.addColorStop(0.4, `rgba(${R},${G},${B},.85)`); gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
    c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
    return cv;
  });
  function sizeAttack() {
    atkCv.width = ATK_W * scale * DPR; atkCv.height = ATK_H * scale * DPR;
    atkCv.style.width = `${ATK_W * scale}px`; atkCv.style.height = `${ATK_H * scale}px`;
    atkCv.style.left = `${-OX * scale}px`;
    atkCv.style.bottom = `${-(ATK_H - OY - SPRITE_H) * scale}px`;
    attackBase(false); attackBase(true);   // 미리 그려 둠
  }
  function playAttack() {
    atk.t0 = performance.now(); atk.walk = player.y > 0; atk.trail = []; atk.parts = []; atk.prev = null; atk.lastT = 0;
    player.el.classList.add('attacking');
    if (!atk.on) { atk.on = true; requestAnimationFrame(drawAttack); }
  }
  function drawAttack(now) {
    const t = Math.max(0, now - atk.t0);
    if (t >= ATK_MS) { atk.on = false; player.el.classList.remove('attacking'); return; }
    const S = scale, g = atkCtx, pal = { ...BASE_PAL, ...SPRITES.player.pal };
    const a = swingAngle(t), r = a * Math.PI / 180;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, ATK_W * S, ATK_H * S);
    g.imageSmoothingEnabled = false;
    // 몸: 휘두르는 쪽으로 살짝 기울고 앞으로 내딛음 (발끝 기준)
    const lean = Math.max(-60, Math.min(80, a)) * 0.07 * Math.PI / 180, lunge = Math.max(0, a) / 80 * 1.5 * S;
    const fx = (OX + 8) * S, fy = (OY + 23) * S;
    g.save();
    g.translate(fx + lunge, fy); g.rotate(lean); g.translate(-fx, -fy);
    g.drawImage(attackBase(atk.walk), OX * S, OY * S, 16 * S, 23 * S);
    // 어깨 → 손 → 칼끝
    const sx = (OX + 12.5) * S, sy = (OY + 13.5) * S, arm = (a * 0.55 + 15) * Math.PI / 180;
    const hx = sx + Math.cos(arm) * 6.5 * S, hy = sy + Math.sin(arm) * 6.5 * S;
    const tipX = hx + Math.cos(r) * 15 * S, tipY = hy + Math.sin(r) * 15 * S;
    // 궤적: 최근 120ms 동안의 칼날 위치를 이은 띠 (오래된 쪽일수록 옅게)
    atk.trail.push({ t, hx, hy, tipX, tipY });
    while (atk.trail.length && t - atk.trail[0].t > 120) atk.trail.shift();
    const big = t > 380, tr = atk.trail;
    const band = (inner, color, alpha, glow) => {
      g.fillStyle = color;
      g.shadowColor = glow ? 'rgba(255, 120, 20, .9)' : 'transparent';
      g.shadowBlur = glow ? 6 * S : 0;
      for (let i = 1; i < tr.length; i++) {
        const p = tr[i - 1], q = tr[i];
        g.globalAlpha = alpha * (i / tr.length);
        g.beginPath();
        g.moveTo(p.tipX, p.tipY); g.lineTo(q.tipX, q.tipY);
        g.lineTo(q.hx + (q.tipX - q.hx) * inner, q.hy + (q.tipY - q.hy) * inner);
        g.lineTo(p.hx + (p.tipX - p.hx) * inner, p.hy + (p.tipY - p.hy) * inner);
        g.closePath(); g.fill();
      }
      g.globalAlpha = 1; g.shadowBlur = 0;
    };
    band(big ? 0.1 : 0.28, '#ff3d0a', 0.6, true);
    band(big ? 0.35 : 0.5, '#ff8a1f', 0.75, false);
    band(0.75, '#ffd23a', 0.8, false);
    g.globalCompositeOperation = 'lighter';
    // 화염: 칼날이 지나간 자리에 불꽃 알갱이를 뿌림 → 제자리에 남아 위로 피어오르며 식어 감
    const dt = Math.min(0.05, Math.max(0.001, (t - atk.lastT) / 1000));
    atk.lastT = t;
    if (atk.prev) {
      const pv = atk.prev, n = Math.min(16, Math.round(Math.abs(a - pv.a) * (big ? 1.2 : 0.8)));   // 빨리 휘두를수록 많이
      for (let i = 0; i < n; i++) {
        const f = 0.3 + Math.random() * 0.7, s = Math.random();
        const x1 = hx + (tipX - hx) * f, y1 = hy + (tipY - hy) * f;
        const x0 = pv.hx + (pv.tipX - pv.hx) * f, y0 = pv.hy + (pv.tipY - pv.hy) * f;
        atk.parts.push({
          x: x0 + (x1 - x0) * s, y: y0 + (y1 - y0) * s,
          vx: (Math.random() - 0.5) * 24 * S, vy: -(18 + Math.random() * 40) * S,
          life: 0, max: 0.14 + Math.random() * 0.16, r: (1.5 + Math.random() * 2.2) * S * (big ? 1.4 : 1),
        });
      }
    }
    atk.prev = { a, hx, hy, tipX, tipY };
    atk.parts = atk.parts.filter(p => (p.life += dt) < p.max);
    for (const p of atk.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.life / p.max, rr = p.r * (1.15 - k * 0.65);
      g.globalAlpha = (1 - k) * 0.5;
      g.drawImage(GLOW[[1, 2, 2, 3][Math.min(3, Math.floor(k * 4))]], p.x - rr * 2, p.y - rr * 2, rr * 4, rr * 4);   // 노랑 → 주황 → 빨강
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    const bladeFire = () => {   // 칼날 자체가 타오름 (검과 함께 움직임)
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const f = 0.25 + i * 0.12, x = hx + (tipX - hx) * f, y = hy + (tipY - hy) * f;
        const rr = (1.8 + Math.random() * 1.1 + (big ? 0.6 : 0)) * S;
        g.globalAlpha = 0.32 + Math.random() * 0.2;
        g.drawImage(GLOW[i < 3 ? 3 : i < 5 ? 2 : 1], x - rr * 2, y - rr * 2 - S, rr * 4, rr * 4);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    };
    // 팔
    g.lineCap = 'round';
    g.strokeStyle = '#2a1d16'; g.lineWidth = 3.4 * S;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(hx, hy); g.stroke();
    g.strokeStyle = pal.c; g.lineWidth = 2 * S;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(hx, hy); g.stroke();
    // 검 (손잡이 · 칼날 · 코등이)
    g.save();
    g.translate(hx, hy); g.rotate(r); g.scale(S, S);
    g.lineJoin = 'round'; g.strokeStyle = '#2a1d16'; g.lineWidth = 0.7;
    g.fillStyle = '#7a5235'; g.fillRect(-3.2, -0.9, 3, 1.8); g.strokeRect(-3.2, -0.9, 3, 1.8);
    g.beginPath(); g.moveTo(1, -1.3); g.lineTo(13.2, -1.3); g.lineTo(15.5, 0); g.lineTo(13.2, 1.3); g.lineTo(1, 1.3); g.closePath();
    g.fillStyle = '#e8f1ff'; g.fill(); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 0.5;
    g.beginPath(); g.moveTo(1.5, -0.45); g.lineTo(13, -0.45); g.stroke();
    g.fillStyle = '#f2c230'; g.strokeStyle = '#2a1d16'; g.lineWidth = 0.6;
    g.fillRect(-0.4, -2.6, 1.4, 5.2); g.strokeRect(-0.4, -2.6, 1.4, 5.2);
    g.restore();
    bladeFire();
    // 손
    g.fillStyle = pal.s; g.strokeStyle = '#2a1d16'; g.lineWidth = 0.6 * S;
    g.beginPath(); g.arc(hx, hy, 1.3 * S, 0, Math.PI * 2); g.fill(); g.stroke();
    g.restore();
    requestAnimationFrame(drawAttack);
  }

  // 불꽃 이펙트 SVG: 베기 궤적 3개 + 불꽃 폭발 + 불꽃 혀 + 불티
  function fireSVG() {
    const rnd = (a, b) => a + Math.random() * (b - a);
    let spikes = '';
    for (let i = 0; i < 44; i++) {
      const ang = i / 44 * Math.PI * 2, r = i % 2 ? rnd(22, 34) : rnd(48, 82);
      spikes += `${i ? 'L' : 'M'}${(Math.cos(ang) * r).toFixed(1)} ${(Math.sin(ang) * r * 0.8).toFixed(1)} `;
    }
    const wisps = Array.from({ length: 10 }, (_, i) => {
      const a = i * 36 + rnd(-12, 12), L = rnd(40, 70), m = (L * 0.6).toFixed(0);
      return `<path class="wisp" style="--a:${a.toFixed(0)}deg" d="M0 0 C9 -12 7 -${m} 0 -${L.toFixed(0)} C-7 -${m} -9 -12 0 0 Z" fill="url(#fxWisp)"/>`;
    }).join('');
    const embers = Array.from({ length: 18 }, () => {
      const a = rnd(0, Math.PI * 2), d = rnd(70, 150);
      return `<circle class="ember" r="${rnd(1.5, 3.6).toFixed(1)}" style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d * 0.7).toFixed(0)}px;--t:${rnd(0.35, 0.6).toFixed(2)}s" fill="${Math.random() < 0.5 ? '#ffe680' : '#ff8a1f'}"/>`;
    }).join('');
    return `<svg class="fire" viewBox="-150 -130 300 260" aria-hidden="true">
      <defs>
        <radialGradient id="fxCore"><stop offset="0" stop-color="#fffbe6"/><stop offset=".3" stop-color="#ffd84a"/><stop offset=".65" stop-color="#ff7a1a"/><stop offset="1" stop-color="#e02800" stop-opacity="0"/></radialGradient>
        <linearGradient id="fxWisp" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#ff8a1f"/><stop offset="1" stop-color="#d42a00" stop-opacity="0"/></linearGradient>
        <filter id="fxFire" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.04 0.09" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="d"/></feMerge></filter>
        <filter id="fxGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <circle class="flash" r="60" fill="url(#fxCore)"/>
      <path class="core" d="${spikes}Z" fill="url(#fxCore)" filter="url(#fxFire)"/>
      <g class="wisps">${wisps}</g>
      <g class="embers">${embers}</g>
    </svg>`;
  }
  $('#player .fx').insertAdjacentHTML('beforeend', fireSVG());
  let lastSlash = 0, slashCount = 0, stack = 0, stackT = null;
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  function slash() {
    const now = performance.now();
    if (dialog.open || now - lastSlash < COOL) return;
    lastSlash = now;
    restart(player.el, 'slashing');
    playAttack();
    clearTimeout(player.slashT);
    player.slashT = setTimeout(() => player.el.classList.remove('slashing'), 960);
    setTimeout(() => restart(world, 'shake'), 430);
    const d = dummy.px - player.x, face = player.face < 0 ? -1 : 1;
    const hit = Math.abs(d) < 30 || (Math.abs(d) <= 150 && Math.sign(d) === face);
    if (hit) HITS.forEach((t, i) => setTimeout(() => hitDummy(i === HITS.length - 1), t));
    else if (++slashCount === 1) toast('🔥 화염검! 연습용 허수아비 앞에서 써 보세요');
  }
  function hitDummy(finisher) {
    restart(dummy.el, 'hit');
    const spark = document.createElement('span');
    spark.className = 'hitspark';
    spark.style.left = dummy.px + 'px';
    fxLayer.appendChild(spark);
    setTimeout(() => spark.remove(), 320);
    const crit = Math.random() < 0.2;
    const dmg = Math.round((1000 + Math.random() * 2000) * (crit ? 1.8 : 1) * (finisher ? 1.5 : 1));
    const el = document.createElement('span');
    el.className = 'dmg' + (crit ? ' crit' : '');
    el.textContent = dmg.toLocaleString('ko-KR');
    el.style.left = dummy.px + 'px';
    el.style.setProperty('--stack', stack);
    stack = (stack + 1) % 4;
    clearTimeout(stackT); stackT = setTimeout(() => { stack = 0; }, 900);
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
  dummy.el.addEventListener('click', e => {
    e.stopPropagation();
    if (dialog.open) closeDialog(false);
    const spot = Math.max(24, Math.min(worldW - 24, dummy.px + (player.x < dummy.px ? -60 : 60)));
    const attack = () => { player.face = Math.sign(dummy.px - player.x) || player.face; render(0); };   // 걸어가서 바라보기만 (공격은 Z 를 아는 사람만)
    player.talkTo = null;
    if (REDUCE || Math.abs(spot - player.x) < 6) { player.x = spot; player.target = null; attack(); return; }
    player.target = spot; player.arrive = attack;
  });

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
    closeQuests();
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
      else if (act === 'quest') { closeDialog(false); openQuests(); }
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

  // ═══════════════════════════ 시간대 (새벽 · 낮 · 노을 · 밤) ═══════════════════════════
  // 기본은 방문자 컴퓨터의 시각을 따르고, 미니맵의 시간 버튼으로 직접 바꿀 수 있음
  const TIMES = [
    { id: 'dawn', icon: '🌅', name: '새벽', from: 5 },
    { id: 'day', icon: '☀️', name: '낮', from: 7 },
    { id: 'dusk', icon: '🌇', name: '노을', from: 17 },
    { id: 'night', icon: '🌙', name: '밤', from: 19 },
  ];
  const timeBtn = $('#timeBtn');
  let timeMode = 'auto';   // 'auto' 또는 TIMES 의 id
  function clockTime() {
    const h = new Date().getHours();
    return [...TIMES].reverse().find(t => h >= t.from) || TIMES[3];   // 0~4시는 밤
  }
  function applyTime(announce) {
    const t = timeMode === 'auto' ? clockTime() : TIMES.find(x => x.id === timeMode);
    const changed = stage.dataset.time !== t.id;
    stage.dataset.time = t.id;
    timeBtn.innerHTML = `${t.icon} ${t.name}${timeMode === 'auto' ? '<small class="auto"> · 자동</small>' : ''}`;
    timeBtn.title = timeMode === 'auto' ? '지금 시각에 맞춘 풍경이에요. 눌러서 시간대를 바꿔 보세요.' : '눌러서 시간대를 바꿔 보세요.';
    timeBtn.setAttribute('aria-label', `시간대 ${t.name}${timeMode === 'auto' ? ', 지금 시각에 맞춤' : ''}. 눌러서 바꾸기`);
    if (announce && changed) toast(`${t.icon} ${t.name}이 되었어요`);
  }
  timeBtn.addEventListener('click', () => {
    const order = ['auto', ...TIMES.map(t => t.id)];
    timeMode = order[(order.indexOf(timeMode) + 1) % order.length];
    applyTime(false);
    const t = TIMES.find(x => x.id === stage.dataset.time);
    toast(timeMode === 'auto' ? `🕐 지금 시각에 맞춰요 (${t.name})` : `${t.icon} ${t.name}이 되었어요`);
  });
  setInterval(() => { if (timeMode === 'auto') applyTime(true); }, 60 * 1000);

  // ═══════════════════════════ 퀘스트 (진행 중인 일 · 해낸 일) ═══════════════════════════
  // 내용은 game-data.js 의 quests 에서 고칩니다.
  const QUESTS = DATA.quests || [];
  const qOpenBtn = $('#qOpen'), qWin = $('#qWin'), qList = $('#qwList'), qDetail = $('#qwDetail'), qhList = $('#qhList');
  const quest = { tab: 'progress', sel: null };
  let qReturn = null;
  const WEEK = '일월화수목금토';
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function dday(s) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const n = Math.round((parseDate(s) - today) / 864e5);
    return n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : `D+${-n}`;
  }
  function fmtDate(s) { const d = parseDate(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; }
  const questsOf = tab => QUESTS.filter(q => (q.status === 'done') === (tab === 'done'));
  function questItem(q, cls) {
    const tail = q.status === 'done' ? '<span class="q-ok">완료</span>' : q.date ? `<span class="q-d">${dday(q.date)}</span>` : '';
    return `<li><button type="button" class="${cls}" data-q="${esc(q.id)}"><span class="q-cat">${esc(q.category || '')}</span><span class="q-t">${esc(q.title)}</span>${tail}</button></li>`;
  }
  function questDetail(q) {
    const done = q.status === 'done';
    return `<div class="qd-badges"><span class="qd-status${done ? ' done' : ''}">${done ? '✔ 완료한 퀘스트' : '▶ 진행 중인 퀘스트'}</span>${q.category ? `<span class="qd-cat">${esc(q.category)}</span>` : ''}</div>
      <h3>${esc(q.title)}</h3>
      ${q.date ? `<p class="qd-date">📅 ${esc(q.dateLabel || '날짜')} <b>${fmtDate(q.date)}</b>${done ? '' : `<span class="q-d">${dday(q.date)}</span>`}</p>` : ''}
      <p class="qd-desc">${htmlUpTo(parse(q.desc || ''), Infinity)}</p>
      ${q.steps ? `<ul class="qd-steps">${q.steps.map(s => `<li class="${s.done ? 'ok' : ''}">${esc(s.text)}</li>`).join('')}</ul>` : ''}
      ${q.reward ? `<p class="qd-reward"><span>보상</span>${esc(q.reward)}</p>` : ''}
      ${q.link ? `<a class="qd-link" href="${esc(q.link.href)}"${/^https?:/.test(q.link.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(q.link.label)} →</a>` : ''}`;
  }
  function renderHelper() {
    const list = questsOf('progress');
    $('#qCount').textContent = list.length;
    qhList.innerHTML = list.map(q => questItem(q, 'qh-item')).join('');
  }
  function renderQuestWin() {
    const list = questsOf(quest.tab);
    qWin.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === quest.tab;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
      b.querySelector('i').textContent = questsOf(b.dataset.tab).length;
    });
    if (!list.some(q => q.id === quest.sel)) quest.sel = list.length ? list[0].id : null;
    qList.innerHTML = list.length ? list.map(q => questItem(q, 'qw-item' + (q.id === quest.sel ? ' on' : ''))).join('') : '<li class="qw-empty">아직 없어요</li>';
    const q = QUESTS.find(x => x.id === quest.sel);
    qDetail.innerHTML = q ? questDetail(q) : '';
  }
  function openQuests(id) {
    const q = id && QUESTS.find(x => x.id === id);
    if (q) { quest.tab = q.status === 'done' ? 'done' : 'progress'; quest.sel = q.id; }
    if (qWin.hidden) qReturn = document.activeElement;
    renderQuestWin();
    qWin.hidden = false;
    requestAnimationFrame(() => qWin.classList.add('show'));
    qOpenBtn.setAttribute('aria-expanded', 'true');
    const cur = qList.querySelector('.on');
    if (cur) cur.focus({ preventScroll: true });
  }
  function closeQuests() {
    if (qWin.hidden) return;
    qWin.classList.remove('show');
    qWin.hidden = true;
    qOpenBtn.setAttribute('aria-expanded', 'false');
    if (qReturn && qReturn.focus && document.body.contains(qReturn)) qReturn.focus({ preventScroll: true });
  }
  qOpenBtn.addEventListener('click', () => (qWin.hidden ? openQuests() : closeQuests()));
  qhList.addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) openQuests(b.dataset.q); });
  qList.addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    quest.sel = b.dataset.q;
    renderQuestWin();
    qList.querySelector('.on').focus({ preventScroll: true });
  });
  qWin.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { quest.tab = b.dataset.tab; quest.sel = null; renderQuestWin(); }));
  $('#qwClose').addEventListener('click', closeQuests);
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (dialog.open) return;
    if (e.key === 'Escape' && !qWin.hidden) { e.preventDefault(); closeQuests(); }
    else if (e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') { e.preventDefault(); qWin.hidden ? openQuests() : closeQuests(); }
  });
  renderHelper();
  setInterval(renderHelper, 10 * 60 * 1000);   // 자정이 지나면 D-day 갱신

  // 빠른 메뉴: data-talk 버튼
  document.querySelectorAll('[data-talk]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); walkAndTalk(b.dataset.talk); }));

  // ═══════════════════════════ 시작 ═══════════════════════════
  $('#mapName').textContent = DATA.mapName;
  // 레벨 = 만 나이, 생일에는 축하 알림
  if (DATA.birth) {
    const [by, bm, bd] = DATA.birth.split('-').map(Number), now = new Date();
    const m = now.getMonth() + 1, d = now.getDate();
    const lv = now.getFullYear() - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
    $('#lv').textContent = `Lv.${lv}`;
    $('#lv').title = `만 ${lv}세`;
    if (m === bm && d === bd) setTimeout(() => toast(`🎂 오늘은 김호성의 생일! 레벨 업! Lv.${lv}`), 800);
  }
  applyTime(false);
  buildNpcs();
  layout();
  startChatter();
  camX = Math.max(0, Math.min(worldW - stage.clientWidth, player.x - stage.clientWidth / 2));
  window.addEventListener('resize', layout);
  requestAnimationFrame(loop);
  document.documentElement.classList.add('game-ready');
})();
