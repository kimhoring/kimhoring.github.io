/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v12 — 3D 뷰어 (Three.js r128)
 *  좌표 규칙: 현장 (x, y)[m] → 3D ((x − cx)·K, 높이, (y − cy)·K),  K = 10 단위/m (모델 비율 유지용)
 *  v11 대비: 지하 기둥 좌우 반전 수정, 재생성 시 GPU 메모리 해제, 카메라 위치 유지,
 *           건물별 층수 반영, 전면 통제 표시, 3D 모드가 아닐 때 렌더 루프 정지
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const View3D = (() => {
  let scene, camera, renderer, controls, content, sun;
  let ready = false, running = false, lastSize = '', bgTexture = null, bgTextureSrc = null;
  const K = 10, FLOOR_H = 3 * K, B1_Y = -4 * K;   // 층고 3m, 지하 1층 4m

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

    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.55));
    sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun, sun.target);
    content = new THREE.Group();
    scene.add(content);
    ready = true;
  }

  function dispose(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) { if (m.map && m.map !== bgTexture) m.map.dispose(); m.dispose(); }
    });
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
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
  function flatMesh(flat, ox, oy, mat, y) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(makeShape(flat, ox, oy)), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = y;
    return m;
  }
  function tube(points3, radius, mat, flatten) {
    if (points3.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points3, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, Math.min(800, Math.max(16, points3.length * 3)), radius, 8, false);
    const m = new THREE.Mesh(geo, mat);
    if (flatten) m.scale.y = flatten;
    return m;
  }
  function sprite(emojiText, text, color, size = 46) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(11,17,32,0.92)'; g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.fill();
    g.lineWidth = 10; g.strokeStyle = color; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '80px "Segoe UI Emoji",sans-serif'; g.fillText(emojiText, 128, 108);
    g.font = `bold ${text.length > 6 ? 22 : 28}px "Malgun Gothic",sans-serif`; g.fillStyle = '#fff'; g.fillText(text, 128, 184);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sp.scale.set(size, size, 1); sp.renderOrder = 10;
    return sp;
  }

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

  // ═══════════════════════════════════════════════
  function build() {
    if (!ready) return;
    content.children.slice().forEach(c => { dispose(c); content.remove(c); });

    const E = docExtent();
    const ox = E.minX + E.w / 2, oy = E.minY + E.h / 2, ext = Math.max(E.w, E.h) * K;
    const W = (x, y, h = 0) => new THREE.Vector3((x - ox) * K, h, (y - oy) * K);
    const add = (o) => { if (o) content.add(o); return o; };

    // 카메라/조명은 도면 크기가 바뀔 때만 재설정 (슬라이더 조작 시 시점 유지)
    const sizeKey = [E.minX, E.minY, E.w, E.h].map(v => v.toFixed(0)).join(',');
    if (sizeKey !== lastSize) {
      lastSize = sizeKey;
      camera.position.set(0, ext * 0.75, ext * 0.85);
      controls.target.set(0, 0, 0);
      const sc = sun.shadow.camera;
      sc.left = -ext * 0.7; sc.right = ext * 0.7; sc.top = ext * 0.7; sc.bottom = -ext * 0.7; sc.far = ext * 4;
      sc.updateProjectionMatrix();
    }
    sun.position.set(ext * 0.4, ext * 1.1, ext * 0.5);

    // 바닥: 현장 범위 지면 + 정합 변환대로 놓인 배치도
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(E.w * K * 1.6, E.h * K * 1.6), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; ground.receiveShadow = true;
    add(ground);
    const PT = planTransform();
    if (S.bgImage && PT && S.plan.width) {
      if (bgTextureSrc !== S.bgImageSrc) {
        if (bgTexture) bgTexture.dispose();
        bgTexture = new THREE.Texture(S.bgImage); bgTexture.needsUpdate = true; bgTextureSrc = S.bgImageSrc;
        bgTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
      const [a, b, , d, e] = PT.matrix;
      const w = S.plan.width * Math.hypot(a, d), h = S.plan.height * Math.hypot(b, e);
      const c = PT.apply({ x: S.plan.width / 2, y: S.plan.height / 2 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * K, h * K), new THREE.MeshStandardMaterial({ map: bgTexture, roughness: 0.9 }));
      plane.rotation.x = -Math.PI / 2; plane.receiveShadow = true;
      const g = new THREE.Group(); g.add(plane);
      g.position.copy(W(c.x, c.y, 0)); g.rotation.y = -Math.atan2(d, a);
      add(g);
    }

    const polys = getContourPolys();

    // 건물
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.72, roughness: 0.25, metalness: 0.4 });
    const blockedMat = new THREE.MeshStandardMaterial({ color: 0xef4444, transparent: true, opacity: 0.75, roughness: 0.35, metalness: 0.2 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.45 });
    polys.forEach((p, i) => {
      if (p.length < 6) return;
      const bd = S.buildingData[i] || {};
      const height = bd.floors ? bd.floors * FLOOR_H : S.settings.buildingHeight * K;
      const shape = makeShape(p, ox, oy);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, bd.entranceBlocked ? blockedMat : glassMat);
      mesh.rotation.x = -Math.PI / 2; mesh.castShadow = true; mesh.receiveShadow = true;
      add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
      edges.rotation.x = -Math.PI / 2; add(edges);
      const slabGeo = new THREE.ShapeGeometry(shape);
      for (let y = FLOOR_H; y < height; y += FLOOR_H) {
        const sl = new THREE.Mesh(slabGeo, slabMat); sl.rotation.x = -Math.PI / 2; sl.position.y = y; add(sl);
      }
      if (bd.name || bd.entranceBlocked) {
        const c = polygonCentroid(p);
        const sp = sprite(bd.entranceBlocked ? '🚫' : '🏢', bd.name || `건물 ${i + 1}`, bd.entranceBlocked ? '#ef4444' : '#60a5fa', 40);
        sp.position.copy(W(c.x, c.y, height + 28)); add(sp);
      }
    });

    if (S.settings.showUnderground) buildUnderground(polys, ox, oy, W, add);

    // 보행 구역 / 환경 구역
    if (S.walkableAreaPolygon.length >= 6) {
      add(flatMesh(S.walkableAreaPolygon, ox, oy, new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }), 0.3));
    }
    S.siteEnvironment.envZones.forEach((z, i) => {
      if (z.polygon.length < 6) return;
      const info = ENV_ZONE_TYPES[z.type] || { color: '#ffffff', icon: '⚠️', label: '' };
      add(flatMesh(z.polygon, ox, oy, new THREE.MeshBasicMaterial({ color: new THREE.Color(info.color), transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }), 0.5 + i * 0.05));
      const c = polygonCentroid(z.polygon), sp = sprite(info.icon, info.label, info.color, 40);
      sp.position.copy(W(c.x, c.y, 26)); add(sp);
    });

    // 도로 / 울타리
    const roadMat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.7 });
    S.polylines.forEach(l => {
      const pts = []; for (let i = 0; i < l.points.length; i += 2) pts.push(W(l.points[i], l.points[i + 1], 1));
      add(tube(pts, (l.width || 3) / 2 * K, roadMat, 0.15));
    });
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 });
    const postGeo = new THREE.CylinderGeometry(1.4, 1.4, 18, 8);
    S.fences.forEach(f => {
      const pts = []; for (let i = 0; i < f.points.length; i += 2) pts.push(W(f.points[i], f.points[i + 1], 12));
      const rail = tube(pts, 1.6, fenceMat); if (rail) { rail.castShadow = true; add(rail); }
      let acc = 0;
      for (let i = 0; i + 3 < f.points.length; i += 2) {
        acc += Math.hypot(f.points[i + 2] - f.points[i], f.points[i + 3] - f.points[i + 1]);
        if (i === 0 || acc >= 2.5) {   // 기둥 2.5m 간격
          acc = 0;
          const post = new THREE.Mesh(postGeo, fenceMat); post.position.copy(W(f.points[i], f.points[i + 1], 9)); post.castShadow = true; add(post);
        }
      }
    });

    // 장비 · 위험물
    const field = getRiskField();
    field.equipments.forEach((eq, k) => {
      const m = eq.marker;
      const shapes = eq.isFullControl()
        ? [{ type: 'circle', zone: 'red', cx: eq.xc, cy: eq.yc, radius: eq.getMaxRadius() }]
        : eq.getZoneShapes();
      shapes.forEach((sh, j) => {
        const mat = new THREE.MeshBasicMaterial({ color: sh.zone === 'red' ? 0xef4444 : 0xf97316, transparent: true, opacity: sh.zone === 'red' ? 0.6 : 0.5, depthWrite: false, side: THREE.DoubleSide });
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
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(m.radius * K, 40), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.copy(W(m.x, m.y, 0.9 + k * 0.02)); add(mesh);
      const sp = sprite(m.icon || '⚠️', m.label, '#f97316', 36); sp.position.copy(W(m.x, m.y, 34)); add(sp);
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

  return {
    available,
    show(container) {
      if (!available()) return false;
      if (!ready) init(container);
      resize(); build();
      if (!running) { running = true; loop(); }
      return true;
    },
    hide() { running = false; },
    rebuild() { if (ready && running) build(); },
    resize,
  };
})();
