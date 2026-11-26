/**
 * 自动框选 Worker（2.0）
 * 几何路线参考 SUSTechPOINTS 的 auto-annotate / obj_cfg.guess_obj_type_by_dimension：
 *   1. z 分位估计地平面，剔除地面点与过高噪点（阈值全部来自 DetectionTuning）
 *   2. 体素网格下采样 + 网格加速 DBSCAN
 *   3. 每簇 PCA 主方向 + 三候选朝向取最小投影面积 → tight OBB（yaw 自动得到）
 *   4. 按 ClassProfile 的长宽高/区间/长宽比/点数做近似类别判定，映射平台 typeId
 *   5. 综合置信度（权重可配），输出「待人工审批」候选
 * 输出不是最终答案；主线程只负责写答案与审批流。
 */
import { DEFAULT_DETECTION } from '../../shared/constants';
import { matchClassProfile } from '../../shared/classify';
import type { CandidateBox, ClassProfile, DetectRequest, DetectResult, DetectionTuning, Vec3 } from '../../shared/types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const toHalfPi = (a: number) => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  while (x > Math.PI / 2) x -= Math.PI;
  while (x < -Math.PI / 2) x += Math.PI;
  return x;
};

function quantile(sorted: Float64Array, p: number): number {
  if (!sorted.length) return 0;
  const i = clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[i];
}
function sortedCopy(src: Float64Array): Float64Array {
  const a = Float64Array.from(src);
  a.sort((x, y) => x - y);
  return a;
}
function fail(req: DetectRequest, error: string, started: number, totalPoints = 0): DetectResult {
  return {
    ok: false,
    error, candidates: [],
    totalPoints,
    groundZ: 0,
    elapsed: performance.now() - started
  };
}

/** 均匀抽稀 + 体素下采样，返回紧凑 xyz 与每点所属网格键 */
function voxelize(raw: Float32Array, maxPoints: number, voxel: number) {
  let src = raw;
  const n0 = Math.floor(src.length / 3);
  if (n0 > maxPoints) {
    const stride = Math.ceil(n0 / maxPoints);
    const keepN = Math.ceil(n0 / stride);
    const thin = new Float32Array(keepN * 3);
    for (let k = 0, i = 0; k < n0; k += stride, i++) {
      thin[i * 3] = src[k * 3];
      thin[i * 3 + 1] = src[k * 3 + 1];
      thin[i * 3 + 2] = src[k * 3 + 2];
    }
    src = thin;
  }
  const buckets = new Map<string, { x: number; y: number; z: number; n: number }>();
  const n = Math.floor(src.length / 3);
  for (let i = 0; i < n; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    if (![x, y, z].every(Number.isFinite) || Math.abs(x) > 200 || Math.abs(y) > 200 || Math.abs(z) > 60) continue;
    const key = `${Math.floor(x / voxel)},${Math.floor(y / voxel)},${Math.floor(z / voxel)}`;
    const b = buckets.get(key);
    if (b) {
      b.x += x;
      b.y += y;
      b.z += z;
      b.n += 1;
    }
    else buckets.set(key, {
      x,
      y,
      z,
      n: 1
    });
  }
  const coords = new Float32Array(buckets.size * 3);
  let k = 0;
  for (const b of buckets.values()) {
    coords[k * 3] = b.x / b.n; coords[k * 3 + 1] = b.y / b.n; coords[k * 3 + 2] = b.z / b.n;
    k++;
  }
  return coords;
}

/** 网格加速 DBSCAN：邻域半径 = voxel * 2，用 5×5×5 桶查询 */
function cluster(coords: Float32Array, voxel: number, minPoints: number, maxClusters: number): number[][] {
  const n = Math.floor(coords.length / 3);
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) => `${Math.floor(x / voxel)},${Math.floor(y / voxel)},${Math.floor(z / voxel)}`;
  for (let i = 0; i < n; i++) {
    const key = keyOf(coords[i * 3], coords[i * 3 + 1], coords[i * 3 + 2]);
    const arr = grid.get(key);
    if (arr) arr.push(i);
    else grid.set(key, [i]);
  }
  const eps2 = (voxel * 2) * (voxel * 2);
  const neighborCache = new Map<number, number[]>();
  const neighbors = (i: number): number[] => {
    const hit = neighborCache.get(i);
    if (hit) return hit;
    if (neighborCache.size > 30000) neighborCache.clear();
    const x = coords[i * 3], y = coords[i * 3 + 1], z = coords[i * 3 + 2];
    const gx = Math.floor(x / voxel), gy = Math.floor(y / voxel), gz = Math.floor(z / voxel);
    const out: number[] = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
      const arr = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
      if (!arr) continue;
      for (const j of arr) {
        const ddx = coords[j * 3] - x, ddy = coords[j * 3 + 1] - y, ddz = coords[j * 3 + 2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz * 0.45 <= eps2) out.push(j);
      }
    }
    neighborCache.set(i, out);
    return out;
  };
  const labels = new Int32Array(n).fill(-1);
  const minCore = Math.max(3, Math.floor(minPoints / 4));
  const clusters: number[][] = [];
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0 || labels[i] === -2) continue;
    const nb = neighbors(i);
    if (nb.length < minCore) { labels[i] = -2; continue; }
    const queue = [i];
    const seen = new Set<number>([i]);
    labels[i] = cid;
    while (queue.length) {
      const p = queue.pop()!;
      for (const q of neighbors(p)) {
        if (seen.has(q)) continue;
        seen.add(q);
        if (labels[q] === -2) labels[q] = cid;
        else if (labels[q] === -1) {
          labels[q] = cid; queue.push(q);
        }
      }
    }
    if (seen.size >= minPoints)
      clusters.push(Array.from(seen));
    cid++;
  }
  clusters.sort((a, b) => b.length - a.length);
  return clusters.slice(0, maxClusters);
}

/** 簇 → tight OBB：PCA 主方向 + 原方向 + 正交方向，取投影面积最小者（自动旋转角度） */
function obbOf(coords: Float32Array, idx: number[], p: number, t: DetectionTuning) {
  const n = idx.length;
  let mx = 0, my = 0;
  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    xs[k] = coords[i * 3];
    ys[k] = coords[i * 3 + 1];
    zs[k] = coords[i * 3 + 2];
    mx += xs[k]; my += ys[k];
  }
  mx /= n; my /= n;
  let cxx = 0, cxy = 0, cyy = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - mx, dy = ys[k] - my;
    cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
  }
  cxx /= n; cxy /= n; cyy /= n;
  const pca = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const candidates = Array.from(new Set([
    0,
    toHalfPi(pca),
    toHalfPi(pca + Math.PI / 2)
  ].map((a) => +a.toFixed(4))));
  const sz = sortedCopy(zs);
  const z0 = quantile(sz, p), z1 = quantile(sz, 1 - p);
  const spanZ = z1 - z0, mz = (z0 + z1) / 2;

  let best: {
    delta: number;
    spanU: number;
    spanV: number;
    mu: number;
    mv: number;
    area: number
  } | null = null;
  const us = new Float64Array(n), vs = new Float64Array(n);
  for (const delta of candidates) {
    const dc = Math.cos(delta), ds = Math.sin(delta);
    for (let k = 0; k < n; k++) {
      us[k] = dc * xs[k] + ds * ys[k];
      vs[k] = -ds * xs[k] + dc * ys[k];
    }
    const su = sortedCopy(us), sv = sortedCopy(vs);
    const u0 = quantile(su, p), u1 = quantile(su, 1 - p), v0 = quantile(sv, p), v1 = quantile(sv, 1 - p);
    const spanU = u1 - u0, spanV = v1 - v0;
    if (spanU < t.minSpan || spanV < t.minSpan) continue;
    // 长轴不在 U 上时给极小惩罚，保证 size[0] 是平台约定的 length
    const area = spanU * spanV * (spanU >= spanV ? 1 : 1.0001);
    if (!best || area < best.area) best = {
      delta,
      spanU,
      spanV,
      mu: (u0 + u1) / 2,
      mv: (v0 + v1) / 2,
      area
    };
  }
  if (!best) return null;
  const dc = Math.cos(best.delta), ds = Math.sin(best.delta);
  const center: Vec3 = [
    dc * best.mu - ds * best.mv,
    ds * best.mu + dc * best.mv,
    mz
  ];
  const size: Vec3 = [
    best.spanU,
    best.spanV,
    Math.max(0.2, spanZ)
  ];
  return {
    center,
    size,
    yaw: best.delta,
    count: n
  };
}

function solve(req: DetectRequest): DetectResult {
  const started = performance.now();
  const t: DetectionTuning = {
    ...DEFAULT_DETECTION, ...(req.tuning || {}),
    scoreWeights: {
      ...DEFAULT_DETECTION.scoreWeights,
      ...(req.tuning?.scoreWeights || {})
    }
  };
  const raw = req.points instanceof Float32Array ? req.points : new Float32Array(req.points);
  const total = Math.floor(raw.length / 3);
  if (total < 30)
    return fail(req, '帧点云为空', started, total);

  // 1) 地平面估计 + 高度裁剪
  const zAll = new Float64Array(total);
  for (let i = 0; i < total; i++) zAll[i] = raw[i * 3 + 2];
  const groundZ = quantile(sortedCopy(zAll), clamp(req.groundPercentile, 0.01, 0.3));
  const kept = new Float32Array(total * 3);
  let m = 0;
  for (let i = 0; i < total; i++) {
    const z = raw[i * 3 + 2];
    if (z < groundZ + t.groundGap || z > groundZ + t.maxHeight) continue;
    kept[m * 3] = raw[i * 3]; kept[m * 3 + 1] = raw[i * 3 + 1]; kept[m * 3 + 2] = z;
    m++;
  }
  if (m < 30) return fail(req, '地面过滤后无有效点', started, total);

  // 2) 体素下采样
  const coords = voxelize(kept.subarray(0, m * 3), req.maxPoints, req.voxel);
  if (coords.length / 3 < 10) return fail(req, '体素化后点数不足', started, total);

  // 3) 网格 DBSCAN
  const clusters = cluster(coords, req.voxel, req.minPoints, req.maxClusters);
  const p = clamp(req.outlierPercentile, 0, 0.2);
  const profiles: ClassProfile[] = Array.isArray(req.profiles) ? req.profiles : [];
  const candidates: CandidateBox[] = [];
  const w = t.scoreWeights;
  const wSum = Math.max(1e-6, w.points + w.density + w.prior + w.ratio);

  // 4) 每簇 tight OBB + 类别尺寸近似判定 + 置信度
  for (const idx of clusters) {
    const obb = obbOf(coords, idx, p, t);
    if (!obb) continue;
    const [l, wd, h] = obb.size;
    if (l < t.minBoxLength || wd < t.minBoxWidth || h < t.minBoxHeight) continue;
    if (l > t.maxLength || wd > t.maxWidth || h > t.maxHeightBox) continue;
    const density = obb.count / Math.max(1e-6, l * wd * h);
    const pointScore = clamp(obb.count / Math.max(1, t.pointNorm), 0, 1);
    const densityScore = clamp(density / Math.max(1e-6, t.densityNorm), 0, 1);
    const match = matchClassProfile(obb.size, obb.count, profiles, t, req.platformTypes || [], req.autoMapPlatformTypes);
    const priorScore = profiles.length ? match.score : t.unknownPriorScore;
    const ratio = Math.max(l, wd) / Math.max(0.1, Math.min(l, wd));
    const ratioScore = ratio >= t.ratioRange[0] && ratio <= t.ratioRange[1] ? 1 : 0.4;
    const confidence = clamp(
      (w.points * pointScore + w.density * densityScore + w.prior * priorScore + w.ratio * ratioScore) / wSum, 0, 1);
    if (confidence < req.confidenceMin) continue;
    if (!req.allowUnknownClass && !match.profile) continue;
    if (match.profile?.minConfidence && confidence < match.profile.minConfidence) continue;

    // 阈值越大越保守：只做轻微膨胀，保持自动框略松一点便于人工微调
    const inflate = 1 + clamp(req.fitThreshold, 0, 1) * t.inflateMax;
    const size: Vec3 = [l * inflate, wd * inflate, h * inflate];
    candidates.push({
      id: `${req.idPrefix}_${candidates.length}`,
      typeId: match.typeId,
      center: obb.center,
      size,
      yaw: obb.yaw,
      confidence,
      pointCount: obb.count,
      reason: `${match.name || '通用目标'} · ${obb.count} 点 · 置信度 ${(confidence * 100).toFixed(0)}%`,
    });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return {
    ok: true,
    candidates: candidates.slice(0, req.maxClusters),
    totalPoints: total,
    groundZ,
    elapsed: performance.now() - started,
  };
}

self.onmessage = (e: MessageEvent<{ seq: number; req: DetectRequest }>) => {
  const { seq, req } = e.data || ({} as any);
  if (!req) return;
  let result: DetectResult;
  try { result = solve(req); }
  catch (err: any) {
    result = fail(req, String(err?.message || err), performance.now());
  }
  (self as any).postMessage({ seq, result });
};
