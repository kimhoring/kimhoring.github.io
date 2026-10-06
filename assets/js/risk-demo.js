/* ═══════════════════════════════════════════════════════════════
 *  위험 반경 시뮬레이터 (간이판)
 *  - 좌표: x 동쪽, y 남쪽, 단위 m (앱과 같은 현장 좌표계)
 *  - 판정 순서: 위험 구역 안(R≥70) → 진입 / 위험 구역까지 8m+오차 이내 → 접근 경고
 *              / 위험도 30~70 → 주의 / 그 외 → 안전
 * ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';
  const canvas = document.getElementById('demoCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W_M = 60, H_M = 36;                 // 시뮬레이션 영역 (m)
  const WARN_M = 8, MAX_UNCERT = 8, DANGER_R = 70, CAUTION_R = 30;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = (id) => document.getElementById(id);
  const ui = {
    card: el('levelCard'), name: el('lvName'), msg: el('lvMsg'), dist: el('roDist'), risk: el('roRisk'),
    sigma: el('sigma'), sigmaOut: el('sigmaOut'), drive: el('driveBtn'), reset: el('resetBtn'), hint: el('demoHint'),
  };

  // ── 장비 모델 (앱의 기본 제원) ──
  const excavator = { type: 'excavator', label: '굴착기', icon: '🚜', x: 22, y: 20, heading: 0, rMax: 8, rBlind: 5, thetaBlind: 120 * Math.PI / 180, W: 1.3 };
  const crane = { type: 'crane', label: '이동식 크레인', icon: '🏗️', x: 47, y: 9, heading: 100 * Math.PI / 180, lBoom: 14, rLoad: 3, rOut: 5, W: 1.1 };
  const hole = { label: '개구부', icon: '🕳️', x: 6.5, y: 7, radius: 3.2, level: 3 };   // 위험물: R = 등급 × 20
  const E_ORANGE = 45;   // Orange 구역 기본 점수 (× W_freq)
  const state = { worker: { x: 4, y: 29 }, sigma: 3, driving: false, dir: 1, dragging: false, last: 0, moved: false };

  const angDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  const segClosest = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
    return { x: x1 + t * dx, y: y1 + t * dy };
  };
  const boomEnd = () => ({ x: crane.x + crane.lBoom * Math.cos(crane.heading), y: crane.y + crane.lBoom * Math.sin(crane.heading) });

  /** 위치의 위험도와 원인 */
  function riskAt(x, y) {
    let best = { R: 0, src: '' };
    const take = (R, src) => { if (R > best.R) best = { R, src }; };
    // 굴착기: 작업반경 Red, 후방 사각지대 Orange
    const de = Math.hypot(x - excavator.x, y - excavator.y);
    if (de <= excavator.rMax) take(100, '굴착기 · Red (작업반경)');
    if (de <= excavator.rBlind && angDiff(Math.atan2(y - excavator.y, x - excavator.x), excavator.heading + Math.PI) <= excavator.thetaBlind / 2)
      take(Math.min(100, E_ORANGE * excavator.W), '굴착기 · Orange (후방 사각지대)');
    // 이동식 크레인: 붐 아래 Red, 아웃트리거 Orange
    const be = boomEnd(), c = segClosest(x, y, crane.x, crane.y, be.x, be.y);
    if (Math.hypot(x - c.x, y - c.y) <= crane.rLoad) take(100, '이동식 크레인 · Red (붐 아래)');
    if (Math.hypot(x - crane.x, y - crane.y) <= crane.rOut) take(Math.min(100, E_ORANGE * crane.W), '이동식 크레인 · Orange (아웃트리거)');
    if (Math.hypot(x - hole.x, y - hole.y) <= hole.radius) take(hole.level * 20, `${hole.label} · 등급 ${hole.level}`);
    return best;
  }

  /** 가장 가까운 위험 구역(R≥70) 경계까지 거리와 그 지점 */
  function nearestDanger(x, y) {
    const out = [];
    const de = Math.hypot(x - excavator.x, y - excavator.y);
    out.push({ d: Math.max(0, de - excavator.rMax), px: excavator.x + (x - excavator.x) / (de || 1) * excavator.rMax, py: excavator.y + (y - excavator.y) / (de || 1) * excavator.rMax, src: '굴착기' });
    const be = boomEnd(), c = segClosest(x, y, crane.x, crane.y, be.x, be.y), dc = Math.hypot(x - c.x, y - c.y);
    out.push({ d: Math.max(0, dc - crane.rLoad), px: c.x + (x - c.x) / (dc || 1) * crane.rLoad, py: c.y + (y - c.y) / (dc || 1) * crane.rLoad, src: '이동식 크레인' });
    return out.sort((a, b) => a.d - b.d)[0];
  }

  const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const compass = (dx, dy) => DIRS[Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 45) % 8];

  function assess() {
    const { x, y } = state.worker;
    const r = riskAt(x, y), n = nearestDanger(x, y);
    const warnR = WARN_M + Math.min(MAX_UNCERT, state.sigma);
    let lv = 'safe';
    if (r.R >= DANGER_R) lv = 'danger';
    else if (n.d <= warnR) lv = 'warning';
    else if (r.R >= CAUTION_R) lv = 'caution';
    return { lv, R: r.R, src: r.src, near: n, warnR };
  }

  const LV = {
    safe: ['안전', '주변 위험 구역에서 충분히 떨어져 있습니다.'],
    caution: ['주의', ''],
    warning: ['위험 구역 접근', ''],
    danger: ['위험 구역 진입', ''],
  };
  let lastLv = null;
  function updatePanel(a) {
    ui.card.dataset.lv = a.lv;
    ui.name.textContent = LV[a.lv][0];
    const fmt = (m) => (m >= 10 ? `${Math.round(m)} m` : `${m.toFixed(1)} m`);
    if (a.lv === 'danger') ui.msg.textContent = `즉시 벗어나세요! 관리자에게 알림이 전송됩니다. 원인: ${a.src}`;
    else if (a.lv === 'warning') ui.msg.textContent = `${a.near.src} 위험 구역까지 약 ${fmt(a.near.d)} — ${compass(a.near.px - state.worker.x, a.near.py - state.worker.y)}쪽으로 가지 마세요.`;
    else if (a.lv === 'caution') ui.msg.textContent = `위험도 ${Math.round(a.R)} 구역입니다. 원인: ${a.src}`;
    else ui.msg.textContent = LV.safe[1];
    ui.dist.textContent = a.lv === 'danger' ? '안쪽' : fmt(a.near.d);
    ui.risk.textContent = Math.round(a.R);
    if (lastLv && lastLv !== a.lv && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive) && (a.lv === 'warning' || a.lv === 'danger')) { try { navigator.vibrate(a.lv === 'danger' ? [200, 80, 200] : 120); } catch (e) { /* 무시 */ } }
    lastLv = a.lv;
  }

  // ── 렌더링 ──
  let S = 10, CW = 0, CH = 0, DPR = 1;
  const X = (m) => m * S, Y = (m) => m * S;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    CW = Math.max(1, r.width); CH = Math.max(1, r.height);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    S = Math.min(CW / W_M, CH / H_M);
    draw();
  }

  function capsulePath(x1, y1, x2, y2, r) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.arc(X(x2), Y(y2), r * S, a - Math.PI / 2, a + Math.PI / 2);
    ctx.arc(X(x1), Y(y1), r * S, a + Math.PI / 2, a + Math.PI * 1.5);
    ctx.closePath();
  }

  function icon(x, y, emoji, label, ring) {
    ctx.beginPath(); ctx.arc(X(x), Y(y), 15, 0, Math.PI * 2);
    ctx.fillStyle = '#fffaf2'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = ring; ctx.stroke();
    ctx.font = '16px "Segoe UI Emoji","Apple Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, X(x), Y(y) + 1);
    if (label) {
      ctx.font = '600 12px Pretendard Variable, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(251,246,236,.95)';
      ctx.strokeText(label, X(x), Y(y) - 25); ctx.fillStyle = '#2b1f16'; ctx.fillText(label, X(x), Y(y) - 25);
    }
  }

  function draw() {
    const a = assess();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#efe4d3'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#fbf6ec'; ctx.fillRect(0, 0, X(W_M), Y(H_M));
    // 격자 (2 m · 10 m)
    for (let m = 0; m <= W_M; m += 2) { ctx.strokeStyle = m % 10 ? 'rgba(102,70,42,.07)' : 'rgba(102,70,42,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(m) + .5, 0); ctx.lineTo(X(m) + .5, Y(H_M)); ctx.stroke(); }
    for (let m = 0; m <= H_M; m += 2) { ctx.strokeStyle = m % 10 ? 'rgba(102,70,42,.07)' : 'rgba(102,70,42,.18)'; ctx.beginPath(); ctx.moveTo(0, Y(m) + .5); ctx.lineTo(X(W_M), Y(m) + .5); ctx.stroke(); }

    // 접근 경고 거리 (점선)
    ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(196,85,45,.5)';
    ctx.beginPath(); ctx.arc(X(excavator.x), Y(excavator.y), (excavator.rMax + a.warnR) * S, 0, Math.PI * 2); ctx.stroke();
    const be = boomEnd();
    capsulePath(crane.x, crane.y, be.x, be.y, crane.rLoad + a.warnR); ctx.stroke();
    ctx.setLineDash([]);

    // 위험물 (개구부)
    ctx.fillStyle = 'rgba(210,154,30,.2)'; ctx.strokeStyle = 'rgba(176,124,20,.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(hole.x), Y(hole.y), hole.radius * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Orange 구역
    ctx.fillStyle = 'rgba(216,112,40,.24)'; ctx.strokeStyle = 'rgba(196,96,30,.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(crane.x), Y(crane.y), crane.rOut * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Red 구역
    ctx.fillStyle = 'rgba(192,57,43,.17)'; ctx.strokeStyle = 'rgba(176,48,36,.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(excavator.x), Y(excavator.y), excavator.rMax * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    capsulePath(crane.x, crane.y, be.x, be.y, crane.rLoad); ctx.fill(); ctx.stroke();
    // 굴착기 후방 사각지대
    const rear = excavator.heading + Math.PI;
    ctx.beginPath(); ctx.moveTo(X(excavator.x), Y(excavator.y));
    ctx.arc(X(excavator.x), Y(excavator.y), excavator.rBlind * S, rear - excavator.thetaBlind / 2, rear + excavator.thetaBlind / 2); ctx.closePath();
    ctx.fillStyle = 'rgba(216,112,40,.32)'; ctx.fill(); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(176,84,24,.9)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    // 크레인 붐
    ctx.strokeStyle = '#b7862b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(X(crane.x), Y(crane.y)); ctx.lineTo(X(be.x), Y(be.y)); ctx.stroke();
    // 굴착기 진행 방향
    const hx = excavator.x + Math.cos(excavator.heading) * 3.2, hy = excavator.y + Math.sin(excavator.heading) * 3.2;
    ctx.strokeStyle = '#2b1f16'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X(excavator.x), Y(excavator.y)); ctx.lineTo(X(hx), Y(hy)); ctx.stroke();

    icon(excavator.x, excavator.y, excavator.icon, state.driving ? '굴착기 (운행 중)' : '굴착기', '#c0392b');
    icon(crane.x, crane.y, crane.icon, '이동식 크레인', '#c4552d');
    icon(hole.x, hole.y, hole.icon, '개구부 (등급 3)', '#b7862b');

    // 작업자 · 위험 구역까지 선
    const w = state.worker;
    const col = { safe: '#5f8a3e', caution: '#c9900f', warning: '#d9662a', danger: '#c0392b' }[a.lv];
    if (a.lv !== 'danger' && a.near.d <= a.warnR + 6) {
      ctx.setLineDash([3, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(w.x), Y(w.y)); ctx.lineTo(X(a.near.px), Y(a.near.py)); ctx.stroke(); ctx.setLineDash([]);
      const mx = (w.x + a.near.px) / 2, my = (w.y + a.near.py) / 2, t = `${a.near.d.toFixed(1)} m`;
      ctx.font = '700 12px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(t).width + 12;
      ctx.fillStyle = 'rgba(255,250,242,.95)'; ctx.fillRect(X(mx) - tw / 2, Y(my) - 10, tw, 20);
      ctx.fillStyle = col; ctx.fillText(t, X(mx), Y(my));
    }
    if (state.sigma > 0) {
      ctx.beginPath(); ctx.arc(X(w.x), Y(w.y), state.sigma * S, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(183,134,43,.14)'; ctx.fill(); ctx.strokeStyle = 'rgba(160,112,30,.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (a.lv === 'danger' && !reduceMotion) {
      const p = (performance.now() % 1000) / 1000;
      ctx.beginPath(); ctx.arc(X(w.x), Y(w.y), 14 + p * 20, 0, Math.PI * 2); ctx.strokeStyle = `rgba(192,57,43,${1 - p})`; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(X(w.x), Y(w.y), 11, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(43,31,22,.5)'; ctx.beginPath(); ctx.arc(X(w.x), Y(w.y), 12.5, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '600 12px Pretendard Variable, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(251,246,236,.95)'; ctx.strokeText('👷 나', X(w.x), Y(w.y) + 24); ctx.fillStyle = '#2b1f16'; ctx.fillText('👷 나', X(w.x), Y(w.y) + 24);

    // 축척 막대
    const bx = X(W_M) - X(10) - 14, by = Y(H_M) - 16;
    ctx.strokeStyle = '#2b1f16'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + X(10), by); ctx.lineTo(bx + X(10), by - 5); ctx.stroke();
    ctx.font = '600 11.5px Pretendard Variable, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#2b1f16';
    ctx.fillText('10 m', bx + 4, by - 6);

    updatePanel(a);
    return a;
  }

  // ── 애니메이션 (운행 · 진입 표시) ──
  let raf = 0;
  function loop(t) {
    raf = 0;
    const dt = state.last ? Math.min(0.1, (t - state.last) / 1000) : 0; state.last = t;
    if (state.driving) {
      excavator.x += state.dir * 1.6 * dt;   // 1.6 m/s
      if (excavator.x > 32) state.dir = -1;
      if (excavator.x < 14) state.dir = 1;
      excavator.heading = state.dir > 0 ? 0 : Math.PI;
    }
    const a = draw();
    if (state.driving || (a.lv === 'danger' && !reduceMotion)) raf = requestAnimationFrame(loop);
    else state.last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  // ── 입력 ──
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.max(0.5, Math.min(W_M - 0.5, (e.clientX - r.left) / S)), y: Math.max(0.5, Math.min(H_M - 0.5, (e.clientY - r.top) / S)) };
  };
  const moveTo = (p) => {
    state.worker = p;
    if (!state.moved) { state.moved = true; ui.hint.style.opacity = '0'; }
    draw(); kick();
  };
  canvas.addEventListener('pointerdown', e => { state.dragging = true; canvas.classList.add('grabbing'); canvas.setPointerCapture(e.pointerId); moveTo(toWorld(e)); });
  canvas.addEventListener('pointermove', e => { if (state.dragging) moveTo(toWorld(e)); });
  const end = () => { state.dragging = false; canvas.classList.remove('grabbing'); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', e => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k) return;
    e.preventDefault();
    const st = e.shiftKey ? 3 : 1;
    moveTo({ x: Math.max(0.5, Math.min(W_M - 0.5, state.worker.x + k[0] * st)), y: Math.max(0.5, Math.min(H_M - 0.5, state.worker.y + k[1] * st)) });
  });

  ui.sigma.addEventListener('input', () => { state.sigma = +ui.sigma.value; ui.sigmaOut.textContent = `${state.sigma} m`; draw(); });
  ui.drive.addEventListener('click', () => {
    state.driving = !state.driving;
    ui.drive.setAttribute('aria-pressed', String(state.driving));
    ui.drive.textContent = state.driving ? '⏸ 운행 멈춤' : '🚜 굴착기 운행';
    state.last = 0; kick(); draw();
  });
  ui.reset.addEventListener('click', () => {
    Object.assign(excavator, { x: 22, y: 20, heading: 0 });
    state.worker = { x: 4, y: 29 }; state.driving = false; state.dir = 1;
    ui.drive.setAttribute('aria-pressed', 'false'); ui.drive.textContent = '🚜 굴착기 운행';
    ui.sigma.value = 3; state.sigma = 3; ui.sigmaOut.textContent = '3 m';
    draw();
  });

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas.parentElement);
  else window.addEventListener('resize', resize);
  resize();
})();
