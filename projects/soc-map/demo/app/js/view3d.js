/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v14 — 3D 뷰어 (Three.js r128)
 *  좌표 규칙: 현장 (x, y)[m] → 3D ((x − cx)·K, 높이, (y − cy)·K),  K = 10 단위/m (모델 비율 유지용)
 *
 *  v14: 건물을 구조 형식(벽식·라멘조·철골조)과 공정 단계(터파기·기초·골조·외장·준공)대로 만든다 (structure.js)
 *   - 골조: 기둥 격자 · 보 · 층별 슬래브 · 코어 · 내력벽, 작업층 갱폼(벽식)·거푸집 데크, 올라갈 층은 윤곽선
 *   - 비계(쌍줄)·수직 보호망, 터파기 흙막이·띠장·버팀보, 기초 매트
 *   - 외벽 창호 질감(구조 형식별), 항공 사진이면 지붕에 사진을 입힘
 *   - 실제 태양 위치(현장 위경도 + 날짜·시각) 그림자, 건물을 눌러 선택
 *  v12 이후: 재생성 시 GPU 메모리 해제, 카메라 위치 유지, 전면 통제 표시, 3D 모드가 아닐 때 렌더 루프 정지
 *  v14.6: 지면에 위성 지도(2D 와 같은 타일)를 입힘, 배치도·위험 구역은 레이어 켜기/끄기를 따름,
 *         현장 인원(근로자·운전원)을 실시간으로 표시(peopleSource, 0.3초마다 갱신 · 부드럽게 이동),
 *         「구조 골조 보기」도 공정 단계를 따름(터파기·기초면 골조 없이 계획 윤곽만)
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

/** 건물 idx 의 구조·공정 사양 (인스펙터와 3D 가 함께 쓴다). 값이 없으면 외곽 형태로 추정 */
function buildingSpec(idx, poly) {
  const bd = S.buildingData[idx] || {};
  const p = poly || getContourPolys()[idx] || [];
  const sug = suggestStructure(p);
  const type = STRUCTURE_TYPES[bd.structure] ? bd.structure : sug.type;
  const T = STRUCTURE_TYPES[type];
  const floorH = bd.floorHeight > 0 ? +bd.floorHeight : T.floorH;
  const floors = bd.floors || Math.max(1, Math.round(S.settings.buildingHeight / floorH));
  const stage = CONSTRUCTION_STAGES[bd.stage] ? bd.stage : 'done';
  const order = CONSTRUCTION_STAGES[stage].order;
  const built = stage === 'frame' ? Math.max(0, Math.min(floors, bd.builtFloors ?? Math.ceil(floors / 2))) : order >= 3 ? floors : 0;
  const basements = Math.max(0, Math.min(8, Math.round(bd.basements || 0)));
  return { bd, type, T, auto: !STRUCTURE_TYPES[bd.structure], reason: sug.reason, floorH, floors, height: floors * floorH, stage, built, basements };
}

const View3D = (() => {
  let scene, camera, renderer, controls, content, sun, hemi, ray;
  let ready = false, running = false, lastSize = '', bgTexture = null, bgTextureSrc = null;
  let groundTex = null, groundCanvas = null, groundView = null, groundTimer = null, groundOn = false;
  let peopleGroup = null, peopleAt = 0, origin3d = null;
  const peopleMap = new Map();
  const PERSON_S = 2.5;   // 위치 핀 크기 (실제 사람의 약 2.5배 — 현장 전체에서도 점으로 보이고 건물·장비를 가리지 않게)
  let pickables = [], sunInfo = null;
  const K = 10, B1_Y = -4 * K;   // 지하 1층 4m (보행 구역 아래 주차장 표현)

  const available = () => typeof THREE !== 'undefined' && THREE.OrbitControls;

  function init(container) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.Fog(0x0b1120, 1500, 6000);
    camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.95; // 지하층 관찰을 위해 지면 아래까지 허용

    hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.55);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    content = new THREE.Group();
    scene.add(content);
    ray = new THREE.Raycaster();
    _m = new THREE.Matrix4(); _q = new THREE.Quaternion(); _s = new THREE.Vector3(); _p = new THREE.Vector3(); _up = new THREE.Vector3(0, 1, 0);

    // 건물 누르기 → 선택 (끌어서 회전한 경우는 제외)
    let down = null;
    renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!down || down.b !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      if (api.onPick) api.onPick(hit ? hit.object.userData.bi : null);
    });
    ready = true;
  }

  function dispose(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) { if (m.map && m.map !== bgTexture && m.map !== groundTex) m.map.dispose(); m.dispose(); }
    });
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    if (now - peopleAt > 300) { peopleAt = now; syncPeople(); }
    animatePeople(now);
    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    if (!ready) return;
    const el = renderer.domElement.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ── 헬퍼 ──
  function makeShape(flat, ox, oy) {
    const sh = new THREE.Shape();
    sh.moveTo((flat[0] - ox) * K, -(flat[1] - oy) * K);
    for (let i = 2; i < flat.length; i += 2) sh.lineTo((flat[i] - ox) * K, -(flat[i + 1] - oy) * K);
    sh.closePath();
    return sh;
  }
  function makePath(flat, ox, oy) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2((flat[i] - ox) * K, -(flat[i + 1] - oy) * K));
    return new THREE.Path(pts);
  }
  function flatMesh(flat, ox, oy, mat, y) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(makeShape(flat, ox, oy)), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = y;
    return m;
  }
  // ── 지면 위성 지도: 2D 와 같은 타일을 캔버스에 그려 텍스처로 (타일이 도착할 때마다 다시 그림) ──
  function prepareGround(view) {
    const long = Math.max(view.maxX - view.minX, view.maxY - view.minY);
    const size = long > 500 ? Math.min(4096, renderer.capabilities.maxTextureSize) : 2048;
    const cw = Math.round(size * (view.maxX - view.minX) / long), ch = Math.round(size * (view.maxY - view.minY) / long);
    if (!groundCanvas || groundCanvas.width !== cw || groundCanvas.height !== ch) {
      groundCanvas = document.createElement('canvas'); groundCanvas.width = cw; groundCanvas.height = ch;
      if (groundTex) groundTex.dispose();
      groundTex = new THREE.CanvasTexture(groundCanvas);
      groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    groundView = view;
    drawGround();
  }
  function drawGround() {
    if (!groundCanvas || !groundView || !groundOn) return;
    const g = groundCanvas.getContext('2d'), v = groundView, s = groundCanvas.width / (v.maxX - v.minX);
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#1e293b'; g.fillRect(0, 0, groundCanvas.width, groundCanvas.height);
    g.setTransform(s, 0, 0, s, -v.minX * s, -v.minY * s);
    const dpr = typeof DPR !== 'undefined' ? DPR : 1;
    Basemap.draw(g, s / dpr, v);   // s/DPR → 캔버스 해상도에 맞는 줌 단계
    if (S.layers.cadastral) Basemap.drawCadastral(g, s / dpr, v);
    if (groundTex) groundTex.needsUpdate = true;
  }
  /** 지면 ShapeGeometry 의 UV 를 현장 좌표 범위(위성 지도 캔버스)에 맞춘다 */
  function rectUV(geo, ox, oy, v) {
    const pos = geo.attributes.position, uv = geo.attributes.uv, w = v.maxX - v.minX, h = v.maxY - v.minY;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / K + ox, y = -pos.getY(i) / K + oy;
      uv.setXY(i, (x - v.minX) / w, 1 - (y - v.minY) / h);
    }
    uv.needsUpdate = true;
  }

  // ── 현장 인원: 위치 핀(원통 머리 + 뒤집힌 원뿔 몸, 끝이 서 있는 곳). 근로자는 위험 단계 색 · 운전원은 주황,
  //    위험 진입이면 바닥 고리가 퍼진다. 이름은 머리 위 작은 글자 판 ──
  function personModel(color) {
    const g = new THREE.Group(), s = PERSON_S * K;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.35 });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.5 * s, 1.5 * s, 20), mat);
    body.rotation.x = Math.PI; body.position.y = 0.75 * s; body.castShadow = true;            // 뒤집힌 원뿔: 끝이 바닥(위치)
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.36 * s, 0.36 * s, 0.42 * s, 20), mat);
    head.position.y = 1.5 * s + 0.12 * s + 0.21 * s; head.castShadow = true;                   // 몸 위에 조금 띄워 머리로 읽히게
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55 * s, 0.75 * s, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1.5;
    g.add(body, head, ring);
    g.userData = { mat, ring, top: 1.5 * s + 0.12 * s + 0.42 * s };
    return g;
  }
  /** 이름 글자 판 (둥근 사각형, 왼쪽 색 점) — 글 길이에 맞춰 폭이 정해진다 */
  function nameTag(text, color, h = 30) {
    const fs = 44, padX = 22, dot = 16;
    const c = document.createElement('canvas'), g0 = c.getContext('2d');
    g0.font = `bold ${fs}px "Malgun Gothic",sans-serif`;
    const tw = Math.ceil(g0.measureText(text).width);
    c.width = padX * 2 + dot * 2 + 12 + tw; c.height = 72;
    const g = c.getContext('2d'), r = 20;
    g.fillStyle = 'rgba(11,17,32,0.88)';
    g.beginPath(); g.moveTo(r, 0); g.arcTo(c.width, 0, c.width, c.height, r); g.arcTo(c.width, c.height, 0, c.height, r); g.arcTo(0, c.height, 0, 0, r); g.arcTo(0, 0, c.width, 0, r); g.closePath(); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(padX + dot, c.height / 2, dot, 0, Math.PI * 2); g.fill();
    g.font = `bold ${fs}px "Malgun Gothic",sans-serif`; g.fillStyle = '#fff'; g.textBaseline = 'middle';
    g.fillText(text, padX + dot * 2 + 12, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(h * c.width / c.height, h, 1); sp.renderOrder = 11;
    return sp;
  }
  function lookPerson(p, c) {
    const col = new THREE.Color(c.color);
    p.obj.userData.mat.color.copy(col); p.obj.userData.mat.emissive.copy(col); p.obj.userData.ring.material.color.copy(col);
    if (p.label) { p.obj.remove(p.label); dispose(p.label); }
    p.label = nameTag(`${c.name}${c.online === false ? ' (끊김)' : ''}`, c.color);
    p.label.position.y = p.obj.userData.top + 16;
    p.obj.add(p.label);
  }
  function syncPeople() {
    if (!ready) return;
    if (!peopleGroup) { peopleGroup = new THREE.Group(); scene.add(peopleGroup); }
    peopleGroup.visible = S.layers.people !== false;
    const list = (api.peopleSource && api.peopleSource()) || [], seen = new Set();
    for (const c of list) {
      if (c.x == null || c.y == null) continue;
      seen.add(c.id);
      let p = peopleMap.get(c.id);
      if (!p) { p = { obj: personModel(c.color), key: '', x: c.x, y: c.y }; peopleGroup.add(p.obj); peopleMap.set(c.id, p); }
      const key = [c.name, c.color, c.online, c.role].join('|');
      if (p.key !== key) { p.key = key; lookPerson(p, c); }
      p.tx = c.x; p.ty = c.y; p.danger = c.level === 'danger' && c.online !== false;
    }
    for (const [id, p] of peopleMap) if (!seen.has(id)) { peopleGroup.remove(p.obj); dispose(p.obj); peopleMap.delete(id); }
  }
  function animatePeople(now) {
    if (!origin3d || !peopleMap.size) return;
    const k = (now / 800) % 1;
    for (const p of peopleMap.values()) {
      if (p.tx != null) { p.x += (p.tx - p.x) * 0.15; p.y += (p.ty - p.y) * 0.15; }   // 1초 간격 위치를 부드럽게 잇는다
      p.obj.position.set((p.x - origin3d.ox) * K, 0, (p.y - origin3d.oy) * K);
      const r = p.obj.userData.ring, sc = p.danger ? 1 + 0.8 * k : 1;
      r.scale.set(sc, sc, 1); r.material.opacity = p.danger ? 0.95 * (1 - k) + 0.1 : 0.85;
    }
  }

  /** ShapeGeometry 의 UV 를 배치도 이미지 좌표로 다시 매긴다 (항공 사진을 지면·지붕에 입힘) */
  function planUV(geo, ox, oy, PT) {
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const px = PT.inverse({ x: pos.getX(i) / K + ox, y: -pos.getY(i) / K + oy });
      uv.setXY(i, px.x / S.plan.width, 1 - px.y / S.plan.height);
    }
    uv.needsUpdate = true;
  }
  function tube(points3, radius, mat, flatten) {
    if (points3.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points3, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, Math.min(800, Math.max(16, points3.length * 3)), radius, 8, false);
    const m = new THREE.Mesh(geo, mat);
    if (flatten) m.scale.y = flatten;
    return m;
  }
  /** 떠 있는 표지. icon = 이모지 글자 또는 { sign: 'noEntry' | 'voltage' | … } (hazardviz.js 안전표지 그림) */
  /** 표지(아이콘 원) + 그 아래 글자 판을 한 장으로 — 글자를 원 안에 넣으면 너무 작아 읽히지 않아 밖으로 뺐다.
   *  size = 아이콘 원의 크기(월드 단위). 글자 판 높이는 아이콘과 상관없이 TAG_H(인원 이름표와 같은 크기) */
  const TAG_H = 30;
  function sprite(emojiText, text, color, size = 46) {
    size *= 1.2;
    const R = 128, tagH = Math.round(TAG_H * 2 * R / size), fs = Math.round(tagH * 0.62), gap = Math.round(tagH * 0.12);
    const g0 = document.createElement('canvas').getContext('2d');
    g0.font = `bold ${fs}px "Malgun Gothic",sans-serif`;
    const tw = text ? Math.ceil(g0.measureText(text).width) : 0;
    const W = Math.max(2 * R, tw + fs + 8), H = 2 * R + (text ? gap + tagH : 0);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), cx = W / 2;
    g.fillStyle = 'rgba(11,17,32,0.92)'; g.beginPath(); g.arc(cx, R, R - 12, 0, Math.PI * 2); g.fill();
    g.lineWidth = 12; g.strokeStyle = color; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (emojiText && typeof emojiText === 'object' && typeof hzSign === 'function') hzSign(g, emojiText.sign, cx, R, 150);
    else { g.font = '120px "Segoe UI Emoji",sans-serif'; g.fillText(emojiText, cx, R + 6); }
    if (text) {
      const y0 = 2 * R + gap, w = tw + fs, x0 = cx - w / 2, r = tagH * 0.3;
      g.fillStyle = 'rgba(11,17,32,0.9)';
      g.beginPath(); g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + tagH, r); g.arcTo(x0 + w, y0 + tagH, x0, y0 + tagH, r); g.arcTo(x0, y0 + tagH, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath(); g.fill();
      g.lineWidth = Math.max(3, tagH * 0.05); g.strokeStyle = color; g.stroke();
      g.font = `bold ${fs}px "Malgun Gothic",sans-serif`; g.fillStyle = '#fff'; g.fillText(text, cx, y0 + tagH / 2 + 2);
    }
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    const k = size / (2 * R);
    sp.scale.set(W * k, H * k, 1); sp.center.set(0.5, 1 - R / H);   // 기준점 = 아이콘 원의 가운데 (예전과 같은 자리)
    sp.renderOrder = 10;
    return sp;
  }

  /** 같은 모양 부재를 InstancedMesh 하나로 모은다 (기둥·보·비계 수천 개도 그리기 호출 1번) */
  class Inst {
    constructor(geo, mat) { this.geo = geo; this.mat = mat; this.list = []; }
    add(m) { this.list.push(m.clone()); }
    mesh(bi, shadow = true) {
      if (!this.list.length) { this.geo.dispose(); return null; }
      const im = new THREE.InstancedMesh(this.geo, this.mat, this.list.length);
      this.list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadow; im.receiveShadow = true; im.userData.bi = bi;
      return im;
    }
  }
  let _m, _q, _s, _p, _up;   // 부재 배치용 임시 객체 (three.js 는 defer 로 늦게 로드되므로 init 에서 만든다)

  function equipmentModel(type, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.85 });
    const box = (w, h, d, m, x, y, z, rz = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.z = rz; g.add(b); return b; };
    const cyl = (rt, rb, h, m, x, y, z, rx = 0, rz = 0, seg = 12) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); c.position.set(x, y, z); c.rotation.set(rx, 0, rz); g.add(c); return c; };
    if (type === 'excavator') {
      box(16, 12, 16, mat, 0, 8, 0); box(8, 10, 8, dark, 4, 18, 4);
      box(24, 6, 5, dark, 0, 3, 8); box(24, 6, 5, dark, 0, 3, -8);
      box(16, 4, 4, mat, 12, 12, 0, -Math.PI / 6); box(12, 3, 3, mat, 22, 8, 0, Math.PI / 3);
      cyl(4, 2, 6, dark, 25, 3, 0, 0, Math.PI / 2, 8);
    } else if (type === 'mobileCrane') {
      box(30, 8, 14, mat, 0, 6, 0); box(8, 8, 8, dark, 10, 14, 0);
      for (const i of [-10, 10]) for (const j of [-8, 8]) cyl(5, 5, 3, dark, i, 5, j, Math.PI / 2, 0, 16);
      cyl(3, 2, 45, mat, 18, 26, 0, 0, -Math.PI / 3.5, 8);
    } else if (type === 'concretePumpCar') {
      box(10, 14, 14, mat, 12, 10, 0); box(24, 12, 16, mat, -6, 12, 0);
      for (const i of [-10, 10]) for (const j of [-8, 8]) cyl(5, 5, 4, dark, i, 5, j, Math.PI / 2, 0, 16);
      cyl(1.5, 1.5, 35, dark, 4, 30, 0, 0, -Math.PI / 4, 8);
    } else if (type === 'towerCrane') {
      box(6, 60, 6, mat, 0, 30, 0); box(50, 4, 4, mat, 25, 60, 0); box(15, 4, 4, dark, -7.5, 60, 0); box(6, 6, 6, dark, -14, 56, 0);
    } else if (type === 'pileDriver') {
      box(20, 15, 15, mat, -5, 7.5, 0); box(4, 50, 4, dark, 10, 25, 0); box(6, 10, 6, mat, 10, 40, 0);
      box(25, 6, 4, dark, 0, 3, 8); box(25, 6, 4, dark, 0, 3, -8);
    } else {
      box(20, 20, 20, mat, 0, 10, 0);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  // ── 외벽 창호 질감 (한 장 = 창 한 칸 × 한 층) ──
  function facadeCanvas(type) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    if (type === 'wall') {          // 공동주택: 밝은 외벽 + 발코니 창 + 난간 + 슬래브 띠
      g.fillStyle = '#e8e3d9'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#c9c2b4'; g.fillRect(0, 116, 128, 12);
      g.fillStyle = '#4f6478'; g.fillRect(12, 18, 104, 78);
      g.fillStyle = '#9db2c5'; g.fillRect(15, 21, 48, 72); g.fillRect(65, 21, 48, 72);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(15, 21, 48, 10);
      g.fillStyle = '#d6d0c4'; g.fillRect(8, 92, 112, 8);
    } else if (type === 'steel') {  // 커튼월
      const grd = g.createLinearGradient(0, 0, 128, 128); grd.addColorStop(0, '#8fb0c9'); grd.addColorStop(1, '#4f6f8a');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#334155'; g.fillRect(0, 0, 4, 128); g.fillRect(62, 0, 4, 128); g.fillRect(0, 112, 128, 16);
    } else {                        // 라멘조: 회색 외벽 + 띠창
      g.fillStyle = '#b9bdc3'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#3f5468'; g.fillRect(0, 34, 128, 60);
      g.fillStyle = '#86a0b6'; for (let x = 3; x < 128; x += 32) g.fillRect(x, 37, 28, 54);
      g.fillStyle = '#a3a8af'; g.fillRect(0, 114, 128, 14);
    }
    return c;
  }
  function facadeMaterial(cache, type, floorH) {
    const key = `${type}:${floorH.toFixed(2)}`;
    if (cache[key]) return cache[key];
    const t = new THREE.CanvasTexture(facadeCanvas(type));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const bay = type === 'wall' ? 4.5 : type === 'steel' ? 3 : 4;   // 창 한 칸 폭(m) — 표현용
    // ExtrudeGeometry 옆면 UV: u = 평면 좌표, v = 1 − 높이 → 층 경계가 지면에서 맞도록 반전
    t.repeat.set(1 / (bay * K), -1 / (floorH * K)); t.offset.set(0, 1 / (floorH * K));
    return (cache[key] = new THREE.MeshStandardMaterial({ map: t, roughness: type === 'steel' ? 0.3 : 0.8, metalness: type === 'steel' ? 0.4 : 0.05 }));
  }

  /** 태양 위치 → 조명. 현장 위치가 없으면 남남서 50° */
  function applySun(ext) {
    const o = S.project.origin, v = S.view3d;
    let el = 50, az = 200;
    if (o && v) {
      const [y, m, d] = v.date.split('-').map(Number), h = Math.floor(v.hour), mi = Math.round((v.hour - h) * 60);
      const p = sunPosition(new Date(y, m - 1, d, h, mi), o.lat, o.lon);
      el = p.elevation; az = p.azimuth;
    }
    const e = Math.max(el, 3) * Math.PI / 180, a = az * Math.PI / 180, dist = ext * 1.4;
    sun.position.set(Math.sin(a) * Math.cos(e) * dist, Math.sin(e) * dist, -Math.cos(a) * Math.cos(e) * dist);   // x = 동, z = 남
    sun.target.position.set(0, 0, 0);
    const day = el > 0;
    sun.intensity = day ? 0.3 + 0.65 * Math.min(1, Math.sin(e) * 1.6) : 0.04;
    hemi.intensity = day ? 0.55 : 0.42;   // 해가 진 뒤에도 현장·인원은 알아볼 수 있게 (그림자만 없앰)
    sunInfo = { elevation: el, azimuth: az, located: !!o };
  }

  // ═══════════════════════════════════════════════
  function build() {
    if (!ready) return;
    content.children.slice().forEach(c => { dispose(c); content.remove(c); });
    pickables = [];

    const E = docExtent();
    const ox = E.minX + E.w / 2, oy = E.minY + E.h / 2, ext = Math.max(E.w, E.h) * K;
    const W = (x, y, h = 0) => new THREE.Vector3((x - ox) * K, h, (y - oy) * K);
    const add = (o, bi) => { if (o) { if (bi != null) { o.userData.bi = bi; pickables.push(o); } content.add(o); } return o; };
    origin3d = { ox, oy };

    // 카메라/조명은 도면 크기가 바뀔 때만 재설정 (슬라이더 조작 시 시점 유지)
    const sizeKey = [E.minX, E.minY, E.w, E.h].map(v => v.toFixed(0)).join(',');
    if (sizeKey !== lastSize) {
      lastSize = sizeKey;
      camera.position.set(0, ext * 0.75, ext * 0.85);
      controls.target.set(0, 0, 0);
      // 안개·카메라 먼 거리를 현장 크기에 맞춘다 (고정값이면 실제 건물을 넓게 불러온 큰 현장이 안개에 묻혀 안 보였음)
      scene.fog.near = Math.max(1500, ext * 1.6); scene.fog.far = Math.max(6000, ext * 5);
      camera.far = Math.max(20000, ext * 8); camera.updateProjectionMatrix();
      controls.maxDistance = ext * 4;
      const sc = sun.shadow.camera;
      sc.left = -ext * 0.7; sc.right = ext * 0.7; sc.top = ext * 0.7; sc.bottom = -ext * 0.7; sc.far = ext * 4;
      sc.updateProjectionMatrix();
    }
    applySun(ext);

    const polys = getContourPolys();
    const specs = polys.map((p, i) => (p.length >= 6 ? buildingSpec(i, p) : null));
    // 터파기·기초 단계 건물은 지면에 구멍을 낸다
    const pits = specs.map((sp, i) => (sp && (sp.stage === 'excavation' || sp.stage === 'foundation') ? offsetPolygon(polys[i], 2) : null));
    const holes = pits.filter(Boolean);
    const withHoles = (shape) => { holes.forEach(h => shape.holes.push(makePath(h, ox, oy))); return shape; };

    // 바닥: 현장 범위 지면(위성 지도) + 정합 변환대로 놓인 배치도
    const gw = Math.max(E.w * 0.8, 100), gh = Math.max(E.h * 0.8, 100);
    const groundFlat = [ox - gw, oy - gh, ox + gw, oy - gh, ox + gw, oy + gh, ox - gw, oy + gh];
    let groundGeo;
    try { groundGeo = new THREE.ShapeGeometry(withHoles(makeShape(groundFlat, ox, oy))); } catch (e) { groundGeo = new THREE.ShapeGeometry(makeShape(groundFlat, ox, oy)); }
    groundOn = !!(typeof Basemap !== 'undefined' && getFrame() && S.layers.basemap !== 'none');
    let groundMat;
    if (groundOn) {
      const gv = { minX: ox - gw, minY: oy - gh, maxX: ox + gw, maxY: oy + gh };
      prepareGround(gv); rectUV(groundGeo, ox, oy, gv);
      groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 });
    } else groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; ground.receiveShadow = true;
    add(ground);
    const PT = planTransform();
    const aerial = !!(S.bgImage && PT && S.plan.width && S.plan.imageType === 'construction');
    if (S.bgImage && PT && S.plan.width && S.layers.bg !== false) {
      if (bgTextureSrc !== S.bgImageSrc) {
        if (bgTexture) bgTexture.dispose();
        bgTexture = new THREE.Texture(S.bgImage); bgTexture.needsUpdate = true; bgTextureSrc = S.bgImageSrc;
        bgTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
      const corners = [[0, 0], [S.plan.width, 0], [S.plan.width, S.plan.height], [0, S.plan.height]].flatMap(([x, y]) => { const q = PT.apply({ x, y }); return [q.x, q.y]; });
      let geo;
      try { geo = new THREE.ShapeGeometry(withHoles(makeShape(corners, ox, oy))); } catch (e) { geo = new THREE.ShapeGeometry(makeShape(corners, ox, oy)); }
      planUV(geo, ox, oy, PT);
      const op = S.plan.opacity ?? 0.85;   // 2D 와 같은 도면 불투명도 — 낮추면 아래 위성 지도가 비친다
      const plane = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bgTexture, roughness: 0.9, transparent: op < 0.99, opacity: op, depthWrite: op >= 0.99 }));
      plane.rotation.x = -Math.PI / 2; plane.receiveShadow = true;
      add(plane);
    }

    // ── 건물 (구조 형식 · 공정 단계) ──
    const M = {
      concrete: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.85 }),
      slab: new THREE.MeshStandardMaterial({ color: 0xd6d9de, roughness: 0.85 }),
      core: new THREE.MeshStandardMaterial({ color: 0xa8adb5, roughness: 0.85 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x51627a, roughness: 0.45, metalness: 0.6 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x8f969f, roughness: 0.9 }),
      blocked: new THREE.MeshStandardMaterial({ color: 0xef4444, transparent: true, opacity: 0.75, roughness: 0.35 }),
      gang: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6, metalness: 0.2 }),
      deck: new THREE.MeshStandardMaterial({ color: 0xc2853b, roughness: 0.9 }),
      pipe: new THREE.MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.4, metalness: 0.7 }),
      net: new THREE.MeshStandardMaterial({ color: 0x15803d, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }),
      shoring: new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.9 }),
      wale: new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.6, metalness: 0.4 }),
      earth: new THREE.MeshStandardMaterial({ color: 0x6b4f32, roughness: 1 }),
      xwall: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.85 }),
      ghost: new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.35 }),
      edge: new THREE.LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.35 }),
      aerialRoof: aerial ? new THREE.MeshStandardMaterial({ map: bgTexture, roughness: 0.9 }) : null,
    };
    const facadeCache = {};
    const segMatrix = (x1, y1, x2, y2, y0, h, t) => {
      _p.copy(W((x1 + x2) / 2, (y1 + y2) / 2, (y0 + h / 2) * K));
      _q.setFromAxisAngle(_up, -Math.atan2(y2 - y1, x2 - x1));
      _s.set(Math.max(Math.hypot(x2 - x1, y2 - y1), 0.01) * K, h * K, t * K);
      return _m.compose(_p, _q, _s);
    };
    const postMatrix = (x, y, y0, h, w, ang = 0) => {
      _p.copy(W(x, y, (y0 + h / 2) * K)); _q.setFromAxisAngle(_up, -ang); _s.set(w * K, h * K, w * K);
      return _m.compose(_p, _q, _s);
    };
    const edges = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) { const j = (i + 2) % flat.length; out.push([flat[i], flat[i + 1], flat[j], flat[j + 1]]); } return out; };
    const extrudeAt = (flat, depth, y0, mat) => {
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(makeShape(flat, ox, oy), { depth: depth * K, bevelEnabled: false }), mat);
      m.rotation.x = -Math.PI / 2; m.position.y = y0 * K; m.castShadow = m.receiveShadow = true;
      return m;
    };
    const curtain = (flat, y0, y1, mat) => {   // 외곽을 따라 세운 막 (보호망)
      const pos = [], a0 = y0 * K, a1 = y1 * K;
      for (const [x1, y1_, x2, y2] of edges(flat)) {
        const a = W(x1, y1_), b = W(x2, y2);
        pos.push(a.x, a0, a.z, b.x, a0, b.z, b.x, a1, b.z, a.x, a0, a.z, b.x, a1, b.z, a.x, a1, a.z);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    };

    /** 골조: 슬래브 · 기둥 · 보 · 내력벽 · 코어 (nF 층까지) */
    function skeleton(i, p, sp, nF, xray) {
      const lay = structuralLayout(p, sp.type), fh = sp.floorH, H = nF * fh;
      add(extrudeAt(p, 0.4, -0.4, M.slab), i);   // 기초 매트 · 1층 바닥
      if (nF > 0) {
        const slabGeo = new THREE.ExtrudeGeometry(makeShape(p, ox, oy), { depth: 0.25 * K, bevelEnabled: false }); slabGeo.rotateX(-Math.PI / 2);
        const slabs = new Inst(slabGeo, M.slab);
        for (let k = 1; k <= nF; k++) slabs.add(_m.makeTranslation(0, (k * fh - 0.25) * K, 0));
        add(slabs.mesh(i), i);
      }
      const colMat = sp.type === 'steel' ? M.steel : M.concrete;
      if (sp.type !== 'wall' && nF > 0) {
        const cols = new Inst(new THREE.BoxGeometry(1, 1, 1), colMat);
        for (const c of lay.columns) cols.add(postMatrix(c.x, c.y, 0, H, sp.T.member, lay.angle));
        add(cols.mesh(i), i);
        const bd = sp.type === 'steel' ? 0.6 : 0.7, bw = sp.type === 'steel' ? 0.3 : 0.4;
        const beams = new Inst(new THREE.BoxGeometry(1, 1, 1), colMat);
        for (let k = 1; k <= nF; k++) for (const b of lay.beams) beams.add(segMatrix(b[0], b[1], b[2], b[3], k * fh - 0.25 - bd, bd, bw));
        add(beams.mesh(i), i);
      }
      if (sp.type === 'wall' && nF > 0) {
        const walls = new Inst(new THREE.BoxGeometry(1, 1, 1), M.concrete);
        for (const w of lay.walls) walls.add(segMatrix(w[0], w[1], w[2], w[3], 0, H, 0.2));
        add(walls.mesh(i), i);
        const outer = new Inst(new THREE.BoxGeometry(1, 1, 1), xray ? M.xwall : M.concrete);
        for (const e of edges(p)) outer.add(segMatrix(e[0], e[1], e[2], e[3], 0, H, 0.2));
        add(outer.mesh(i, !xray), i);
      }
      if (lay.core.length) add(extrudeAt(lay.core, xray ? sp.height + 3 : Math.min(sp.height + 3, (nF + 1) * fh), 0, M.core), i);   // 코어가 한 층 먼저 올라간다
      return lay;
    }
    /** 작업층: 벽식은 외곽 갱폼, 그 밖에는 다음 층 거푸집 데크 */
    function formwork(i, p, sp) {
      const lv = sp.built * sp.floorH;
      if (sp.type === 'wall') {
        const gang = new Inst(new THREE.BoxGeometry(1, 1, 1), M.gang);
        for (const e of edges(offsetPolygon(p, 0.35))) gang.add(segMatrix(e[0], e[1], e[2], e[3], Math.max(0, lv - sp.floorH * 0.5), sp.floorH * 1.6, 0.12));
        add(gang.mesh(i), i);
      } else add(extrudeAt(p, 0.06, lv + sp.floorH - 0.25, M.deck), i);
    }
    /** 아직 올라가지 않은 층: 윤곽선 */
    function ghost(p, sp) {
      const from = sp.built * sp.floorH, h = sp.height - from;
      if (h <= 0) return;
      const geo = new THREE.ExtrudeGeometry(makeShape(p, ox, oy), { depth: h * K, bevelEnabled: false });
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), M.ghost);
      geo.dispose();
      lines.rotation.x = -Math.PI / 2; lines.position.y = from * K;
      add(lines);
    }
    /** 쌍줄 비계 + 수직 보호망 (기둥 1.8 m · 띠장 1.9 m 간격 — 표현용) */
    function scaffold(i, p, top) {
      const rows = [offsetPolygon(p, 0.45), offsetPolygon(p, 1.35)];
      const posts = new Inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), M.pipe), ledgers = new Inst(new THREE.BoxGeometry(1, 1, 1), M.pipe);
      for (const row of rows) for (const [x1, y1, x2, y2] of edges(row)) {
        const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.round(L / 1.8));
        for (let k = 0; k < n; k++) posts.add(postMatrix(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n, 0, top, 0.09));
        for (let h = 1.9; h < top; h += 1.9) ledgers.add(segMatrix(x1, y1, x2, y2, h, 0.07, 0.07));
      }
      add(posts.mesh(i, false)); add(ledgers.mesh(i, false));
      add(curtain(rows[1], 0, top, M.net));
    }
    /** 터파기(흙막이 · 띠장 · 버팀보) · 기초 매트 */
    function pit(i, p, sp, outline, withMat) {
      const D = Math.max(1, sp.basements) * BASEMENT_H;
      add(flatMesh(outline, ox, oy, M.earth, -D * K), i);
      const walls = new Inst(new THREE.BoxGeometry(1, 1, 1), M.shoring), wales = new Inst(new THREE.BoxGeometry(1, 1, 1), M.wale);
      const levels = [-1.5]; if (D > 5) levels.push(-D / 2); if (D > 9) levels.push(-D * 0.8);
      for (const [x1, y1, x2, y2] of edges(outline)) {
        walls.add(segMatrix(x1, y1, x2, y2, -D, D + 0.8, 0.5));
        for (const lv of levels) wales.add(segMatrix(x1, y1, x2, y2, lv - 0.2, 0.4, 0.45));
      }
      for (const lv of levels) for (const b of crossBraces(outline, 5)) wales.add(segMatrix(b[0], b[1], b[2], b[3], lv - 0.2, 0.4, 0.4));
      add(walls.mesh(i), i); add(wales.mesh(i), i);
      if (withMat) {
        add(extrudeAt(p, 1.0, -D, M.concrete), i);
        const form = new Inst(new THREE.BoxGeometry(1, 1, 1), M.deck);
        for (const e of edges(offsetPolygon(p, 0.1))) form.add(segMatrix(e[0], e[1], e[2], e[3], -D, 1.3, 0.08));
        add(form.mesh(i), i);
      }
    }
    /** 완성된 건물: 구조 형식별 외벽 질감, 항공 사진이면 지붕에 사진 */
    function body(i, p, sp, blocked) {
      const geo = new THREE.ExtrudeGeometry(makeShape(p, ox, oy), { depth: sp.height * K, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, blocked ? M.blocked : [M.roof, facadeMaterial(facadeCache, sp.type, sp.floorH)]);
      mesh.rotation.x = -Math.PI / 2; mesh.castShadow = mesh.receiveShadow = true;
      add(mesh, i);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), M.edge); e.rotation.x = -Math.PI / 2; add(e);
      if (M.aerialRoof && !blocked) {
        const rg = new THREE.ShapeGeometry(makeShape(p, ox, oy)); planUV(rg, ox, oy, PT);
        const roof = new THREE.Mesh(rg, M.aerialRoof); roof.rotation.x = -Math.PI / 2; roof.position.y = sp.height * K + 0.05; roof.receiveShadow = true;
        add(roof, i);
      }
    }

    polys.forEach((p, i) => {
      const sp = specs[i];
      if (!sp) return;
      const xray = S.view3d.xray, blocked = !!sp.bd.entranceBlocked;
      // 「구조 골조 보기」도 공정 단계를 따른다 — 터파기·기초면 아직 올라간 골조가 없으므로 흙막이 + 계획 윤곽(미시공)만
      if (sp.stage === 'excavation' || sp.stage === 'foundation') {
        pit(i, p, sp, pits[i], sp.stage === 'foundation');
        if (xray) ghost(p, sp);
      } else if (sp.stage === 'frame') {
        skeleton(i, p, sp, sp.built, xray);
        if (sp.built < sp.floors) { if (!xray) formwork(i, p, sp); ghost(p, sp); }
        if (S.view3d.scaffold && !xray) scaffold(i, p, Math.min(sp.height, (sp.built + 1) * sp.floorH) + 1.2);
      } else if (xray) skeleton(i, p, sp, sp.floors, true);
      else {
        body(i, p, sp, blocked);
        if (sp.stage === 'finish' && S.view3d.scaffold) scaffold(i, p, sp.height + 1.2);
      }
      const label = sp.stage === 'frame' ? `골조 ${sp.built}/${sp.floors}F` : sp.stage !== 'done' ? CONSTRUCTION_STAGES[sp.stage].label : '';
      if (sp.bd.name || blocked || label) {
        const c = polygonCentroid(p), top = sp.stage === 'excavation' || sp.stage === 'foundation' ? 2 : (sp.stage === 'frame' ? Math.min(sp.height, (sp.built + 1) * sp.floorH) : sp.height);
        const text = [sp.bd.name || `건물 ${i + 1}`, label].filter(Boolean).join(' · ');
        const sp_ = sprite(blocked ? '🚫' : sp.stage === 'done' ? '🏢' : '🏗️', text, blocked ? '#ef4444' : sp.stage === 'done' ? '#60a5fa' : '#f59e0b', 40);
        sp_.position.copy(W(c.x, c.y, top * K + 28)); add(sp_);
      }
    });

    if (S.settings.showUnderground) buildUnderground(polys, ox, oy, W, add);

    // 보행 구역 / 환경 구역
    if (S.walkableAreaPolygon.length >= 6) {
      add(flatMesh(S.walkableAreaPolygon, ox, oy, new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }), 0.3));
    }
    // v14.8 무늬 텍스처 (hazardviz.js 무늬 칸을 m 단위로 반복 — 2D 지도와 같은 무늬)
    const hzTex = (kind, metersPerTile) => {
      const tile = typeof hzTile === 'function' ? hzTile(kind) : null;
      if (!tile) return null;
      const t = new THREE.CanvasTexture(tile); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / (metersPerTile * K), 1 / (metersPerTile * K));
      return t;
    };
    S.siteEnvironment.envZones.forEach((z, i) => {
      if (z.polygon.length < 6) return;
      const info = ENV_ZONE_TYPES[z.type] || { color: '#ffffff', icon: '⚠️', label: '' }, st = (typeof HZ_ZONE_STYLE !== 'undefined' && HZ_ZONE_STYLE[z.type]) || {};
      add(flatMesh(z.polygon, ox, oy, new THREE.MeshBasicMaterial({ color: new THREE.Color(info.color), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }), 0.5 + i * 0.05));
      const tex = st.pattern && hzTex(st.pattern, 2.5);
      if (tex) add(flatMesh(z.polygon, ox, oy, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 0.52 + i * 0.05));
      const c = polygonCentroid(z.polygon), sp = sprite(st.sign ? { sign: st.sign } : info.icon, info.label.split(' ')[0], info.color, 64);
      sp.position.copy(W(c.x, c.y, 34)); add(sp);
    });

    // 도로 / 울타리
    const roadMat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.7 });
    S.polylines.forEach(l => {
      const pts = []; for (let i = 0; i < l.points.length; i += 2) pts.push(W(l.points[i], l.points[i + 1], 1));
      add(tube(pts, (l.width || 3) / 2 * K, roadMat, 0.15));
    });
    // v14.8 울타리: 실제 가설 울타리처럼 빨강·흰 사선 줄무늬 판(높이 1.2 m) + 기둥 2.5 m 간격 + 출입 금지 표지.
    // 닫힌 울타리는 안쪽 바닥을 빨간 빗금(통행 금지 구역)으로
    const stripeCanvas = document.createElement('canvas'); stripeCanvas.width = 128; stripeCanvas.height = 64;
    { const sg = stripeCanvas.getContext('2d'); sg.fillStyle = '#ffffff'; sg.fillRect(0, 0, 128, 64);
      sg.fillStyle = '#dc2626'; for (let x = -64; x < 128; x += 64) { sg.beginPath(); sg.moveTo(x, 64); sg.lineTo(x + 32, 64); sg.lineTo(x + 96, 0); sg.lineTo(x + 64, 0); sg.closePath(); sg.fill(); } }
    const stripeTex = new THREE.CanvasTexture(stripeCanvas); stripeTex.wrapS = THREE.RepeatWrapping;
    const panelMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6, side: THREE.DoubleSide });
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.5 });
    const postGeo = new THREE.CylinderGeometry(0.9, 0.9, 16, 8);
    const PANEL_H = 1.2, PANEL_LO = 0.25;
    S.fences.forEach(f => {
      const P = f.points, closed = typeof hzFenceClosed === 'function' && hzFenceClosed(P);
      for (let i = 0; i + 3 < P.length; i += 2) {
        const dx = P[i + 2] - P[i], dy = P[i + 3] - P[i + 1], len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const geo = new THREE.PlaneGeometry(len * K, PANEL_H * K), uv = geo.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * len / 1.2);   // 줄무늬 한 벌 = 1.2 m
        const panel = new THREE.Mesh(geo, panelMat);
        panel.position.copy(W(P[i] + dx / 2, P[i + 1] + dy / 2, (PANEL_LO + PANEL_H / 2) * K));
        panel.rotation.y = -Math.atan2(dy, dx); panel.castShadow = true; add(panel);
      }
      const rail = []; for (let i = 0; i < P.length; i += 2) rail.push(W(P[i], P[i + 1], (PANEL_LO + PANEL_H) * K));
      const top = tube(rail, 0.6, fenceMat); if (top) add(top);
      const L = hzPolyLength(P);
      for (let d = 0; d <= L + 1e-6; d += 2.5) {   // 기둥 2.5m 간격
        const q = hzPointAt(P, d), post = new THREE.Mesh(postGeo, fenceMat);
        post.position.copy(W(q.x, q.y, 8)); post.castShadow = true; add(post);
      }
      if (closed) {
        const tex = hzTex('noEntry', 1.5);
        if (tex) add(flatMesh(P, ox, oy, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 0.6));
        const c = hzCentroid(P), sp = sprite({ sign: 'noEntry' }, '통행 금지 구역', '#dc2626', 66);
        sp.position.copy(W(c.x, c.y, 38)); add(sp);
      } else {
        const q = hzPointAt(P, L / 2), sp = sprite({ sign: 'noEntry' }, '통행 금지', '#dc2626', 52);
        sp.position.copy(W(q.x, q.y, 36)); add(sp);
      }
    });

    // 장비 · 위험물
    const field = getRiskField();
    field.equipments.forEach((eq, k) => {
      const m = eq.marker;
      const shapes = eq.isFullControl()
        ? [{ type: 'circle', zone: 'red', cx: eq.xc, cy: eq.yc, radius: eq.getMaxRadius() }]
        : eq.getZoneShapes();
      if (S.layers.zones !== false) shapes.forEach((sh, j) => {
        const zs = zoneStyle(sh.zone);
        const mat = new THREE.MeshBasicMaterial({ color: zs.hex, transparent: true, opacity: zs.opacity, depthWrite: false, side: THREE.DoubleSide });
        add(flatMesh(zoneShapePolygon(sh, 48), ox, oy, mat, 0.8 + k * 0.03 + j * 0.01));
      });
      const model = equipmentModel(m.type, (EQUIPMENT_TYPES[m.type] || {}).color || '#f59e0b');
      model.scale.setScalar(3);   // 실제 장비 크기에 가깝게 (굴착기 약 7.5m)
      model.position.copy(W(m.x, m.y, 0)); model.rotation.y = -(m.heading || 0);
      add(model);
      const sp = sprite(m.icon || '⚙️', eq.isFullControl() ? '전면 통제' : m.label, eq.isFullControl() ? '#ef4444' : '#f59e0b', 42);
      sp.position.copy(W(m.x, m.y, m.type === 'towerCrane' ? 95 : 60)); add(sp);
    });
    field.simple.forEach((m, k) => {
      if (S.layers.zones === false) return;
      // v14.8 바닥 원 = 2D 지도와 같은 그림(경고 띠 테두리, 개구부는 어두운 구멍)을 텍스처로
      const R = Math.max(0.5, m.radius || 1), dc = document.createElement('canvas'); dc.width = dc.height = 256;
      const dg = dc.getContext('2d'), kk = 120 / R;
      dg.translate(128, 128); dg.scale(kk, kk);
      hzMarkerDisc(dg, { ...m, x: 0, y: 0, radius: R }, (n) => n / kk * 1.4, { fill: typeof simpleMarkerColor === 'function' ? simpleMarkerColor(m) : null });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(R * 1.04 * K, 48), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(dc), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.copy(W(m.x, m.y, 0.9 + k * 0.02)); add(mesh);
      const st = (typeof HZ_MARKER_STYLE !== 'undefined' && HZ_MARKER_STYLE[m.type]) || null;
      const sp = sprite(st ? { sign: st.sign } : (m.icon || '⚠️'), m.label, st ? (st.tagBg || '#f97316') : '#a855f7', 56); sp.position.copy(W(m.x, m.y, 40)); add(sp);
    });

    // 경로
    const R = S.route;
    if (R && R.result) {
      const p = R.result.path, pts = [];
      for (let i = 0; i < p.length; i += 2) pts.push(W(p[i], p[i + 1], 3));
      add(tube(pts, 5, new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1d4ed8, emissiveIntensity: 0.6 }), 0.35));
      if (R.redirect && R.redirect.target) {
        const a = R.redirect.via, b = R.redirect.target;
        const ug = [W(a.x, a.y, 3), W(a.x, a.y, B1_Y + 6), W(b.x, b.y, B1_Y + 6), W(b.x, b.y, 3)];
        const mat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.6 });
        for (let i = 0; i < 3; i++) add(tube([ug[i], ug[i + 1]], 3, mat));
      }
      R.points.forEach((pt, i) => {
        const sp = sprite(i === 0 ? '🟢' : '🏁', i === 0 ? '출발' : '도착', i === 0 ? '#10b981' : '#ef4444', 38);
        sp.position.copy(W(pt.x, pt.y, 30)); add(sp);
      });
    }
    if (api.onBuilt) api.onBuilt(sunInfo);
    syncPeople();   // 레이어(👷 인원) 켜고 끔을 다음 갱신(0.3초)까지 기다리지 않고 바로
  }

  /** 지하 1층 주차장: 보행 구역(없으면 건물 범위+여유) 형태로 절차적 생성 */
  function buildUnderground(polys, ox, oy, W, add) {
    let outline = S.walkableAreaPolygon.length >= 6 ? S.walkableAreaPolygon : null;
    if (!outline) {
      const all = polys.filter(p => p.length >= 6);
      if (!all.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of all) { const b = polygonBBox(p); minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); }
      const pad = 5;
      outline = [minX - pad, minY - pad, maxX + pad, minY - pad, maxX + pad, maxY + pad, minX - pad, maxY + pad];
    }
    add(flatMesh(outline, ox, oy, new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9, side: THREE.DoubleSide }), B1_Y));
    const walls = new THREE.Mesh(
      new THREE.ExtrudeGeometry(makeShape(outline, ox, oy), { depth: -B1_Y, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0x64748b, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    walls.rotation.x = -Math.PI / 2; walls.position.y = B1_Y; add(walls);

    const pillarGeo = new THREE.CylinderGeometry(3, 3, -B1_Y, 10);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.5 });
    const bb = polygonBBox(outline), SP = 6;   // 기둥 간격 6m
    for (let x = bb.minX + SP / 2; x <= bb.maxX; x += SP) {
      for (let y = bb.minY + SP / 2; y <= bb.maxY; y += SP) {
        if (!isPointInPolygon(x, y, outline)) continue;
        const p = new THREE.Mesh(pillarGeo, pillarMat);
        p.position.copy(W(x, y, B1_Y / 2)); // v11 은 z 부호가 반대로 들어가 기둥이 상하 반전돼 있었음
        add(p);
      }
    }
    const light = new THREE.PointLight(0xfff4e0, 0.8, Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) * K * 1.5);
    light.position.copy(W((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, B1_Y / 2)); add(light);
    const sp = sprite('🅿️', 'B1 지하주차장', '#eab308', 46);
    sp.position.copy(W(bb.minX + 4, bb.minY + 4, B1_Y + 20)); add(sp);
  }

  const api = {
    available,
    show(container) {
      if (!available()) return false;
      if (!ready) init(container);
      resize(); build();
      if (typeof Basemap !== 'undefined') Basemap.onTile = () => { clearTimeout(groundTimer); groundTimer = setTimeout(drawGround, 150); };
      if (!running) { running = true; loop(); }
      return true;
    },
    hide() { running = false; if (typeof Basemap !== 'undefined') Basemap.onTile = null; },
    rebuild() { if (ready && running) build(); },
    resize,
    get sun() { return sunInfo; },
    onPick: null,     // (건물 번호 | null) — app.js 가 지정
    onBuilt: null,    // (태양 정보) — 3D 패널 표시
    peopleSource: null,   // () => [{id, x, y, name, role, online, level, color}] — project.js 가 지정
    /** 시험·디버그용 상태 */
    stats: () => ({ ready, running, satellite: groundOn, people: peopleMap.size, peopleVisible: !!(peopleGroup && peopleGroup.visible), pickables: pickables.length }),
  };
  return api;
})();
