/* ═══════════════════════════════════════════════════════════════
 *  SOC-MAP v12 — AI 건물 검출 옵션 · 다시 분석 · 학습 데이터 수집
 *
 *  학습 데이터: 앱에서 확인·수정한 건물 외곽선을 정답으로 삼아 YOLO 세그멘테이션 형식으로 저장한다.
 *   - AI 서버가 켜져 있으면 backend/dataset/ 에 바로 누적 (train/val 자동 분할)
 *   - 꺼져 있으면 같은 구조의 ZIP 파일로 내려받는다
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const AI_OPTS_KEY = 'socmap.v12.aiopts';
const AI_DEFAULTS = { imgsz: 1024, tiling: 'auto', tta: false, enhance: false };
const AiOpts = (() => {
  try { return { ...AI_DEFAULTS, ...JSON.parse(localStorage.getItem(AI_OPTS_KEY) || '{}') }; } catch (e) { return { ...AI_DEFAULTS }; }
})();

function syncAiOptsUI() {
  $('optImgsz').value = AiOpts.imgsz;
  $('optTiling').value = AiOpts.tiling;
  $('optTta').checked = AiOpts.tta;
  $('optEnhance').checked = AiOpts.enhance;
  const parts = [`${AiOpts.imgsz}px`, { auto: '타일 자동', on: '타일 항상', off: '타일 끔' }[AiOpts.tiling]];
  if (AiOpts.tta) parts.push('TTA');
  if (AiOpts.enhance) parts.push('보정');
  $('aiOptsSummary').textContent = parts.join(' · ');
}
function saveAiOpts() {
  try { localStorage.setItem(AI_OPTS_KEY, JSON.stringify(AiOpts)); } catch (e) { /* noop */ }
  syncAiOptsUI();
}
$('optImgsz').addEventListener('change', e => { AiOpts.imgsz = +e.target.value; saveAiOpts(); });
$('optTiling').addEventListener('change', e => { AiOpts.tiling = e.target.value; saveAiOpts(); });
$('optTta').addEventListener('change', e => { AiOpts.tta = e.target.checked; saveAiOpts(); });
$('optEnhance').addEventListener('change', e => { AiOpts.enhance = e.target.checked; saveAiOpts(); });
$('optReset').addEventListener('click', () => { Object.assign(AiOpts, AI_DEFAULTS); saveAiOpts(); });

const dataUrlToBlob = async (src) => (await fetch(src)).blob();
const extOfMime = (mime) => ({ 'image/png': 'png', 'image/webp': 'webp', 'image/bmp': 'bmp' }[mime] || 'jpg');

/**
 * AI 검출 실행.
 * @param {Blob} blob  도면 이미지 원본
 * @param {{reset?: boolean}} opts  reset: 새 도면 업로드(히스토리 초기화) / 아니면 다시 분석(Ctrl+Z로 되돌리기 가능)
 */
async function runDetection(blob, filename, { reset = false } = {}) {
  const big = S.bgImage && Math.max(S.bgImage.naturalWidth, S.bgImage.naturalHeight) > AiOpts.imgsz * 1.5;
  const slow = AiOpts.tta || AiOpts.tiling === 'on' || (AiOpts.tiling === 'auto' && big);
  setLoading(`AI가 건축물을 분석하는 중…${slow ? '\n(타일 분할/TTA 사용 — 수 초~수십 초 걸릴 수 있습니다)' : ''}`);
  const form = new FormData();
  form.append('file', blob, filename || 'plan.jpg');
  form.append('imageType', document.querySelector('input[name="imageType"]:checked').value);
  form.append('conf', $('confSlider').value);
  form.append('imgsz', AiOpts.imgsz);
  form.append('tiling', AiOpts.tiling);
  form.append('tta', AiOpts.tta);
  form.append('enhance', AiOpts.enhance);
  try {
    const res = await fetch(BACKEND_URL + '/api/detect_buildings', { method: 'POST', body: form, signal: AbortSignal.timeout(300000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    // AI 결과(도면 px) → 현장 좌표(m): 도면 정합 변환을 그대로 적용
    const T = planTransform() || makeTransform(defaultPlanTransform(S.plan.width, S.plan.height));
    S.contours = (data.contours || []).map(c => c.map(pt => { const q = Array.isArray(pt[0]) ? pt[0] : pt, w = T.apply({ x: +q[0], y: +q[1] }); return [[+w.x.toFixed(2), +w.y.toFixed(2)]]; }));
    S.nodes = (data.nodes || []).map(n => { const w = T.apply({ x: n.cx, y: n.cy }); return { ...n, cx: w.x, cy: w.y }; });
    S.buildingData = {}; S.selection = null;
    const m = data.meta || {};
    const detail = [`${fmt((data.inference_ms || 0) / 1000, 1)}초`, `${m.imgsz || '?'}px`];
    if (m.tiles) detail.push(`타일 ${m.tiles}개`);
    if (m.raw_detections > S.contours.length) detail.push(`중복 ${m.raw_detections - S.contours.length}개 병합`);
    if (S.contours.length) {
      toast(`건축물 ${S.contours.length}개를 인식했습니다. (${detail.join(' · ')})\n틀린 외곽선은 지우거나 「🏢 건물 그리기」로 고친 뒤 「🎯 학습용 저장」하면 재학습에 쓸 수 있습니다.`, 'success', { duration: 7000 });
    } else {
      toast(`건축물을 찾지 못했습니다. (${detail.join(' · ')})\n신뢰도 임계값을 낮추거나, 고급 설정에서 해상도를 올리거나 타일을 「항상」으로 두고 다시 분석해 보세요.`, 'warn', { duration: 8000 });
    }
  } catch (err) {
    console.warn('AI 분석 실패', err);
    toast(`AI 분석에 실패했습니다: ${err.name === 'TimeoutError' ? '시간 초과' : err.message}\n도면은 정상 표시되며 수동으로 작업할 수 있습니다.`, 'error');
  } finally {
    setLoading(null);
    if (reset) History.init();
    changed(); renderModeUI(); renderInspector(); updateEmptyState();
  }
}

async function reanalyze() {
  if (!S.bgImageSrc) { toast('먼저 배치도 이미지를 불러오세요.', 'warn'); return; }
  if (!S.backendOnline) await checkBackend();
  if (!S.backendOnline) { toast('AI 서버가 꺼져 있어 분석할 수 없습니다.', 'error'); return; }
  const named = Object.values(S.buildingData).some(b => b && (b.name || b.entranceBlocked || b.floors));
  if (named && !confirm('다시 분석하면 건물 이름·층수·현관 통제 설정이 초기화됩니다. 계속할까요?\n(Ctrl+Z로 이전 결과를 되돌릴 수 있습니다)')) return;
  History.flush();
  await runDetection(await dataUrlToBlob(S.bgImageSrc), S.bgFileName || 'plan.jpg');
}

// ═══════════════════════════════════════════════
//  학습 데이터 저장
// ═══════════════════════════════════════════════

/** 학습 라벨은 도면 이미지 기준이어야 하므로 현장 좌표(m) → 도면 px 로 되돌린다 */
function contoursInPlanPx() {
  const T = planTransform();
  return S.contours.map(c => flattenContour(c)).map(p => {
    const o = [];
    for (let i = 0; i < p.length; i += 2) { const q = T ? T.inverse({ x: p[i], y: p[i + 1] }) : { x: p[i], y: p[i + 1] }; o.push([+q.x.toFixed(1), +q.y.toFixed(1)]); }
    return o;
  });
}

function contoursToYoloText(contours, w, h) {
  return contours.map(c => {
    const p = c.flat();
    if (p.length < 6) return null;
    const v = [];
    for (let i = 0; i < p.length; i += 2) v.push(Math.min(1, Math.max(0, p[i] / w)).toFixed(6), Math.min(1, Math.max(0, p[i + 1] / h)).toFixed(6));
    return '0 ' + v.join(' ');
  }).filter(Boolean).join('\n');
}

async function refreshDatasetInfo() {
  if (!S.backendOnline) { $('datasetInfo').textContent = ''; return; }
  try {
    const st = await (await fetch(BACKEND_URL + '/api/dataset/stats', { signal: AbortSignal.timeout(3000) })).json();
    const total = st.train.images + st.val.images;
    $('datasetInfo').textContent = total
      ? `📚 모은 학습 데이터: 도면 ${total}장 (train ${st.train.images} · val ${st.val.images}) · 건물 ${st.train.buildings + st.val.buildings}개`
      : '';
  } catch (e) { $('datasetInfo').textContent = ''; }
}

async function saveTrainingSample() {
  if (!S.bgImageSrc) { toast('먼저 배치도 이미지를 불러오세요.', 'warn'); return; }
  if (!S.contours.length && !confirm('건물이 하나도 없는 도면으로 저장할까요?\n(건물이 없는 이미지도 오탐을 줄이는 학습 데이터가 됩니다)')) return;
  const blob = await dataUrlToBlob(S.bgImageSrc);
  const name = S.bgFileName || `plan.${extOfMime(blob.type)}`;

  if (!S.backendOnline) await checkBackend();
  if (S.backendOnline) {
    const form = new FormData();
    form.append('file', blob, name);
    form.append('contours', JSON.stringify(contoursInPlanPx()));
    try {
      const res = await fetch(BACKEND_URL + '/api/dataset/add', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || res.status);
      toast(`학습 데이터로 저장했습니다 (${data.split}, 건물 ${data.buildings}개).\n누적: train ${data.stats.train.images}장 · val ${data.stats.val.images}장 — backend/dataset 폴더`, 'success', { duration: 6000 });
      refreshDatasetInfo();
      return;
    } catch (e) {
      toast(`서버 저장 실패: ${e.message}\nZIP 파일로 대신 내려받습니다.`, 'warn');
    }
  }

  // 오프라인: 같은 폴더 구조의 ZIP 으로 내려받기
  const iw = S.plan.width, ih = S.plan.height;
  const stem = name.replace(/\.[^.]+$/, '').replace(/[^0-9A-Za-z가-힣_-]+/g, '_').slice(0, 40) || 'plan';
  const tag = Date.now().toString(36);
  const files = [
    { name: `images/train/${stem}_${tag}.${extOfMime(blob.type)}`, data: new Uint8Array(await blob.arrayBuffer()) },
    { name: `labels/train/${stem}_${tag}.txt`, data: new TextEncoder().encode(contoursToYoloText(contoursInPlanPx(), iw, ih) + '\n') },
    { name: 'data.yaml', data: new TextEncoder().encode('path: .\ntrain: images/train\nval: images/val\nnames:\n  0: building\n') },
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files));
  a.download = `socmap-dataset_${stem}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('AI 서버가 꺼져 있어 학습 데이터를 ZIP으로 내려받았습니다.\n압축을 풀어 backend/dataset 폴더에 합치세요. (일부는 images/val, labels/val 로 옮겨 검증용으로 쓰세요)', 'info', { duration: 8000 });
}

// ── 최소 ZIP 작성기 (무압축 STORE, 라이브러리 없이) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 파일명
    local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

$('reanalyzeBtn').addEventListener('click', reanalyze);
$('saveSampleBtn').addEventListener('click', saveTrainingSample);
$('aiAdvanced').addEventListener('toggle', refreshDatasetInfo);
syncAiOptsUI();
setTimeout(refreshDatasetInfo, 3000);
