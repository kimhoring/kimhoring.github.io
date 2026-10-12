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
  let map = 'village';   // 'village' 마을 | 'hunt' 사냥터
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
    const prevFrac = worldW ? player.x / worldW : null, prevW = worldW;
    worldW = Math.max(vw, map === 'hunt' ? (vw < 640 ? 1400 : 1600) : (vw < 640 ? 1550 : 1800));
    world.style.width = worldW + 'px';
    npcs.forEach(n => {
      n.px = Math.round(n.x * worldW);
      n.el.style.left = n.px + 'px';
      const img = n.el.querySelector('img.sprite');
      if (img) { img.src = sprite(n.sprite, scale); img.width = W * scale; img.height = SPRITE_H * scale; }
    });
    // 소품 위치 (data-at: 마을 기준, data-hat: 사냥터 기준)
    document.querySelectorAll(map === 'hunt' ? '[data-hat]' : '[data-at]').forEach(el => { el.style.left = Math.round(parseFloat(map === 'hunt' ? el.dataset.hat : el.dataset.at) * worldW) + 'px'; });
    if (map === 'hunt' && prevW) mobs.forEach(m => { m.x *= worldW / prevW; setMobSprite(m); });
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
    if (map === 'hunt') { toast('🏡 마을 사람과는 마을에서 이야기할 수 있어요 (왼쪽 포탈)'); return; }
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
    if (player.dash) {   // 화염 돌진: 정해진 거리를 빠르게 미끄러지듯
      const d = player.dash; d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      player.x = d.from + (d.to - d.from) * (1 - Math.pow(1 - k, 3));
      if (k >= 1) player.dash = null;
      dir = 0;
    }
    else if (dir) { player.target = null; player.talkTo = null; player.arrive = null; player.x += dir * SPEED * dt; moving = true; player.face = dir; }
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
    if (map === 'hunt') updateMobs(dt);
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
    // 포탈 · 사냥터
    (map === 'hunt' ? portals.home : portals.hunt).classList.toggle('near', nearPortal());
    if (map === 'hunt') renderMobs();
    // 미니맵
    if (mm.player) mm.player.style.left = (player.x / worldW * 100).toFixed(2) + '%';
  }
  function nearest(range) {
    if (map === 'hunt') return null;
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
    else if (['x', 'X', 'ㅌ'].includes(e.key) && !e.repeat) { e.preventDefault(); useSkill('dash'); }
    else if (['c', 'C', 'ㅊ'].includes(e.key) && !e.repeat) { e.preventDefault(); useSkill('storm'); }
    else if (['s', 'S', 'ㄴ'].includes(e.key) && !e.repeat) { e.preventDefault(); toggleStats(); }
    else if (['ArrowUp', 'w', 'W', 'ㅈ', 'Alt'].includes(e.key)) {
      e.preventDefault();
      if (!e.repeat) { if (e.key === 'ArrowUp' && nearPortal()) enterPortal(); else jump(); }   // 포탈 앞에서 ↑ = 이동
    }
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
  const COOL = window.HUNT_DATA.skills.find(sk => sk.id === 'slash').cool;   // ms
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
          life: 0, max: 0.14 + Math.random() * 0.16, r: (1.5 + Math.random() * 2.2) * S * (big ? 1.15 : 1),
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
    g.drawImage(attackBase(atk.walk), OX * S, OY * S, 16 * S, 23 * S);   // 몸은 불꽃 위에 → 불꽃이 캐릭터를 가리지 않음
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

  let lastSlash = 0, slashCount = 0;
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  function slash() {
    const now = performance.now();
    if (dialog.open || (lastSlash && now - lastSlash < COOL)) return;
    lastSlash = now;
    restart(player.el, 'slashing');
    playAttack();
    coolBtn('slash', COOL);
    clearTimeout(player.slashT);
    player.slashT = setTimeout(() => player.el.classList.remove('slashing'), 960);
    setTimeout(() => restart(world, 'shake'), 430);
    if (map === 'hunt') {   // 앞쪽 150px 안의 빌런을 가까운 순서로 3마리까지
      HITS.forEach((t, i) => setTimeout(() => strikeFront(150, i === HITS.length - 1 ? 1.5 : 1, 3), t));
      return;
    }
    const d = dummy.px - player.x, face = player.face < 0 ? -1 : 1;
    const hit = Math.abs(d) < 30 || (Math.abs(d) <= 150 && Math.sign(d) === face);
    if (hit) HITS.forEach((t, i) => setTimeout(() => hitDummy(i === HITS.length - 1), t));
    else if (++slashCount === 1) toast('🔥 화염검! 연습용 허수아비 앞에서 써 보세요');
  }
  function hitDummy(finisher) {
    restart(dummy.el, 'hit');
    spark(dummy.px);
    const { dmg, crit } = rollDamage(finisher ? 1.5 : 1);
    number(dummy, dmg.toLocaleString('ko-KR'), crit ? 'crit' : '');
  }
  function spark(x) {
    const el = document.createElement('span');
    el.className = 'hitspark';
    el.style.left = x + 'px';
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 320);
  }
  // 떠오르는 숫자 (같은 대상에 연달아 맞으면 위로 쌓임). t: { x } 또는 { px }
  function number(t, text, cls) {
    const el = document.createElement('span');
    el.className = `dmg ${cls}`;
    el.textContent = text;
    el.style.left = (t.x != null ? t.x : t.px) + 'px';
    el.style.setProperty('--stack', t.stack || 0);
    t.stack = ((t.stack || 0) + 1) % 4;
    clearTimeout(t.stackT); t.stackT = setTimeout(() => { t.stack = 0; }, 900);
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
  function floatText(x, text, cls) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    el.style.left = x + 'px';
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 1500);
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


  // ═══════════════════════════ 사냥터: 포탈 · 빌런 몬스터 · 전투 성장 · 스킬 ═══════════════════════════
  // 마을 오른쪽 끝 포탈에서 ↑ (또는 포탈 클릭) → 사냥터. 빌런을 물리치면 전투 경험치 → 레벨 업 → 능력치 포인트 · 새 스킬
  const HUNT = window.HUNT_DATA;
  const mobLayer = $('#mobs'), fxBack = $('#fxBack'), statWin = $('#statWin'), skillBar = $('#skillBar');
  const portals = { hunt: $('#portalHunt'), home: $('#portalHome') };
  const mobs = [];
  const battle = Object.assign({ lv: 1, exp: 0, ap: 0, str: 0, dex: 0, vit: 0 }, store.get('hs.battle', {}));
  const maxHp = () => 100 + 15 * (battle.lv - 1) + 20 * battle.vit;
  battle.hp = maxHp();
  const expNeed = lv => 30 + (lv - 1) * 25;
  const critRate = () => Math.min(0.75, 0.15 + 0.03 * battle.dex);
  const atkPow = () => 1000 * (1 + 0.12 * (battle.lv - 1)) * (1 + 0.08 * battle.str);
  function rollDamage(mult) {
    const crit = Math.random() < critRate();
    return { dmg: Math.round(atkPow() * (0.7 + Math.random() * 0.6) * mult * (crit ? 1.8 : 1)), crit };
  }
  function saveBattle() { const { hp, ...keep } = battle; store.set('hs.battle', keep); }
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // ── 포탈 ──
  const curPortalPx = () => Math.round((map === 'hunt' ? 0.035 : 0.98) * worldW);
  const nearPortal = () => !dialog.open && Math.abs(curPortalPx() - player.x) < 50;
  let warping = false;
  function enterPortal() {
    if (warping) return;
    warping = true;
    const to = map === 'hunt' ? 'village' : 'hunt';
    closeQuests();
    stage.classList.add('warping');
    setTimeout(() => {
      map = to;
      stage.classList.toggle('hunting', to === 'hunt');
      if (to === 'hunt') clearMobs();
      layout();
      player.x = to === 'hunt' ? curPortalPx() + 80 : curPortalPx() - 80;
      player.target = null; player.talkTo = null; player.arrive = null; player.dash = null; player.y = 0; player.vy = 0;
      camX = Math.max(0, Math.min(worldW - stage.clientWidth, player.x - stage.clientWidth / 2));
      if (to === 'hunt') spawnAll(); else clearMobs();
      $('#mapName').textContent = to === 'hunt' ? HUNT.mapName : DATA.mapName;
      updateHud();
      render(0);
      setTimeout(() => { stage.classList.remove('warping'); warping = false; }, 80);
      toast(to === 'hunt' ? '⚔️ 빌런 출몰 지역! 빌런을 물리치고 경험치를 모아 보세요' : '🏡 김호성의 마을로 돌아왔어요');
    }, 380);
  }
  Object.values(portals).forEach(p => p.addEventListener('click', e => {
    e.stopPropagation();
    if (dialog.open) closeDialog(false);
    const px = curPortalPx();
    player.talkTo = null;
    if (REDUCE || Math.abs(px - player.x) < 8) { player.x = px; enterPortal(); return; }
    player.target = px; player.arrive = enterPortal;
  }));

  // ── 빌런 몬스터 ──
  const mobArtCache = {};
  function setMobSprite(m) {   // 빌런 그림은 hunt-data.js 의 HUNT_ART (플레이어보다 큰 24×29 격자)
    const art = window.HUNT_ART[m.def.id], k = `${m.def.id}|${scale}`;
    if (!mobArtCache[k]) mobArtCache[k] = draw(art.rows, art.pal, scale);
    m.img.src = mobArtCache[k];
    m.img.width = art.rows[0].length * scale; m.img.height = art.rows.length * scale;
  }
  function spawnMob(def, x) {
    const el = document.createElement('div');
    el.className = `mob mob-${def.id}`;
    el.innerHTML = `<span class="mob-say"></span><span class="mob-hp"><i></i></span><img alt=""><span class="tag">${def.name} <small>Lv.${def.lv}</small></span>`;
    mobLayer.appendChild(el);
    const m = { def, el, img: el.querySelector('img'), hpEl: el.querySelector('.mob-hp i'), say: el.querySelector('.mob-say'),
      x, hp: def.hp, vx: 0, face: -1, t: 0, stun: 0, kb: 0, aggro: 0, dead: false, sayT: 2 + Math.random() * 6 };
    setMobSprite(m);
    mobs.push(m);
    return m;
  }
  function randomX() {
    let x, n = 0;
    do { x = 300 + Math.random() * (worldW - 400); } while (Math.abs(x - player.x) < 220 && ++n < 20);
    return x;
  }
  function spawnAll() { clearMobs(); HUNT.mobs.forEach(def => { for (let i = 0; i < def.count; i++) spawnMob(def, randomX()); }); }
  function clearMobs() { mobs.forEach(m => { clearTimeout(m.respawnT); m.el.remove(); }); mobs.length = 0; }
  function updateMobs(dt) {
    const now = performance.now();
    for (const m of mobs) {
      if (m.dead) continue;
      if (m.stun > 0) { m.stun -= dt; m.x += m.kb * dt; m.kb *= 0.86; }
      else if (m.aggro > 0) {   // 맞으면 잠시 쫓아옴
        m.aggro -= dt;
        const d = player.x - m.x;
        if (Math.abs(d) > 20) { m.face = Math.sign(d); m.x += m.face * m.def.speed * 1.7 * dt; }
      } else {   // 어슬렁어슬렁
        m.t -= dt;
        if (m.t <= 0) { const r = Math.random(); m.vx = r < 0.3 ? 0 : (r < 0.65 ? -1 : 1) * m.def.speed; m.t = 1.2 + Math.random() * 2.2; }
        m.x += m.vx * dt;
        if (m.vx) m.face = Math.sign(m.vx);
      }
      if (m.x < 200 || m.x > worldW - 60) { m.x = Math.max(200, Math.min(worldW - 60, m.x)); m.vx = -m.vx; }
      m.sayT -= dt;
      if (m.sayT <= 0) {
        m.say.textContent = pick(m.def.quotes);
        m.el.classList.add('saying');
        setTimeout(() => m.el.classList.remove('saying'), 2400);
        m.sayT = 6 + Math.random() * 8;
      }
      if (!player.invul && now - (player.hurtAt || 0) > 900 && Math.abs(m.x - player.x) < 30 && player.y < 26) hurtPlayer(m);
    }
    if (now - (player.hurtAt || 0) > 3000 && battle.hp < maxHp()) { battle.hp = Math.min(maxHp(), battle.hp + maxHp() * 0.03 * dt); updateHp(); }
  }
  function renderMobs() { for (const m of mobs) { m.el.style.left = m.x.toFixed(1) + 'px'; m.el.style.setProperty('--mf', m.face < 0 ? -1 : 1); } }   // 가는 쪽을 바라봄
  function strikeFront(range, mult, max) {
    const face = player.face < 0 ? -1 : 1;
    mobs.filter(m => { const d = m.x - player.x; return !m.dead && (Math.abs(d) < 30 || (Math.abs(d) <= range && Math.sign(d) === face)); })
      .sort((p, q) => Math.abs(p.x - player.x) - Math.abs(q.x - player.x)).slice(0, max)
      .forEach(m => hitMob(m, mult));
  }
  function hitMob(m, mult) {
    if (m.dead || map !== 'hunt') return;
    const { dmg, crit } = rollDamage(mult);
    m.hp -= dmg;
    m.aggro = 4; m.stun = 0.22; m.kb = (m.x >= player.x ? 1 : -1) * 160;
    restart(m.el, 'hit');
    m.el.classList.add('hurt-shown');
    spark(m.x);
    number(m, dmg.toLocaleString('ko-KR'), crit ? 'crit' : '');
    m.hpEl.style.width = Math.max(0, m.hp / m.def.hp * 100) + '%';
    if (m.hp <= 0) killMob(m);
  }
  function killMob(m) {
    m.dead = true;
    m.el.classList.add('dead');
    gainExp(m.def.exp, m.x);
    m.respawnT = setTimeout(() => {
      m.el.remove();
      const i = mobs.indexOf(m);
      if (i >= 0) mobs.splice(i, 1);
      if (map === 'hunt') spawnMob(m.def, randomX());
    }, 4000);
  }
  function hurtPlayer(m) {
    const dmg = Math.max(1, Math.round(m.def.atk * (0.85 + Math.random() * 0.3)));
    battle.hp -= dmg;
    player.hurtAt = performance.now();
    number(player, `-${dmg}`, 'hurt');
    player.x = Math.max(24, Math.min(worldW - 24, player.x + (player.x >= m.x ? 1 : -1) * 40));
    player.target = null; player.arrive = null;
    restart(player.el, 'hurt');
    if (battle.hp <= 0) {
      battle.hp = maxHp();
      player.x = curPortalPx() + 80;
      toast('💫 기절했어요! 입구에서 다시 시작해요');
    }
    updateHp();
  }

  // ── 경험치 · 레벨 업 ──
  function gainExp(n, x) {
    battle.exp += n;
    floatText(x, `+${n} EXP`, 'expgain');
    while (battle.exp >= expNeed(battle.lv)) {
      battle.exp -= expNeed(battle.lv);
      battle.lv++; battle.ap += 3; battle.hp = maxHp();
      floatText(player.x, 'LEVEL UP!', 'lvup');
      const sk = HUNT.skills.find(k => k.lv === battle.lv);
      toast(`⭐ 전투 Lv.${battle.lv}! 능력치 포인트 +3 (S)${sk ? ` · 새 스킬 「${sk.name}」 (${sk.key})` : ''}`);
    }
    saveBattle(); updateHud(); renderStats();
  }

  // ── 스킬: 화염 돌진 · 화염 폭풍 ──
  const cools = {};
  function coolBtn(id, ms) {
    const b = skillBar.querySelector(`[data-skill="${id}"]`);
    if (!b) return;
    b.style.setProperty('--cd', `${ms}ms`);
    restart(b, 'cool');
  }
  function useSkill(id) {
    const sk = HUNT.skills.find(k => k.id === id);
    if (!sk || dialog.open) return;
    if (battle.lv < sk.lv) { if (map === 'hunt') toast(`🔒 「${sk.name}」은(는) 전투 Lv.${sk.lv}에 배워요`); return; }
    if (id === 'slash') { slash(); return; }
    const now = performance.now();
    if (cools[id] && now - cools[id] < sk.cool) return;   // 처음 쓸 때는 바로
    cools[id] = now;
    coolBtn(id, sk.cool);
    if (id === 'dash') dash(); else if (id === 'storm') storm();
  }
  function hitAt(lo, hi, mult) {   // lo~hi 안의 대상 (사냥터: 빌런, 마을: 허수아비)
    if (map === 'hunt') mobs.filter(m => !m.dead && m.x >= lo && m.x <= hi).forEach(m => hitMob(m, mult));
    else if (dummy.px >= lo && dummy.px <= hi) hitDummy(false);
  }
  function dash() {
    const dir = player.face < 0 ? -1 : 1, from = player.x, to = Math.max(24, Math.min(worldW - 24, from + dir * 230));
    player.dash = { t: 0, dur: 0.22, from, to };
    player.invul = true; player.target = null; player.arrive = null;
    restart(player.el, 'dashing');
    const src = player.img.src;
    for (let i = 1; i <= 4; i++) setTimeout(() => ghost(src, from + (to - from) * i / 5, dir), i * 45);   // 잔상
    for (let i = 0; i <= 7; i++) setTimeout(() => groundFire(from + (to - from) * i / 7), i * 30);    // 지나간 길에 불길
    const lo = Math.min(from, to) - 25, hi = Math.max(from, to) + 25;
    [140, 280].forEach(t => setTimeout(() => hitAt(lo, hi, 1.3), t));
    setTimeout(() => { player.invul = false; player.el.classList.remove('dashing'); }, 420);
  }
  function storm() {
    const cx = player.x;
    setTimeout(() => restart(world, 'shake'), 150);
    [70, -70, 140, -140, 210, -210].forEach((o, i) => setTimeout(() => {
      const x = cx + o;
      pillar(x);
      [120, 320].forEach(t => setTimeout(() => hitAt(x - 50, x + 50, 1.1), t));
    }, Math.floor(i / 2) * 110));
  }
  function fxEl(cls, x, html, life) {
    const el = document.createElement('span');
    el.className = cls;
    el.style.left = x.toFixed(0) + 'px';
    if (html) el.innerHTML = html;
    fxBack.appendChild(el);
    setTimeout(() => el.remove(), life);
    return el;
  }
  function ghost(src, x, dir) {
    const el = fxEl('ghost', x, `<img alt="" src="${src}" width="${W * scale}" height="${SPRITE_H * scale}">`, 380);
    el.style.setProperty('--f', dir);
  }
  const groundFire = x => fxEl('groundfire', x, '', 600);
  const pillar = x => fxEl('pillar', x, '<i class="o"></i><i class="m"></i><i class="c"></i>', 850);

  // ── 능력치 창 (S) ──
  function renderStats() {
    if (statWin.hidden) return;
    const need = expNeed(battle.lv), lo = Math.round(atkPow() * 0.7), hi = Math.round(atkPow() * 1.3);
    const row = (k, icon, name, eff) => `<li><span>${icon} ${name}</span><b>${battle[k]}</b><small>${eff}</small><button type="button" data-stat="${k}" aria-label="${name} 올리기"${battle.ap ? '' : ' disabled'}>+</button></li>`;
    statWin.querySelector('.sw-body').innerHTML = `
      <div class="sw-lv"><b>전투 Lv.${battle.lv}</b><span>EXP ${battle.exp} / ${need}</span></div>
      <div class="sw-bar"><i style="width:${(battle.exp / need * 100).toFixed(1)}%"></i></div>
      <dl class="sw-info">
        <div><dt>공격력</dt><dd>${lo.toLocaleString('ko-KR')} ~ ${hi.toLocaleString('ko-KR')}</dd></div>
        <div><dt>치명타</dt><dd>${Math.round(critRate() * 100)}%</dd></div>
        <div><dt>HP</dt><dd>${Math.ceil(battle.hp)} / ${maxHp()}</dd></div>
      </dl>
      <p class="sw-ap">능력치 포인트 <b>${battle.ap}</b>${battle.ap ? ' · + 를 눌러 올리세요' : ' · 레벨 업 하면 3씩 생겨요'}</p>
      <ul class="sw-stats">${row('str', '💪', '힘', '공격력 +8%')}${row('dex', '🎯', '민첩', '치명타 +3%p')}${row('vit', '❤️', '체력', '최대 HP +20')}</ul>
      <h4>스킬</h4>
      <ul class="sw-skills">${HUNT.skills.map(k => {
        const on = battle.lv >= k.lv;
        return `<li class="${on ? 'on' : 'lock'}"><span class="ic">${on ? k.icon : '🔒'}</span><b>${k.name}</b><kbd>${k.key}</kbd><small>${on ? k.desc : `전투 Lv.${k.lv}에 배워요`}</small></li>`;
      }).join('')}</ul>`;
  }
  function toggleStats(force) {
    const open = force != null ? force : statWin.hidden;
    statWin.hidden = !open;
    if (open) { renderStats(); statWin.querySelector('.sw-close').focus({ preventScroll: true }); }
  }
  statWin.addEventListener('click', e => {
    if (e.target.closest('.sw-close')) { toggleStats(false); return; }
    const b = e.target.closest('[data-stat]');
    if (!b || battle.ap <= 0) return;
    battle[b.dataset.stat]++; battle.ap--;
    if (b.dataset.stat === 'vit') battle.hp += 20;
    saveBattle(); renderStats(); updateHud();
    const nb = statWin.querySelector(`[data-stat="${b.dataset.stat}"]`);
    if (nb && !nb.disabled) nb.focus({ preventScroll: true });
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !statWin.hidden && !dialog.open) { e.preventDefault(); toggleStats(false); } });

  // ── 사냥터 HUD: HP · 전투 EXP · 스킬 버튼 ──
  skillBar.innerHTML = `<button type="button" class="skill" data-skill="jump" aria-label="점프"><span class="ic" aria-hidden="true">⬆️</span><kbd>↑</kbd><span class="sn">점프</span></button>`
    + HUNT.skills.map(k => `<button type="button" class="skill" data-skill="${k.id}" aria-label="${k.name}"><span class="ic" aria-hidden="true">${k.icon}</span><kbd>${k.key}</kbd><span class="sn">${k.name}</span><span class="cd"></span><span class="lock">Lv.${k.lv}</span></button>`).join('')
    + `<button type="button" class="skill" data-skill="stats" aria-label="능력치"><span class="ic" aria-hidden="true">📊</span><kbd>S</kbd><span class="sn">능력치</span><span class="ap-dot" hidden></span></button>`;
  skillBar.addEventListener('click', e => {
    const b = e.target.closest('[data-skill]');
    if (!b) return;
    e.stopPropagation();
    const id = b.dataset.skill;
    if (id === 'jump') jump(); else if (id === 'stats') toggleStats(); else useSkill(id);
  });
  function updateHp() {
    const mx = maxHp();
    $('#hpFill').style.width = Math.max(0, battle.hp / mx * 100) + '%';
    $('#hpText').textContent = `${Math.ceil(Math.max(0, battle.hp))} / ${mx}`;
  }
  function updateHud() {
    if (map === 'hunt') {
      const need = expNeed(battle.lv);
      $('#expLabel').textContent = `전투 Lv.${battle.lv}`;
      $('#expFill').style.width = (battle.exp / need * 100) + '%';
      $('#expText').textContent = `EXP ${battle.exp} / ${need}`;
    } else {
      $('#expLabel').textContent = 'EXP';
      updateQuest(false);
    }
    skillBar.querySelectorAll('[data-skill]').forEach(b => {
      const k = HUNT.skills.find(x => x.id === b.dataset.skill);
      b.classList.toggle('locked', !!k && battle.lv < k.lv);
    });
    skillBar.querySelector('.ap-dot').hidden = !battle.ap;
    updateHp();
  }

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
      + `<span class="mm-portal" aria-hidden="true" style="left:${map === 'hunt' ? 3.5 : 98}%"></span><span class="mm-player" aria-hidden="true"></span>`;
    mm.dots = [...track.querySelectorAll('.mm-dot')];
    mm.player = track.querySelector('.mm-player');
    mm.dots.forEach(d => d.addEventListener('click', () => walkAndTalk(d.dataset.id)));
    updateHud();
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
  // 완료: status 가 'done' 이거나, 날짜가 지난 진행 중 퀘스트 (시험 · 대회가 끝나면 저절로 완료 탭으로)
  function isDone(q) {
    if (q.status === 'done') return true;
    if (!q.date) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return parseDate(q.date) < today;
  }
  const questsOf = tab => QUESTS.filter(q => isDone(q) === (tab === 'done'));
  function questItem(q, cls) {
    const tail = isDone(q) ? '<span class="q-ok">완료</span>' : q.date ? `<span class="q-d">${dday(q.date)}</span>` : '';
    return `<li><button type="button" class="${cls}" data-q="${esc(q.id)}"><span class="q-cat">${esc(q.category || '')}</span><span class="q-t">${esc(q.title)}</span>${tail}</button></li>`;
  }
  function questDetail(q) {
    const done = isDone(q);
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
    if (q) { quest.tab = isDone(q) ? 'done' : 'progress'; quest.sel = q.id; }
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
