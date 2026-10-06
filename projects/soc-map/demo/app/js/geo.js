/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v13 — 측지 · 좌표계 · GPS 처리 공통 모듈 (관리자 화면 · 현장 앱 공용)
 *
 *  좌표계: 프로젝트 원점(위경도)에 접하는 WGS84 국소 접평면(ENU), 단위 m
 *          x = 동쪽(+), y = 남쪽(+)  ← 화면처럼 아래가 +y (북쪽이 위)
 *  - LocalFrame       : 위경도 ↔ 국소 좌표 (ECEF 경유, 현장 규모에서 cm 이하 오차)
 *  - fitTransform     : 점 쌍으로 2D 닮음/아핀 변환 추정 (도면 픽셀 → 현장 m)
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
 * matrix [a, b, c, d, e, f] :  X = a·x + b·y + c,  Y = d·x + e·y + f
 */
function fitTransform(pairs) {
  const P = (pairs || []).filter(p => [p.src.x, p.src.y, p.dst.x, p.dst.y].every(isFinite));
  if (P.length < 2) return null;
  let m = null, method;
  if (P.length >= 3) {
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
    const ar = num_r / den, ai = num_i / den;
    m = [ar, -ai, dx - (ar * sx - ai * sy), ai, ar, dy - (ai * sx + ar * sy)];
    method = 'similarity';
  }
  return makeTransform(m, P, method);
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
