/* 김호성 홈페이지 공용 스크립트 — 내비 · 등장 효과 · 화면 갤러리 · 라이트박스 · 코드 복사 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ── 외부 링크 (config.js) — 값이 비어 있으면 숨김 ──
  const cfg = window.SITE_CONFIG || {};
  $$('[data-cfg]').forEach(a => {
    const v = String(cfg[a.dataset.cfg] || '').trim().replace(/\/+$/, '');
    if (!v) { a.hidden = true; return; }
    a.href = a.dataset.cfg === 'email' ? `mailto:${v}` : v + (a.dataset.path || '');
    if (a.dataset.cfg === 'email' && a.dataset.showValue !== undefined) a.textContent = v;
  });
  // 링크가 모두 숨겨진 묶음은 같이 숨김
  $$('[data-cfg-group]').forEach(g => { if (![...g.querySelectorAll('[data-cfg]')].some(a => !a.hidden)) g.hidden = true; });
  $$('[data-cfg-fallback]').forEach(f => { const g = document.getElementById(f.dataset.cfgFallback); f.hidden = !(g && g.hidden); });

  // ── 내비게이션 ──
  const nav = $('#nav'), toggle = $('#navToggle');
  if (nav && toggle) {
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  $$('#navLinks a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }));
  }

  // 현재 섹션 표시
  const links = new Map($$('#navLinks a').filter(a => a.getAttribute('href').startsWith('#')).map(a => [a.getAttribute('href').slice(1), a]));
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(a => a.classList.remove('on'));
        const a = links.get(e.target.id); if (a) a.classList.add('on');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

    // ── 등장 효과 ──
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    $$('.reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 3) * 60}ms`; io.observe(el); });
  } else {
    $$('.reveal').forEach(el => el.classList.add('in'));
  }

  // ── 화면 탭 ──
  const tabs = $$('[role=tab]');
  const selectTab = (tab) => {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus(); selectTab(next);
    });
  });

  // 관리자 화면 목록
  const shotImg = $('#shotImg'), shotUrl = $('#shotUrl');
  $$('#shotList button').forEach(b => {
    const pre = new Image(); pre.src = b.dataset.src;   // 미리 받아 두기
    b.addEventListener('click', () => {
      $$('#shotList button').forEach(x => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'true');
      shotImg.src = b.dataset.src;
      shotImg.alt = b.querySelector('span').textContent;
      shotUrl.textContent = `localhost:8000/map — ${b.dataset.url}`;
    });
  });

  // ── 라이트박스 ──
  const lb = $('#lightbox');
  if (lb) {
    const openLb = (img) => {
      if (!lb.showModal) { window.open(img.currentSrc || img.src, '_blank'); return; }
      $('#lbImg').src = img.currentSrc || img.src;
      $('#lbImg').alt = img.alt;
      $('#lbCap').textContent = img.alt;
      lb.showModal();
    };
    document.addEventListener('click', e => { const img = e.target.closest('img[data-zoom]'); if (img) openLb(img); });
    $('#lbClose').addEventListener('click', () => lb.close());
    lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });
  }

  // ── 코드 복사 ──
  $$('.copy').forEach(btn => btn.addEventListener('click', async () => {
    const pre = btn.previousElementSibling.cloneNode(true);
    pre.querySelectorAll('.c').forEach(c => c.remove());
    const text = pre.textContent.split('\n').map(l => l.trimEnd()).filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); btn.textContent = '복사됨'; }
    catch (err) { btn.textContent = '복사 실패'; }
    setTimeout(() => { btn.textContent = '복사'; }, 1400);
  }));
})();
