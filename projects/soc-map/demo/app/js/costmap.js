/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v12 — KOSHA 기반 장비별 동적 위험도(Cost Map) 엔진
 *
 *  근거 지침: KOSHA C-105-2022 (굴착기/토공장비), KOSHA C-48-2022 (양중기·항타기·펌프카)
 *  법정 기준 (산업안전보건기준에 관한 규칙, 근거 정리: 오르카/건설현장안전관제 위키)
 *   - 제37조②  순간풍속 10m/s 초과 타워크레인 설치·수리·점검·해체 중지, 15m/s 초과 운전작업 중지
 *   - 제200조   운전 중인 차량계 건설기계 접촉 위험 장소 출입 금지 (유도자 배치 시 예외 → 신호수 완화)
 *   - 제322조   충전전로 인근 차량·기계장치는 충전부로부터 3m 이상 이격 (50kV 초과 시 10kV당 +10cm)
 *   - 제221조의2 굴착기 후사경·후방영상표시장치 설치 의무
 *
 *  위험도 R(x,y) 우선순위 공식 (장비 1대 기준, 0~100 clamp)
 *   0순위  전면 통제(Fast-fail)   : 장비 영향 반경 내부 = 100
 *   1순위  Red Zone (절대 타격)    : 100 (가중치 미적용)
 *   2순위  Orange Zone (경고)      : (E_orange + S_penalty) × W_freq − H_mitigation
 *   3순위  영향 반경 내 일반 구역  : S_penalty × W_freq − H_mitigation
 *   영향 반경 밖                   : 0
 *
 *  v12 변경점: 전면 통제·S_penalty 판정을 "평가 지점"이 아니라 "장비 위치" 기준으로 계산하고,
 *  결과를 장비 영향 반경 안으로 한정한다. (v11에서는 풍속 10m/s 이상 + 크레인 1대만 있어도
 *  지도 전체가 100점이 되어 경로 탐색이 무력화되는 문제가 있었음)
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

// ── 기하 유틸 ──
function deg2rad(deg) { return deg * Math.PI / 180; }
function rad2deg(rad) { return rad * 180 / Math.PI; }
function normalizeAngle(rad) { let a = rad % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a; }
function angleDifference(a, b) {
  let d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return d > Math.PI ? 2 * Math.PI - d : d;
}
function clampRisk(v) { return Math.max(0, Math.min(100, v)); }

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 점에서 다각형까지 거리 (내부면 0) */
function distanceToPolygon(px, py, poly) {
  if (isPointInPolygon(px, py, poly)) return 0;
  let d = Infinity;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) d = Math.min(d, pointToSegmentDistance(px, py, poly[j], poly[j + 1], poly[i], poly[i + 1]));
  return d;
}

/** 평탄화된 다각형 [x0,y0,x1,y1,...] 내부 판정 */
function isPointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function polygonBBox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i], y = poly[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** 넓이 가중 무게중심 (오목 다각형에서도 정확) */
function polygonCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const f = poly[j] * poly[i + 1] - poly[i] * poly[j + 1];
    a += f; cx += (poly[j] + poly[i]) * f; cy += (poly[j + 1] + poly[i + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i += 2) { sx += poly[i]; sy += poly[i + 1]; }
    return { x: sx / (n / 2), y: sy / (n / 2) };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** OpenCV 형식 외곽선 [[[x,y]],...] 또는 [[x,y],...] → 평탄화 배열 */
function flattenContour(c) {
  const out = [];
  for (const pt of c) {
    if (Array.isArray(pt[0])) out.push(+pt[0][0], +pt[0][1]);
    else out.push(+pt[0], +pt[1]);
  }
  return out;
}

// ── 환경 구역 ──
const ENV_ZONE_TYPES = {
  softGround:  { label: '연약지반',        icon: '🍮', color: '#eab308', pedestrian: 20 },
  steepSlope:  { label: '경사도 30% 이상', icon: '📐', color: '#f97316', pedestrian: 30 },
  powerLine:   { label: '고압선 (전선 아래)', icon: '⚡', color: '#a855f7', pedestrian: 50 },   // 장비 판정은 제322조 이격거리 + 장비 도달거리
  floodedArea: { label: '침수 지역',       icon: '💧', color: '#3b82f6', pedestrian: 100 },
};

/** 좌표가 속한 환경 구역 종류 집합 */
function envZoneFlagsAt(env, x, y) {
  const flags = {};
  for (const z of (env.envZones || [])) {
    if (!z.polygon || z.polygon.length < 6) continue;
    const bb = z._bbox || (z._bbox = polygonBBox(z.polygon));
    if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
    if (isPointInPolygon(x, y, z.polygon)) flags[z.type] = true;
  }
  return flags;
}

/**
 * 충전전로 이격거리(m) — 안전보건규칙 제322조: 충전부로부터 3 m, 대지전압 50 kV 초과 시 10 kV 마다 10 cm 가산.
 * 10 kV 미만 나머지도 한 구간으로 올려 계산한다(보수적). 전압을 모르면 한전 배전선로 표준 22.9 kV 로 본다.
 */
const DEFAULT_POWERLINE_KV = 22.9;
function powerLineClearance(kV) {
  const v = +kV > 0 ? +kV : DEFAULT_POWERLINE_KV;
  return 3 + Math.max(0, Math.ceil((v - 50) / 10 - 1e-9)) * 0.1;
}
const POWERLINE_EQUIPMENT = ['excavator', 'mobileCrane', 'concretePumpCar'];   // 제322조 "차량등"

/** S_penalty: 장비가 놓인 지반 조건에 따른 가산점 */
function computeSPenalty(flags, eqType) {
  let p = 0;
  if (flags.softGround) {
    if (eqType === 'excavator' || eqType === 'mobileCrane') p += 30;
    if (eqType === 'pileDriver') p += 50;
  }
  if (flags.steepSlope && eqType === 'excavator') p += 20;
  return p;
}

/**
 * 장비별 작업 중지 순간풍속(m/s, "초과" 시 중지).
 *  - towerCrane : 안전보건규칙 제37조② 운전작업 중지 15m/s (법정 상한 — 더 높게 설정할 수 없음)
 *  - mobileCrane·pileDriver : 법정 수치 기준 없음(제37조① 일반 의무). 제조사 사양서의 허용 풍속으로
 *    현장에서 조정하도록 하고, 기본값은 보수적으로 10m/s (제37조② 설치·해체 기준과 동일)
 */
const WIND_LIMITS = { towerCrane: 15, mobileCrane: 10, pileDriver: 10 };
const TOWER_ERECTION_WIND = 10;   // 타워크레인 설치·수리·점검·해체 중지 (제37조②)
const fmtDec1 = (v) => (Math.round(v * 10) / 10).toString();

/** H_mitigation: 통제 완화 조치에 따른 차감점 */
const MITIGATIONS = {
  signalman:      { label: '신호수 배치',          icon: '👷', value: 30, appliesTo: ['excavator', 'mobileCrane', 'towerCrane', 'concretePumpCar'] },
  rearCamera:     { label: '후방영상표시장치',     icon: '📷', value: 20, appliesTo: ['excavator'], required: '안전보건규칙 제221조의2 — 굴착기 필수 장치' },
  outriggerFixed: { label: '아웃트리거/쐐기 고정', icon: '🔧', value: 50, appliesTo: ['pileDriver'] },
};
function computeHMitigation(mit, eqType) {
  let v = 0;
  for (const [k, info] of Object.entries(MITIGATIONS)) {
    if (mit && mit[k] && info.appliesTo.includes(eqType)) v += info.value;
  }
  return v;
}

// ═══════════════════════════════════════════════
//  Equipment 클래스 계층
// ═══════════════════════════════════════════════

class Equipment {
  constructor(marker, env, wFreq, type) {
    this.marker = marker;
    this.xc = marker.x; this.yc = marker.y;
    this.heading = marker.heading || 0;
    this.params = marker.equipmentParams || {};
    this.mitigation = marker.mitigation || {};
    this.env = env || {};
    this.equipmentType = type;
    // 사고 빈도 가중치 — 설계값 (2026-10-05 결정). 통계로 산출한 값이 아니다.
    //  사망자 수 순위(고용노동부 2019~2021: 굴착기 63 > 이동식크레인 33)와는 맞지만,
    //  등록대수로 나눈 대당 위험률은 이동식크레인이 약 7.9배 높고, 나머지 기종은 통계가 없다.
    this.w_freq = wFreq;
    this.orangeBase = 70;
    // 장비 위치 기준 환경 판정은 생성 시 1회만 계산 (경로 탐색 시 수십만 번 호출되므로)
    this.flags = envZoneFlagsAt(this.env, this.xc, this.yc);
    this.sPenalty = computeSPenalty(this.flags, type);
    this.hMitigation = computeHMitigation(this.mitigation, type);
  }

  /** 전면 통제 사유 (없으면 null) */
  fullControlReason() {
    const t = this.equipmentType, lim = this.windLimit();
    if (lim != null && (this.env.windSpeed || 0) > lim) {
      if (t === 'towerCrane') return `순간풍속 ${lim}m/s 초과 — 타워크레인 ${this.marker.erecting ? '설치·해체·점검' : '운전'} 중지 (안전보건규칙 제37조)`;
      return `순간풍속 ${lim}m/s 초과 — ${t === 'pileDriver' ? '항타' : '양중'} 작업 중지 (장비 허용 풍속)`;
    }
    if (this.flags.floodedArea) return '침수 지역 내 장비 — 전면 통제';
    const pl = this.powerLineConflict();
    if (pl) return `고압선(${pl.kV}kV) 이격 ${fmtDec1(pl.clearance)}m 미확보 — 장비 도달 ${fmtDec1(pl.reach)}m, 전선까지 ${fmtDec1(pl.dist)}m (안전보건규칙 제322조)`;
    return null;
  }
  /** 붐·암 등이 닿을 수 있는 수평 거리(m) — 360° 선회를 가정 */
  reach() { return 0; }
  /** 장비 도달 범위가 고압선 이격거리 안으로 들어가면 그 정보를, 아니면 null */
  powerLineConflict() {
    if (!POWERLINE_EQUIPMENT.includes(this.equipmentType)) return null;
    let worst = null;
    for (const z of this.env.envZones || []) {
      if (z.type !== 'powerLine' || !z.polygon || z.polygon.length < 6) continue;
      const kV = +z.kV > 0 ? +z.kV : DEFAULT_POWERLINE_KV, clearance = powerLineClearance(kV);
      const dist = distanceToPolygon(this.xc, this.yc, z.polygon), reach = this.reach();
      const margin = dist - reach - clearance;
      if (margin <= 0 && (!worst || margin < worst.margin)) worst = { kV, clearance, dist, reach, margin };
    }
    return worst;
  }
  /** 작업 중지 순간풍속 (해당 없으면 null). 타워크레인은 법정 15m/s 를 넘길 수 없다. */
  windLimit() {
    const def = WIND_LIMITS[this.equipmentType];
    if (def == null) return null;
    const v = +this.params.v_wind;
    if (this.equipmentType !== 'towerCrane') return v > 0 ? v : def;
    const legal = this.marker.erecting ? TOWER_ERECTION_WIND : def;   // 제37조②: 설치·수리·점검·해체 10, 운전 15
    return v > 0 ? Math.min(v, legal) : legal;
  }
  isFullControl() {
    if (this._fc === undefined) this._fc = this.fullControlReason();
    return !!this._fc;
  }

  computeScoreRed() { return 0; }
  computeScoreOrange() { return 0; }
  getMaxRadius() { return 100; }
  getZoneShapes() { return []; }

  orangeRisk() { return clampRisk((this.orangeBase + this.sPenalty) * this.w_freq - this.hMitigation); }
  normalRisk() { return this.sPenalty > 0 ? clampRisk(this.sPenalty * this.w_freq - this.hMitigation) : 0; }

  calculate_risk(x, y) {
    const d = Math.hypot(x - this.xc, y - this.yc);
    if (d > this.getMaxRadius()) return 0;
    if (this.isFullControl()) return 100;
    if (this.computeScoreRed(x, y, d) > 0) return 100;
    if (this.computeScoreOrange(x, y, d) > 0) return this.orangeRisk();
    return this.normalRisk();
  }

  /** 시각화/디버깅용: 지점이 어느 구역인지 */
  zoneAt(x, y) {
    const d = Math.hypot(x - this.xc, y - this.yc);
    if (d > this.getMaxRadius()) return 'none';
    if (this.isFullControl()) return 'full';
    if (this.computeScoreRed(x, y, d) > 0) return 'red';
    if (this.computeScoreOrange(x, y, d) > 0) return 'orange';
    return 'normal';
  }
}

// ── 굴착기 ── W_freq 1.3
class Excavator extends Equipment {
  constructor(m, e) {
    super(m, e, 1.3, 'excavator');
    this.rMax = this.params.r_max ?? 8;
    this.rBlind = this.params.r_blind ?? 5;
    this.thetaBlind = deg2rad(this.params.theta_blind ?? 120);
    this.rearDir = normalizeAngle(this.heading + Math.PI);
  }
  computeScoreRed(x, y, d) { return d <= this.rMax ? 100 : 0; }
  computeScoreOrange(x, y, d) {
    if (d > this.rBlind) return 0;
    return angleDifference(Math.atan2(y - this.yc, x - this.xc), this.rearDir) <= this.thetaBlind / 2 ? this.orangeBase : 0;
  }
  getMaxRadius() { return Math.max(this.rMax, this.rBlind); }
  reach() { return this.rMax; }
  getZoneShapes() {
    return [
      { type: 'circle', zone: 'red', cx: this.xc, cy: this.yc, radius: this.rMax },
      { type: 'arc', zone: 'orange', cx: this.xc, cy: this.yc, radius: this.rBlind,
        startAngle: this.rearDir - this.thetaBlind / 2, endAngle: this.rearDir + this.thetaBlind / 2 },
    ];
  }
}

// ── 이동식 크레인 ── W_freq 1.1
class MobileCrane extends Equipment {
  constructor(m, e) {
    super(m, e, 1.1, 'mobileCrane');
    this.lBoom = this.params.L_boom ?? 25;
    this.rLoad = this.params.r_load ?? 3;
    this.rOutrigger = this.params.r_outrigger ?? 5;
    this.boomEnd = { x: this.xc + this.lBoom * Math.cos(this.heading), y: this.yc + this.lBoom * Math.sin(this.heading) };
  }
  computeScoreRed(x, y) { return pointToSegmentDistance(x, y, this.xc, this.yc, this.boomEnd.x, this.boomEnd.y) <= this.rLoad ? 100 : 0; }
  computeScoreOrange(x, y, d) { return d <= this.rOutrigger ? this.orangeBase : 0; }
  getMaxRadius() { return Math.max(this.lBoom + this.rLoad, this.rOutrigger); }
  reach() { return this.lBoom; }
  getZoneShapes() {
    return [
      { type: 'capsule', zone: 'red', x1: this.xc, y1: this.yc, x2: this.boomEnd.x, y2: this.boomEnd.y, radius: this.rLoad },
      { type: 'circle', zone: 'orange', cx: this.xc, cy: this.yc, radius: this.rOutrigger },
    ];
  }
}

// ── 타워 크레인 ── W_freq 0.7
class TowerCrane extends Equipment {
  constructor(m, e) {
    super(m, e, 0.7, 'towerCrane');
    this.rMast = this.params.r_mast ?? 1.5;
    this.lJib = this.params.L_jib ?? 50;
    this.dTrolley = Math.min(this.params.d_trolley ?? 30, this.lJib);
    this.rLoad = this.params.r_load ?? 3;
    this.rShadow = this.params.r_shadow ?? 2;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    this.load = { x: this.xc + this.dTrolley * c, y: this.yc + this.dTrolley * s };
    this.jibEnd = { x: this.xc + this.lJib * c, y: this.yc + this.lJib * s };
  }
  computeScoreRed(x, y, d) {
    if (d <= this.rMast) return 100;
    return Math.hypot(x - this.load.x, y - this.load.y) <= this.rLoad ? 100 : 0;
  }
  computeScoreOrange(x, y) { return pointToSegmentDistance(x, y, this.xc, this.yc, this.jibEnd.x, this.jibEnd.y) <= this.rShadow ? this.orangeBase : 0; }
  getMaxRadius() { return Math.max(this.lJib + this.rShadow, this.dTrolley + this.rLoad, this.rMast); }
  getZoneShapes() {
    return [
      { type: 'capsule', zone: 'orange', x1: this.xc, y1: this.yc, x2: this.jibEnd.x, y2: this.jibEnd.y, radius: this.rShadow },
      { type: 'circle', zone: 'red', cx: this.xc, cy: this.yc, radius: this.rMast },
      { type: 'circle', zone: 'red', cx: this.load.x, cy: this.load.y, radius: this.rLoad },
    ];
  }
}

// ── 항타기 ── W_freq 0.8
class PileDriver extends Equipment {
  constructor(m, e) {
    super(m, e, 0.8, 'pileDriver');
    this.orangeBase = 60;
    this.lMast = this.params.L_mast ?? 20;
    this.lBase = this.params.L_base ?? 4;
    this.rBuffer = this.params.r_buffer ?? 3;
    this.rFall = this.lMast + this.lBase + 2.0; // 전도 한계 반경
  }
  computeScoreRed(x, y, d) { return d <= this.rFall ? 100 : 0; }
  computeScoreOrange(x, y, d) { return d > this.rFall && d <= this.rFall + this.rBuffer ? this.orangeBase : 0; }
  getMaxRadius() { return this.rFall + this.rBuffer; }
  getZoneShapes() {
    return [
      { type: 'circle', zone: 'orange', cx: this.xc, cy: this.yc, radius: this.rFall + this.rBuffer },
      { type: 'circle', zone: 'red', cx: this.xc, cy: this.yc, radius: this.rFall },
    ];
  }
}

// ── 콘크리트 펌프카 ── W_freq 0.9
class ConcretePumpCar extends Equipment {
  constructor(m, e) {
    super(m, e, 0.9, 'concretePumpCar');
    this.rBoom = this.params.r_boom ?? 30;
    this.lCar = this.params.L_car ?? 12;
    this.wCar = this.params.W_car ?? 2.5;
    this.dSign = this.params.D_sign ?? 3;
    const d = this.lCar / 2 + this.dSign, c = Math.cos(this.heading), s = Math.sin(this.heading);
    this.front = { x: this.xc + d * c, y: this.yc + d * s };
    this.rear = { x: this.xc - d * c, y: this.yc - d * s };
  }
  computeScoreRed(x, y, d) { return d <= this.rBoom ? 100 : 0; }
  computeScoreOrange(x, y) { return pointToSegmentDistance(x, y, this.front.x, this.front.y, this.rear.x, this.rear.y) <= this.wCar / 2 ? this.orangeBase : 0; }
  getMaxRadius() { return Math.max(this.rBoom, this.lCar / 2 + this.dSign + this.wCar / 2); }
  reach() { return this.rBoom; }
  getZoneShapes() {
    return [
      { type: 'circle', zone: 'red', cx: this.xc, cy: this.yc, radius: this.rBoom },
      { type: 'capsule', zone: 'orange', x1: this.front.x, y1: this.front.y, x2: this.rear.x, y2: this.rear.y, radius: this.wCar / 2 },
    ];
  }
}

const EQUIPMENT_TYPES = {
  excavator:       { label: '굴착기',        icon: '🚜', cls: Excavator,       color: '#f59e0b' },
  mobileCrane:     { label: '이동식 크레인', icon: '🏗️', cls: MobileCrane,     color: '#eab308' },
  towerCrane:      { label: '타워 크레인',   icon: '🗼', cls: TowerCrane,      color: '#fbbf24' },
  pileDriver:      { label: '항타기',        icon: '🔩', cls: PileDriver,      color: '#a3a3a3' },
  concretePumpCar: { label: '펌프카',        icon: '🚛', cls: ConcretePumpCar, color: '#60a5fa' },
};

/** 장비별 기본 제원 (m). 실제 장비 사양서에 맞게 현장에서 조정한다. */
const DEFAULT_EQUIPMENT_PARAMS = {
  excavator:       { r_max: 8, r_blind: 5, theta_blind: 120 },            // 0.6~1.0㎥급 굴착기 최대 작업반경
  mobileCrane:     { L_boom: 25, r_load: 3, r_outrigger: 5, v_wind: WIND_LIMITS.mobileCrane },
  towerCrane:      { r_mast: 1.5, L_jib: 50, d_trolley: 30, r_load: 3, r_shadow: 2, v_wind: WIND_LIMITS.towerCrane },
  pileDriver:      { L_mast: 20, L_base: 4, r_buffer: 3, v_wind: WIND_LIMITS.pileDriver }, // 전도 한계 = 마스트 + 지지대 + 2m
  concretePumpCar: { r_boom: 30, L_car: 12, W_car: 2.5, D_sign: 3 },
};

const PARAM_LABELS = {
  r_max: { label: '최대 작업반경', unit: 'm', min: 2, max: 30, step: 0.5 },
  r_blind: { label: '후방 사각지대 거리', unit: 'm', min: 1, max: 20, step: 0.5 },
  theta_blind: { label: '사각지대 각도', unit: '°', min: 30, max: 270, step: 5 },
  L_boom: { label: '붐 수평 길이', unit: 'm', min: 5, max: 80, step: 0.5 },
  r_load: { label: '인양물 반경', unit: 'm', min: 0.5, max: 10, step: 0.5 },
  r_outrigger: { label: '아웃트리거 반경', unit: 'm', min: 2, max: 15, step: 0.5 },
  r_mast: { label: '마스트 반경', unit: 'm', min: 0.5, max: 5, step: 0.1 },
  L_jib: { label: '지브 길이', unit: 'm', min: 10, max: 90, step: 1 },
  d_trolley: { label: '트롤리 위치', unit: 'm', min: 2, max: 90, step: 0.5 },
  r_shadow: { label: '지브 하부 낙하 반경', unit: 'm', min: 0.5, max: 6, step: 0.5 },
  L_mast: { label: '리더(마스트) 길이', unit: 'm', min: 5, max: 40, step: 0.5 },
  L_base: { label: '지지대 폭', unit: 'm', min: 1, max: 10, step: 0.5 },
  r_buffer: { label: '조립 여유 반경', unit: 'm', min: 0.5, max: 10, step: 0.5 },
  r_boom: { label: '붐 최대 반경', unit: 'm', min: 10, max: 65, step: 1 },
  L_car: { label: '차체 길이', unit: 'm', min: 5, max: 18, step: 0.5 },
  W_car: { label: '차체 폭', unit: 'm', min: 1.5, max: 4, step: 0.1 },
  D_sign: { label: '전후방 표지 여유', unit: 'm', min: 1, max: 10, step: 0.5 },
  v_wind: { label: '작업 중지 순간풍속', unit: 'm/s', min: 5, max: 20, step: 1 },
};

/** 구역 도형 → 경로 (2D 렌더·3D 뷰어·작업자 앱에서 공통 사용) */
function zoneShapePolygon(sh, seg = 40) {
  const pts = [];
  const arc = (cx, cy, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } };
  if (sh.type === 'circle') arc(sh.cx, sh.cy, sh.radius, 0, Math.PI * 2, seg);
  else if (sh.type === 'arc') { pts.push(sh.cx, sh.cy); arc(sh.cx, sh.cy, sh.radius, sh.startAngle, sh.endAngle, seg); }
  else if (sh.type === 'capsule') {
    const a = Math.atan2(sh.y2 - sh.y1, sh.x2 - sh.x1);
    arc(sh.x2, sh.y2, sh.radius, a - Math.PI / 2, a + Math.PI / 2, seg / 2);
    arc(sh.x1, sh.y1, sh.radius, a + Math.PI / 2, a + Math.PI * 1.5, seg / 2);
  }
  return pts;
}

function createEquipment(marker, env) {
  const t = EQUIPMENT_TYPES[marker.type];
  return t ? new t.cls(marker, env) : null;
}

// ═══════════════════════════════════════════════
//  RiskField — 현장 전체의 통합 위험도 R(x,y)
//  여러 위험원이 겹치면 max 를 취한다.
// ═══════════════════════════════════════════════

class RiskField {
  constructor(markers, env) {
    this.env = env || { windSpeed: 0, envZones: [] };
    this.equipments = [];
    this.simple = [];
    for (const m of markers || []) {
      if (m.isEquipment) {
        const eq = createEquipment(m, this.env);
        if (eq) { eq._r = eq.getMaxRadius(); this.equipments.push(eq); }
      } else {
        this.simple.push(m);
      }
    }
    this.zones = (this.env.envZones || []).filter(z => z.polygon && z.polygon.length >= 6)
      .map(z => ({ z, bb: polygonBBox(z.polygon), pen: (ENV_ZONE_TYPES[z.type] || {}).pedestrian || 0 }));
  }

  /** 0~100 위험도 */
  at(x, y) {
    let r = 0;
    for (const eq of this.equipments) {
      if (Math.abs(x - eq.xc) > eq._r || Math.abs(y - eq.yc) > eq._r) continue;
      const v = eq.calculate_risk(x, y);
      if (v > r) { r = v; if (r >= 100) return 100; }
    }
    for (const m of this.simple) {
      if (Math.hypot(x - m.x, y - m.y) <= m.radius) r = Math.max(r, (m.riskLevel || 3) * 20);
    }
    for (const { z, bb, pen } of this.zones) {
      if (pen <= r) continue;
      if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
      if (isPointInPolygon(x, y, z.polygon)) r = pen;
    }
    return clampRisk(r);
  }

  /** 지점 위험도의 원인 목록 (호버 툴팁용) */
  explain(x, y) {
    const out = [];
    for (const eq of this.equipments) {
      const v = eq.calculate_risk(x, y);
      if (v > 0) out.push({ risk: v, text: `${eq.marker.label} · ${({ full: '전면 통제', red: 'Red', orange: 'Orange', normal: '영향권' })[eq.zoneAt(x, y)]}` });
    }
    for (const m of this.simple) {
      if (Math.hypot(x - m.x, y - m.y) <= m.radius) out.push({ risk: (m.riskLevel || 3) * 20, text: `${m.label} · 등급 ${m.riskLevel || 3}` });
    }
    for (const { z, pen } of this.zones) {
      if (isPointInPolygon(x, y, z.polygon)) out.push({ risk: pen, text: `${ENV_ZONE_TYPES[z.type].label} (보행)` });
    }
    return out.sort((a, b) => b.risk - a.risk);
  }
}

function riskGrade(r) {
  if (r >= 70) return { label: '위험', color: '#ef4444' };
  if (r >= 30) return { label: '주의', color: '#f59e0b' };
  if (r > 0) return { label: '경미', color: '#eab308' };
  return { label: '안전', color: '#10b981' };
}

/** 위험도 0~100 → 히트맵 RGBA */
function riskColor(r) {
  if (r <= 0) return [0, 0, 0, 0];
  const t = r / 100;
  // 노랑(낮음) → 주황 → 빨강(높음)
  const g = Math.round(220 * (1 - t));
  return [239 + Math.round(16 * (1 - t)), g, 40, Math.round(60 + 120 * t)];
}
