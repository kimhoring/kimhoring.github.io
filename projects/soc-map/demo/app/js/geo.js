/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 측지 · 좌표계 · GPS 처리 공통 모듈 (관리자 화면 · 현장 앱 공용)
 *
 *  좌표계: 프로젝트 원점(위경도)에 접하는 WGS84 국소 접평면(ENU), 단위 m
 *          x = 동쪽(+), y = 남쪽(+)  ← 화면처럼 아래가 +y (북쪽이 위)
 *  - LocalFrame       : 위경도 ↔ 국소 좌표 (ECEF 경유, 현장 규모에서 cm 이하 오차)
 *  - fitTransform     : 점 쌍으로 2D 닮음/아핀 변환 추정 (도면 픽셀 → 현장 m)
 *  - solveAlignment   : 도면 정합 — 기준점/검증점 분리, 방식 자동 선택, 정합 오차 추정
 *  - vincentyDistance : 타원체 측지선 거리 (검증용)
 *  - GpsFilter        : 등속 칼만 필터 + 이상치 제거 (휴대폰 GPS 흔들림 완화)
 *  - assessSafety     : 위치 불확실성을 반영한 위험 구역 접근/진입 판정
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const WGS84 = { a: 6378137.0, f: 1 / 298.257223563 };
WGS84.b = WGS84.a * (1 - WGS84.f);
WGS84.e2 = WGS84.f * (2 - WGS84.f);

function geodeticToEcef(lat, lon, h = 0) {
  const p = lat * D2R, l = lon * D2R, sp = Math.sin(p), cp = Math.cos(p);
  const N = WGS84.a / Math.sqrt(1 - WGS84.e2 * sp * sp);
  return [(N + h) * cp * Math.cos(l), (N + h) * cp * Math.sin(l), (N * (1 - WGS84.e2) + h) * sp];
}

function ecefToGeodetic(x, y, z) {
  const lon = Math.atan2(y, x), p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - WGS84.e2)), h = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat), N = WGS84.a / Math.sqrt(1 - WGS84.e2 * s * s);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - WGS84.e2 * N / (N + h)));
  }
  return { lat: lat * R2D, lon: lon * R2D, h };
}

/** 프로젝트 원점 기준 국소 좌표계 */
class LocalFrame {
  constructor(lat0, lon0) {
    this.lat0 = lat0; this.lon0 = lon0;
    this.o = geodeticToEcef(lat0, lon0, 0);
    const p = lat0 * D2R, l = lon0 * D2R;
    this.sp = Math.sin(p); this.cp = Math.cos(p); this.sl = Math.sin(l); this.cl = Math.cos(l);
  }
  /** 위경도 → {x: 동(m), y: 남(m)} */
  toLocal(lat, lon) {
    const [X, Y, Z] = geodeticToEcef(lat, lon, 0);
    const dx = X - this.o[0], dy = Y - this.o[1], dz = Z - this.o[2];
    const e = -this.sl * dx + this.cl * dy;
    const n = -this.sp * this.cl * dx - this.sp * this.sl * dy + this.cp * dz;
    return { x: e, y: -n };
  }
  /** {x, y} → 위경도 (지표면, 높이 0) */
  toLatLon(x, y) {
    const e = x, n = -y;
    let u = 0, g;
    for (let i = 0; i < 3; i++) {   // 접평면 위 점을 타원체 표면으로 내림
      const X = this.o[0] - this.sl * e - this.sp * this.cl * n + this.cp * this.cl * u;
      const Y = this.o[1] + this.cl * e - this.sp * this.sl * n + this.cp * this.sl * u;
      const Z = this.o[2] + this.cp * n + this.sp * u;
      g = ecefToGeodetic(X, Y, Z);
      u -= g.h;
    }
    return { lat: g.lat, lon: g.lon };
  }
}

/** Vincenty 역해: 두 위경도 사이 타원체 거리(m) */
function vincentyDistance(lat1, lon1, lat2, lon2) {
  const { a, b, f } = WGS84;
  const L = (lon2 - lon1) * D2R;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * D2R)), U2 = Math.atan((1 - f) * Math.tan(lat2 * D2R));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, prev, sS, cS, sig, cA2, c2Sm;
  for (let i = 0; i < 200; i++) {
    const sL = Math.sin(lam), cL = Math.cos(lam);
    sS = Math.sqrt((cU2 * sL) ** 2 + (cU1 * sU2 - sU1 * cU2 * cL) ** 2);
    if (sS === 0) return 0;
    cS = sU1 * sU2 + cU1 * cU2 * cL;
    sig = Math.atan2(sS, cS);
    const sA = cU1 * cU2 * sL / sS;
    cA2 = 1 - sA * sA;
    c2Sm = cA2 ? cS - 2 * sU1 * sU2 / cA2 : 0;
    const C = f / 16 * cA2 * (4 + f * (4 - 3 * cA2));
    prev = lam;
    lam = L + (1 - C) * f * sA * (sig + C * sS * (c2Sm + C * cS * (-1 + 2 * c2Sm * c2Sm)));
    if (Math.abs(lam - prev) < 1e-12) break;
  }
  const u2 = cA2 * (a * a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2Sm + B / 4 * (cS * (-1 + 2 * c2Sm * c2Sm) - B / 6 * c2Sm * (-3 + 4 * sS * sS) * (-3 + 4 * c2Sm * c2Sm)));
  return b * A * (sig - dS);
}

/** "35.1234567, 126.1234567" / 도분초 숫자 나열 → {lat, lon} */
// ═══════════════════════════════════════════════
//  한국 평면 직각 좌표 (GRS80 횡메르카토르) — 도면의 대지 경계점·기준점 좌표 입력용
//  Krüger 급수(3차, 중앙 경선에서 수천 km 안 mm 정확도). 좌표 순서는 GIS 와 같이 (동 E, 북 N).
//  ※ 한국 측량 성과표는 X = 북, Y = 동 으로 적는다 → 입력 화면에서 순서를 확인할 것
// ═══════════════════════════════════════════════

const KOREA_CRS = {
  5186: { label: 'TM 중부원점 (EPSG:5186)', lon0: 127, lat0: 38, k0: 1, fe: 200000, fn: 600000 },
  5185: { label: 'TM 서부원점 (EPSG:5185)', lon0: 125, lat0: 38, k0: 1, fe: 200000, fn: 600000 },
  5187: { label: 'TM 동부원점 (EPSG:5187)', lon0: 129, lat0: 38, k0: 1, fe: 200000, fn: 600000 },
  5188: { label: 'TM 동해원점 (EPSG:5188)', lon0: 131, lat0: 38, k0: 1, fe: 200000, fn: 600000 },
  5179: { label: 'UTM-K (EPSG:5179)', lon0: 127.5, lat0: 38, k0: 0.9996, fe: 1000000, fn: 2000000 },
};
const TM_GRS80 = (() => {
  const a = 6378137, f = 1 / 298.257222101, n = f / (2 - f), n2 = n * n, n3 = n2 * n;
  return {
    A: a / (1 + n) * (1 + n2 / 4 + n2 * n2 / 64), e: 2 * Math.sqrt(n) / (1 + n),
    al: [n / 2 - 2 * n2 / 3 + 5 * n3 / 16, 13 * n2 / 48 - 3 * n3 / 5, 61 * n3 / 240],
    be: [n / 2 - 2 * n2 / 3 + 37 * n3 / 96, n2 / 48 + n3 / 15, 17 * n3 / 480],
  };
})();
/** 경선 위(λ = λ0)에서 위도 φ 의 정규화 북향 거리 ξ (원점 위도 보정용) */
function tmXi(phi) {
  const G = TM_GRS80, t = Math.sinh(Math.atanh(Math.sin(phi)) - G.e * Math.atanh(G.e * Math.sin(phi))), xp = Math.atan(t);
  return xp + G.al.reduce((s, a, j) => s + a * Math.sin(2 * (j + 1) * xp), 0);
}
/** 위경도 → 평면 좌표 {e: 동, n: 북} (m) */
function tmForward(lat, lon, code = 5186) {
  const P = KOREA_CRS[code], G = TM_GRS80, phi = lat * D2R, dl = (lon - P.lon0) * D2R;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - G.e * Math.atanh(G.e * Math.sin(phi)));
  const xp = Math.atan(t / Math.cos(dl)), ep = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xp, eta = ep;
  G.al.forEach((a, j) => { const k = 2 * (j + 1); xi += a * Math.sin(k * xp) * Math.cosh(k * ep); eta += a * Math.cos(k * xp) * Math.sinh(k * ep); });
  return { e: P.fe + P.k0 * G.A * eta, n: P.fn + P.k0 * G.A * (xi - tmXi(P.lat0 * D2R)) };
}
/** 평면 좌표(동 e, 북 n) → 위경도 */
function tmInverse(e, n, code = 5186) {
  const P = KOREA_CRS[code], G = TM_GRS80;
  const xi = (n - P.fn) / (P.k0 * G.A) + tmXi(P.lat0 * D2R), eta = (e - P.fe) / (P.k0 * G.A);
  let xp = xi, ep = eta;
  G.be.forEach((b, j) => { const k = 2 * (j + 1); xp -= b * Math.sin(k * xi) * Math.cosh(k * eta); ep -= b * Math.cos(k * xi) * Math.sinh(k * eta); });
  // 등각 위도 χ → 측지 위도 φ: 등장 위도 ψ(φ) = atanh(sinφ) − e·atanh(e·sinφ) 를 뉴턴법으로 맞춘다 (급수보다 정확)
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep)), psi = Math.atanh(Math.sin(chi)), e2 = G.e * G.e;
  let phi = chi;
  for (let i = 0; i < 6; i++) {
    const sn = Math.sin(phi), f = Math.atanh(sn) - G.e * Math.atanh(G.e * sn) - psi;
    phi -= f * Math.cos(phi) * (1 - e2 * sn * sn) / (1 - e2);
  }
  return { lat: phi * R2D, lon: P.lon0 + Math.atan2(Math.sinh(ep), Math.cos(xp)) * R2D };
}
/** 경도로 알맞은 TM 원점 (서부 < 126° ≤ 중부 < 128° ≤ 동부 < 130° ≤ 동해) */
function suggestKoreaCrs(lon) { return lon < 126 ? 5185 : lon < 128 ? 5186 : lon < 130 ? 5187 : 5188; }

function parseLatLon(text) {
  const nums = String(text || '').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = +nums[0], lon = +nums[1];
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// ═══════════════════════════════════════════════
//  2D 변환 추정 (도면 픽셀 → 현장 m)
// ═══════════════════════════════════════════════

/**
 * pairs: [{src:{x,y}, dst:{x,y}}]  2쌍 = 닮음(회전·축척·이동), 3쌍 이상 = 최소제곱 아핀
 * method: 'similarity' 면 점이 많아도 닮음만, 'fixedScale' 이면 축척을 fixedScale(m/px)로 고정하고 회전·이동만
 *         (도면 정합은 solveAlignment 를 쓸 것)
 * matrix [a, b, c, d, e, f] :  X = a·x + b·y + c,  Y = d·x + e·y + f
 */
function fitTransform(pairs, method, fixedScale) {
  const P = (pairs || []).filter(p => [p.src.x, p.src.y, p.dst.x, p.dst.y].every(isFinite));
  if (P.length < 2) return null;
  let m = null;
  if (P.length >= 3 && method !== 'similarity' && method !== 'fixedScale') {
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    for (const p of P) {
      const v = [p.src.x, p.src.y, 1];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) S[i][j] += v[i] * v[j]; bx[i] += v[i] * p.dst.x; by[i] += v[i] * p.dst.y; }
    }
    const inv = invert3(S);
    if (inv) {
      const mul = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
      const [a, b, c] = mul(inv, bx), [d, e, f] = mul(inv, by);
      if (Math.abs(a * e - b * d) > 1e-12) { m = [a, b, c, d, e, f]; method = 'affine'; }
    }
  }
  if (!m) {
    // 닮음: 복소수 dst = α·src + β (모든 점 최소제곱)
    const n = P.length;
    const sx = P.reduce((s, p) => s + p.src.x, 0) / n, sy = P.reduce((s, p) => s + p.src.y, 0) / n;
    const dx = P.reduce((s, p) => s + p.dst.x, 0) / n, dy = P.reduce((s, p) => s + p.dst.y, 0) / n;
    let num_r = 0, num_i = 0, den = 0;
    for (const p of P) {
      const ux = p.src.x - sx, uy = p.src.y - sy, vx = p.dst.x - dx, vy = p.dst.y - dy;
      num_r += ux * vx + uy * vy; num_i += ux * vy - uy * vx; den += ux * ux + uy * uy;
    }
    if (den < 1e-12) return null;
    let ar = num_r / den, ai = num_i / den;
    if (method === 'fixedScale' && fixedScale > 0) {   // 회전 방향만 쓰고 크기는 알려진 축척으로
      const mag = Math.hypot(ar, ai) || 1;
      ar = ar / mag * fixedScale; ai = ai / mag * fixedScale;
    } else method = 'similarity';
    m = [ar, -ai, dx - (ar * sx - ai * sy), ai, ar, dy - (ai * sx + ar * sy)];
  }
  return makeTransform(m, P, method);
}

/**
 * 건물 외곽 매칭으로 도면 → 현장 닮음 변환 추정 (v14.6 — 도면 축척·방향·위치 자동 판단)
 * AI 가 도면에서 찾은 건물(src: 도면 px)과 실제 건물(dst: 현장 m, 브이월드 GIS건물통합정보)을 중심점·면적으로 짝 짓는다.
 *  1) 가설: src 큰 건물 두 동 ↔ dst 두 동 → 축척·회전·이동 (두 동 모두 면적 비가 축척²와 맞아야 함)
 *  2) 점수: 변환한 src 중심이 dst 중심에서 허용 거리(√면적의 25 %, 최소 2.5 m) 안이고 면적 비가 맞는 건물 수 (같으면 오차 작은 쪽)
 *  3) 가장 좋은 가설의 짝으로 최소제곱 닮음 → 한 번 더 짝 짓기
 *  4) 짝 중 오차가 중앙값의 2.5배를 넘는 것(오검출이 우연히 걸린 것)을 빼고 다시 맞춤
 *  5) 우연히 맞는 경우를 걸러냄: 짝 minInliers(기본 5)개 이상 · 도면 건물의 minFrac(기본 40 %) 이상 · RMS ≤ maxRms(기본 3 m)
 *     — 무작위 배치 시험(실제 40·100동)에서 우연한 짝은 최대 4개였고 참 짝은 5개 이상 (tests/match.test.js)
 * src/dst: [{x, y, area}] · opts: {scaleRange:[min,max] (m/px), areaTol: 면적 비 허용 배수(기본 1.6), minInliers, minFrac, maxRms}
 * @returns {{transform, pairs:[{i,j,err}], rms, hypotheses}} | null
 */
function matchFootprints(src, dst, opts = {}) {
  const [smin, smax] = opts.scaleRange || [1e-4, 1e4];
  const LT = Math.log(opts.areaTol || 1.6), minIn = opts.minInliers || 5, maxRms = opts.maxRms || 3, minFrac = opts.minFrac ?? 0.4;
  if (src.length < 3 || dst.length < 3) return null;
  const la = (a) => (a > 0 ? Math.log(a) : null);
  const sL = src.map(p => la(p.area)), dL = dst.map(q => la(q.area)), tol = dst.map(q => Math.max(2.5, 0.25 * Math.sqrt(q.area > 0 ? q.area : 100)));
  const areaOk = (ls, lk2, ld) => ls == null || ld == null || Math.abs(ls + lk2 - ld) <= LT;
  // 실제 건물 격자(칸 = 가장 큰 허용 거리) — 가까운 건물만 확인해 가설 수만큼 반복하는 짝 짓기를 빠르게
  const cell = Math.max(...tol), grid = new Map(), key = (gx, gy) => gx * 100003 + gy;
  dst.forEach((q, j) => { const k = key(Math.floor(q.x / cell), Math.floor(q.y / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(j); });
  function pairUp(a, b, c, d, e, f, lk2) {
    const used = new Uint8Array(dst.length), pairs = [];
    let pen = 0;
    for (let i = 0; i < src.length; i++) {
      const p = src[i], X = a * p.x + b * p.y + c, Y = d * p.x + e * p.y + f, gx = Math.floor(X / cell), gy = Math.floor(Y / cell);
      let bj = -1, be = Infinity;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const list = grid.get(key(gx + ox, gy + oy));
        if (list) for (const j of list) {
          if (used[j]) continue;
          const err = Math.hypot(dst[j].x - X, dst[j].y - Y);
          if (err < be && err <= tol[j] && areaOk(sL[i], lk2, dL[j])) { bj = j; be = err; }
        }
      }
      if (bj >= 0) { used[bj] = 1; pairs.push({ i, j: bj, err: be }); pen += be / tol[bj]; }
    }
    return { pairs, pen: pen / Math.max(1, pairs.length), quality: pairs.length - 0.5 * pen / Math.max(1, pairs.length) };
  }
  // 가설은 큰 건물부터(AI 가 잘 찾고 면적이 뚜렷함) 최대 6동으로 — 계산량을 줄인다
  const seeds = src.map((p, i) => i).sort((x, y) => (src[y].area || 0) - (src[x].area || 0)).slice(0, 6);
  let best = null, hyp = 0;
  for (let u = 0; u < seeds.length; u++) for (let v = u + 1; v < seeds.length; v++) {
    const i1 = seeds[u], i2 = seeds[v], s1 = src[i1], s2 = src[i2], sx = s2.x - s1.x, sy = s2.y - s1.y, ls = Math.hypot(sx, sy);
    if (ls < 1e-9) continue;
    const as = Math.atan2(sy, sx);
    for (let j1 = 0; j1 < dst.length; j1++) for (let j2 = 0; j2 < dst.length; j2++) {
      if (j1 === j2) continue;
      const d1 = dst[j1], d2 = dst[j2], dx = d2.x - d1.x, dy = d2.y - d1.y, ld = Math.hypot(dx, dy);
      if (ld < 5) continue;   // 너무 가까운 두 건물은 방향이 불안정
      const k = ld / ls, lk2 = 2 * Math.log(k);
      if (k < smin || k > smax || !areaOk(sL[i1], lk2, dL[j1]) || !areaOk(sL[i2], lk2, dL[j2])) continue;
      hyp++;
      const th = Math.atan2(dy, dx) - as, co = Math.cos(th) * k, si = Math.sin(th) * k;
      const c = d1.x - (co * s1.x - si * s1.y), f = d1.y - (si * s1.x + co * s1.y);
      const r = pairUp(co, -si, c, si, co, f, lk2);
      if (!best || r.quality > best.quality) best = r;
    }
  }
  if (!best || best.pairs.length < minIn) return null;
  let T = fitTransform(best.pairs.map(({ i, j }) => ({ src: src[i], dst: dst[j] })), 'similarity');
  if (!T) return null;
  const [a, b, c, d, e, f] = T.matrix, again = pairUp(a, b, c, d, e, f, 2 * Math.log(T.scale));
  if (again.pairs.length >= best.pairs.length) {
    const T2 = fitTransform(again.pairs.map(({ i, j }) => ({ src: src[i], dst: dst[j] })), 'similarity');
    if (T2) { T = T2; best = again; }
  }
  const measure = (pairs, TT) => pairs.forEach(pr => { const q = TT.apply(src[pr.i]); pr.err = Math.hypot(q.x - dst[pr.j].x, q.y - dst[pr.j].y); });
  let pairs = best.pairs;
  measure(pairs, T);
  const med = pairs.map(pr => pr.err).sort((x, y) => x - y)[Math.floor(pairs.length / 2)];
  const kept = pairs.filter(pr => pr.err <= Math.max(1, 2.5 * med));
  if (kept.length < pairs.length && kept.length >= 3) {
    const T3 = fitTransform(kept.map(({ i, j }) => ({ src: src[i], dst: dst[j] })), 'similarity');
    if (T3) { T = T3; pairs = kept; measure(pairs, T); }
  }
  const rms = Math.sqrt(pairs.reduce((s2, pr) => s2 + pr.err * pr.err, 0) / pairs.length);
  if (pairs.length < Math.max(minIn, Math.ceil(minFrac * src.length)) || rms > maxRms) return null;   // 우연히 맞은 배치는 버린다
  return { transform: T, pairs, rms, hypotheses: hyp };
}

// ═══════════════════════════════════════════════
//  도면 정합 (기준점 → 변환 · 오차)
// ═══════════════════════════════════════════════

/** 변환 방식별 매개변수 수 — 축척 고정: 이동 2 + 회전, 닮음: + 축척, 아핀: 6 */
const ALIGN_PARAMS = { translate: 2, fixedScale: 3, similarity: 4, affine: 6 };
const ALIGN_AFFINE_MIN = 5;   // 자동 선택일 때 아핀은 기준점 5개 이상부터 (여유 관측 4개 이상)

/**
 * 정합 품질. refs: [{px, dst, check?}] — check 인 점(검증점)은 변환 계산에 쓰지 않고 오차만 잰다.
 * error(m): 검증점이 있으면 검증점 RMS, 없으면 여유 관측(2·기준점 수 − 매개변수 수)으로 추정한 2D 오차,
 *           여유 관측도 없으면(2점 닮음, 3점 아핀) null = 알 수 없음 — 이때 기준점에는 오차 0으로 보인다
 */
function alignmentStats(T, refs, params) {
  const res = refs.map(r => { const q = T.apply(r.px); return Math.hypot(q.x - r.dst.x, q.y - r.dst.y); });
  const fitR = res.filter((_, i) => !refs[i].check), chkR = res.filter((_, i) => refs[i].check);
  const ss = (a) => a.reduce((s, v) => s + v * v, 0);
  const dof = 2 * fitR.length - params;
  const checkRms = chkR.length ? Math.sqrt(ss(chkR) / chkR.length) : null;
  const est = dof > 0 ? Math.sqrt(2 * ss(fitR) / dof) : null;   // 축별 σ² = Σr²/dof, 2D 오차 = √2·σ
  return {
    residuals: res, dof,
    fitRms: fitR.length ? Math.sqrt(ss(fitR) / fitR.length) : null, checkRms,
    error: checkRms ?? est, errorSource: checkRms != null ? 'check' : est != null ? 'redundancy' : null,
  };
}

/**
 * 도면 정합. method: 'auto' | 'fixedScale' | 'similarity' | 'affine'(3점 이상)
 *   auto: 도면 축척(knownScale, m/px — PDF 1/N 또는 치수 확인)을 알면 기준점 5개 미만에서 축척 고정,
 *         모르면 닮음, 기준점 5개 이상이면 아핀
 * 종이 도면·CAD 출력은 축척이 가로세로 같으므로 닮음이 기본이다. 아핀은 스캔 왜곡 보정용.
 * 휴대폰 GPS 기준점은 오차가 수 m 라 축척까지 GPS 로 정하면 축척이 1~2% 틀어질 수 있다 → 축척을 알면 고정이 유리
 * @returns {{transform, method, residuals, dof, fitRms, checkRms, error, errorSource}} | null (기준점 2개 미만)
 */
function solveAlignment(refs, method = 'auto', knownScale = null) {
  const fit = refs.filter(r => !r.check);
  if (fit.length < 2) return null;
  const k = knownScale > 0 ? knownScale : null;
  let want;
  if (method === 'fixedScale') want = k ? 'fixedScale' : 'similarity';
  else if (method === 'similarity') want = 'similarity';
  else if (method === 'affine') want = fit.length >= 3 ? 'affine' : 'similarity';
  else want = fit.length >= ALIGN_AFFINE_MIN ? 'affine' : k ? 'fixedScale' : 'similarity';
  const T = fitTransform(fit.map(r => ({ src: r.px, dst: r.dst })), want, knownScale);
  if (!T) return null;
  return { transform: T, method: T.method, ...alignmentStats(T, refs, ALIGN_PARAMS[T.method] || 4) };
}

function makeTransform(m, pairs = [], method = 'manual') {
  const [a, b, c, d, e, f] = m, det = a * e - b * d;
  const apply = (p) => ({ x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f });
  const inverse = (p) => { const X = p.x - c, Y = p.y - f; return { x: (e * X - b * Y) / det, y: (-d * X + a * Y) / det }; };
  const resid = pairs.map(p => { const q = apply(p.src); return Math.hypot(q.x - p.dst.x, q.y - p.dst.y); });
  return {
    matrix: m, method, count: pairs.length, apply, inverse,
    scale: Math.sqrt(Math.abs(det)),                  // 도면 1px 당 m
    rotation: Math.atan2(d, a) * R2D,                 // 도면의 회전(도)
    rms: resid.length ? Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / resid.length) : 0,
    residuals: resid,
  };
}

function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// ═══════════════════════════════════════════════
//  GPS 칼만 필터 (축별 등속 모델)
// ═══════════════════════════════════════════════

class GpsFilter {
  /**
   * @param {number} accelSigma 가속도 표준편차(m/s²) — 보행자 1.0, 장비 0.6 정도
   */
  constructor(accelSigma = 1.0) {
    this.q = accelSigma * accelSigma;
    this.reset();
  }
  reset() { this.t = null; this.ax = null; this.ay = null; this.rejects = 0; this.lastReject = null; }

  _axis(z, R) { return { p: z, v: 0, P: [[R, 0], [0, 4]] }; }

  _predict(k, dt) {
    const q = this.q, P = k.P;
    k.p += k.v * dt;
    const p00 = P[0][0] + dt * (P[1][0] + P[0][1]) + dt * dt * P[1][1] + q * dt ** 4 / 4;
    const p01 = P[0][1] + dt * P[1][1] + q * dt ** 3 / 2;
    const p11 = P[1][1] + q * dt * dt;
    k.P = [[p00, p01], [p01, p11]];
  }

  _update(k, z, R) {
    const S = k.P[0][0] + R, y = z - k.p;
    const K0 = k.P[0][0] / S, K1 = k.P[1][0] / S;
    k.p += K0 * y; k.v += K1 * y;
    const P = k.P;
    k.P = [[(1 - K0) * P[0][0], (1 - K0) * P[0][1]], [P[1][0] - K1 * P[0][0], P[1][1] - K1 * P[0][1]]];
  }

  /**
   * @param x,y 측정 위치(m)  @param acc 브라우저 정확도(m, 약 68% 반경)  @param t 시각(ms)
   * @returns {{x, y, vx, vy, speed, sigma, rejected}}
   */
  update(x, y, acc, t) {
    // accuracy 의미: W3C Geolocation 표준은 95% 신뢰 반경(→ σ = acc/2.45), Android 는 68% 반경(→ σ = acc/1.51)을 보고한다.
    // 기기별로 달라 알 수 없으므로 σ 를 더 크게 잡는 68% 해석을 쓴다 (경고 거리가 넓어지는 보수적 선택).
    const sigma = Math.max(1, (acc || 10) / 1.51);
    const R = sigma * sigma;
    if (this.ax === null || this.t === null || (t - this.t) > 60000) {
      this.ax = this._axis(x, R); this.ay = this._axis(y, R); this.t = t; this.rejects = 0;
      return this.state(false);
    }
    const dt = Math.max(0.05, (t - this.t) / 1000);
    this._predict(this.ax, dt); this._predict(this.ay, dt);
    this.t = t;
    // 게이팅: 예측과 너무 다르면(약 4σ) 버린다. 3회 연속이면 실제 이동으로 보고 재초기화
    const ix = x - this.ax.p, iy = y - this.ay.p;
    const d2 = ix * ix / (this.ax.P[0][0] + R) + iy * iy / (this.ay.P[0][0] + R);
    // 버린 측정과 같은 자리(2σ 이내)에 다시 찍히면 위치가 실제로 건너뛴 것이다 (터널·건물 뒤에서 재수신 등).
    // 이때 칼만 갱신을 하면 점프를 속도로 해석해 수 m 지나치므로(정지 상태에서 30 m 점프 시 약 4 m), 그 자리에서 다시 시작한다.
    const sameJump = this.lastReject && Math.hypot(x - this.lastReject.x, y - this.lastReject.y) <= 2 * sigma;
    if (sameJump || (d2 > 16 && ++this.rejects >= 3)) {
      this.ax = this._axis(x, R); this.ay = this._axis(y, R); this.rejects = 0; this.lastReject = null;
      return this.state(false);
    }
    if (d2 > 16) { this.lastReject = { x, y }; return this.state(true); }
    this.rejects = 0; this.lastReject = null;
    this._update(this.ax, x, R); this._update(this.ay, y, R);
    return this.state(false);
  }

  state(rejected) {
    const vx = this.ax.v, vy = this.ay.v;
    return {
      x: this.ax.p, y: this.ay.p, vx, vy, speed: Math.hypot(vx, vy),
      sigma: Math.sqrt((this.ax.P[0][0] + this.ay.P[0][0]) / 2), rejected,
    };
  }
}

/** 여러 GPS 샘플의 가중 평균 (측량용). samples: [{lat, lon, acc}] */
function averageFixes(samples) {
  const good = samples.filter(s => s.acc && s.acc < 30);
  if (!good.length) return null;
  const f = new LocalFrame(good[0].lat, good[0].lon);
  let sw = 0, sx = 0, sy = 0;
  const pts = good.map(s => ({ ...f.toLocal(s.lat, s.lon), w: 1 / (s.acc * s.acc) }));
  for (const p of pts) { sw += p.w; sx += p.w * p.x; sy += p.w * p.y; }
  const mx = sx / sw, my = sy / sw;
  const spread = Math.sqrt(pts.reduce((s, p) => s + p.w * ((p.x - mx) ** 2 + (p.y - my) ** 2), 0) / sw);
  const ll = f.toLatLon(mx, my);
  // 평균의 표준오차 ≈ 개별 오차 / √n (단, GPS 오차는 시간 상관이 커서 보수적으로 √(n/10) 사용)
  const meanAcc = good.reduce((s, g) => s + g.acc, 0) / good.length;
  return { ...ll, n: good.length, spread, estError: Math.max(spread, meanAcc / Math.sqrt(Math.max(1, good.length / 10))) };
}

// ═══════════════════════════════════════════════
//  위험 접근 · 진입 판정 (단위 m)
// ═══════════════════════════════════════════════

const SAFETY = {
  DANGER_R: 70,
  CAUTION_R: 30,
  WARN_M: 8,           // 위험 구역까지 이 거리 이내면 접근 경고
  MAX_UNCERT_M: 8,     // 위치 불확실성으로 경고 거리를 넓히는 최대치
  PROBE_M: [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16],
  PROBE_DIRS: 24,
};

const LEVELS = {
  safe:    { rank: 0, label: '안전',           color: '#10b981' },
  caution: { rank: 1, label: '주의',           color: '#eab308' },
  warning: { rank: 2, label: '위험 구역 접근', color: '#f97316' },
  danger:  { rank: 3, label: '위험 구역 진입', color: '#ef4444' },
};

/**
 * @param field RiskField (m 단위)  @param sigma 위치 표준오차(m)
 * @returns {{risk, level, nearestDangerM, bearing, source, warnRadius}}
 */
function assessSafety(field, x, y, sigma = 0) {
  const risk = field.at(x, y);
  const warnRadius = SAFETY.WARN_M + Math.min(SAFETY.MAX_UNCERT_M, sigma || 0);
  let nearest = Infinity, nearPt = null, bearing = null;
  if (risk < SAFETY.DANGER_R) {
    outer:
    for (const d of SAFETY.PROBE_M) {
      if (d > warnRadius + 6) break;
      for (let k = 0; k < SAFETY.PROBE_DIRS; k++) {
        const a = k / SAFETY.PROBE_DIRS * Math.PI * 2, px = x + d * Math.cos(a), py = y + d * Math.sin(a);
        if (field.at(px, py) >= SAFETY.DANGER_R) { nearest = d; nearPt = { x: px, y: py }; bearing = a; break outer; }
      }
    }
  } else nearest = 0;
  const level = risk >= SAFETY.DANGER_R ? 'danger'
    : nearest <= warnRadius ? 'warning'
    : risk >= SAFETY.CAUTION_R ? 'caution' : 'safe';
  const why = (level === 'warning' && nearPt ? field.explain(nearPt.x, nearPt.y) : risk > 0 ? field.explain(x, y) : [])[0];
  return { risk: Math.round(risk), level, nearestDangerM: isFinite(nearest) ? nearest : null, bearing, source: why ? why.text : '', warnRadius };
}

class SafetyTracker {
  constructor() { this.level = 'safe'; this.pending = null; this.count = 0; }
  update(raw) {
    if (raw === this.level) { this.pending = null; this.count = 0; return false; }
    const up = LEVELS[raw].rank > LEVELS[this.level].rank;
    if (this.pending === raw) this.count++; else { this.pending = raw; this.count = 1; }
    const need = up ? (raw === 'danger' ? 2 : 1) : 3;
    if (this.count >= need) { this.level = raw; this.pending = null; this.count = 0; return true; }
    return false;
  }
}

/** 국소 좌표계 각도(x=동, y=남) → 8방위 */
function compassName(rad) {
  const brg = ((Math.atan2(Math.cos(rad), -Math.sin(rad)) * R2D) + 360) % 360; // 북=0, 동=90
  return ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(brg / 45) % 8];
}
/** 나침반 방위(북=0°, 시계방향) → 국소 좌표계 heading(라디안, x축 기준) */
function bearingToHeading(deg) { return (deg - 90) * D2R; }
function headingToBearing(rad) { return ((rad * R2D + 90) % 360 + 360) % 360; }

// ═══════════════════════════════════════════════
//  v14.7 도면 축척 표기 읽기 — PDF 글자 층(·OCR)의 「축척 1/600」「SCALE 1:500」「A1 1/300 · A3 1/600」
//  표제란에 용지별 축척을 함께 적는 관례(A1 원도를 A3 로 출력하면 축척 두 배)를 실제 용지 크기로 고른다.
// ═══════════════════════════════════════════════
/** 건축 도면에 흔한 축척 분모 — 이 목록 밖의 값은 오인식으로 보고 버림 (설계값) */
const DRAWING_SCALES = [50, 60, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2400, 2500, 3000, 5000];
const PAPER_LONG_MM = { A0: 1189, A1: 841, A2: 594, A3: 420, A4: 297 };

/**
 * @param {string} text   도면 글자 (여러 조각을 공백으로 이은 것)
 * @param {string|null} paper  실제 용지(A0~A4, PDF 쪽 크기로 판단) — 모르면 null
 * @returns {{denom:number, how:string, snippet:string, candidates:number[]} | null}
 *   how: 'paper'(용지별 표기 중 실제 용지) · 'paper-converted'(다른 용지 표기를 실제 용지로 환산) · 'keyword'(축척/SCALE/S=) · 'bare'(1/N 만)
 */
function parseDrawingScale(text, paper = null) {
  if (!text) return null;
  const t = String(text).normalize('NFKC').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/\s+/g, ' ');
  if (/\b(N\.?\s?T\.?\s?S\.?|NONE\s?SCALE|축척\s*없음)\b/i.test(t) && !/1\s*[\/:]\s*\d{2,5}/.test(t)) return null;
  const ok = (n) => DRAWING_SCALES.includes(n);
  const R = String.raw`1\s*[\/:]\s*(\d{2,5})(?!\d)`;
  const found = [];
  const add = (denom, how, idx, len, p) => { if (ok(denom)) found.push({ denom, how, p, snippet: t.slice(Math.max(0, idx), idx + len).trim() }); };
  let m;
  const rePaper = new RegExp(String.raw`\b(A[0-4])\s*(?:용지)?\s*[:=]?\s*(?:축\s*척|SCALE|S\s*[=:])?\s*[:=]?\s*` + R, 'gi');
  while ((m = rePaper.exec(t))) add(+m[2], 'paper', m.index, m[0].length, m[1].toUpperCase());
  const rePaper2 = new RegExp(R + String.raw`\s*\(\s*(A[0-4])\s*\)`, 'gi');
  while ((m = rePaper2.exec(t))) add(+m[1], 'paper', m.index, m[0].length, m[2].toUpperCase());
  const reKey = new RegExp(String.raw`(?:축\s*척|SCALE|\bS\s*[=:])\s*[:=]?\s*` + R, 'gi');
  while ((m = reKey.exec(t))) add(+m[1], 'keyword', m.index, m[0].length);
  const reBare = new RegExp(String.raw`(?<![\d\/])` + R + String.raw`(?![\/\d])`, 'g');
  while ((m = reBare.exec(t))) add(+m[1], 'bare', m.index, m[0].length);
  if (!found.length) return null;
  const candidates = [...new Set(found.map(f => f.denom))];
  const byPaper = found.filter(f => f.how === 'paper');
  if (byPaper.length) {
    const same = paper && byPaper.find(f => f.p === paper);
    if (same) return { denom: same.denom, how: 'paper', snippet: same.snippet, candidates };
    if (paper && PAPER_LONG_MM[paper]) {   // 예: 「A1 1/300」만 적힌 도면을 A3 로 출력 → 841/420 ≈ 2 → 1/600
      const f = byPaper[0], d = Math.round(f.denom * PAPER_LONG_MM[f.p] / PAPER_LONG_MM[paper]);
      const near = DRAWING_SCALES.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
      if (Math.abs(near / d - 1) < 0.03) return { denom: near, how: 'paper-converted', snippet: f.snippet, candidates };
    }
  }
  const pickMost = (list) => {
    const cnt = new Map(); list.forEach(f => cnt.set(f.denom, (cnt.get(f.denom) || 0) + 1));
    const best = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    return list.find(f => f.denom === best);
  };
  const key = found.filter(f => f.how === 'keyword');
  if (key.length) { const f = pickMost(key); return { denom: f.denom, how: 'keyword', snippet: f.snippet, candidates }; }
  if (byPaper.length && !paper) { const f = byPaper[0]; return { denom: f.denom, how: 'paper', snippet: f.snippet, candidates }; }
  const bare = found.filter(f => f.how === 'bare' && f.denom >= 100);
  if (bare.length) { const f = pickMost(bare); return { denom: f.denom, how: 'bare', snippet: f.snippet, candidates }; }
  return null;
}
