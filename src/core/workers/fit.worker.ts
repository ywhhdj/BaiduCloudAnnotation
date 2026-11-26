/**
 * 点云贴合 Worker（2.0）
 * 思路借鉴 SUSTechPOINTS「框内点 → 主方向 → tight OBB」与「旋转时自动贴合」：
 *   1. ROI 点变换到框局部坐标
 *   2. z / xy 分位数裁剪离群点
 *   3. 水平面 PCA 求主方向，与原朝向、原朝向+90° 一起作为候选，取投影面积最小者（自动旋转）
 *   4. 沿候选轴取分位边界得到贴合尺寸与中心，反变换回全局坐标
 *   5. 按 fitThreshold 做收缩插值；FitTuning 控制最小尺寸/最大膨胀/类别尺寸软钳制
 * 数据通过 Transferable ArrayBuffer 传入，主线程零拷贝。
 */
import { DEFAULT_FIT_TUNING } from '../../shared/constants';
import type { FitRequest, FitResult, FitTuning, Vec3 } from '../../shared/types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const normAngle = (a: number) => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};
const toHalfPi = (a: number) => {
  let x = normAngle(a);
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

function fail(req: FitRequest, error: string, started: number, pointCount = 0): FitResult {
  return {
    ...req, points: new Float32Array(0), ok: false, error, score: 0, pointCount,
    center: req.center, sizeOut: req.size, yawOut: req.yaw,
    elapsed: performance.now() - started,
  };
}

function solve(req: FitRequest): FitResult {
  const started = performance.now();
  const t: FitTuning = { ...DEFAULT_FIT_TUNING, ...(req.fitTuning || {}) };
  const raw = req.points instanceof Float32Array ? req.points : new Float32Array(req.points);
  let pts = raw;
  if (raw.length / 3 > req.maxPoints) {
    const stride = Math.ceil(raw.length / 3 / req.maxPoints);
    const keepN = Math.ceil(raw.length / 3 / stride);
    const thin = new Float32Array(keepN * 3);
    for (let k = 0, i = 0; k < raw.length / 3; k += stride, i++) {
      thin[i * 3] = raw[k * 3];
      thin[i * 3 + 1] = raw[k * 3 + 1];
      thin[i * 3 + 2] = raw[k * 3 + 2];
    }
    pts = thin;
  }
  const n = Math.floor(pts.length / 3);
  if (n < Math.max(4, t.minPoints)) return fail(req, '框内点数不足', started, n);

  const [cx, cy, cz] = req.center;
  const [l0, w0, h0] = req.size;
  const yaw0 = req.yaw;
  const cos = Math.cos(yaw0), sin = Math.sin(yaw0);
  const p = clamp(t.outlierPercentile ?? req.outlierPercentile, 0, 0.2);

  const lx = new Float64Array(n), ly = new Float64Array(n), lz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 3] - cx, dy = pts[i * 3 + 1] - cy;
    lx[i] = cos * dx + sin * dy;
    ly[i] = -sin * dx + cos * dy;
    lz[i] = pts[i * 3 + 2] - cz;
  }
  const zSorted = sortedCopy(lz);
  const zLo = quantile(zSorted, p), zHi = quantile(zSorted, 1 - p);

  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    if (lz[i] < zLo || lz[i] > zHi) continue;
    if (Math.abs(lx[i]) > l0 * 1.6 + 2 || Math.abs(ly[i]) > w0 * 1.6 + 2) continue;
    keep.push(i);
  }
  const idx = keep.length >= Math.max(4, t.minPoints) ? keep : Array.from({ length: n }, (_, i) => i);
  if (idx.length < Math.max(4, t.minPoints)) return fail(req, '有效点不足', started, idx.length);

  // 水平面 PCA（2x2 协方差解析解）
  let mx = 0, my = 0;
  for (const i of idx) { mx += lx[i]; my += ly[i]; }
  mx /= idx.length; my /= idx.length;
  let cxx = 0, cxy = 0, cyy = 0;
  for (const i of idx) {
    const dx = lx[i] - mx, dy = ly[i] - my;
    cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
  }
  cxx /= idx.length; cxy /= idx.length; cyy /= idx.length;
  const pca = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const candidates = Array.from(new Set([0, toHalfPi(pca), toHalfPi(pca + Math.PI / 2)].map((a) => Number(a.toFixed(4)))));

  let best: { delta: number; spanX: number; spanY: number; mx: number; my: number; area: number } | null = null;
  const xs = new Float64Array(idx.length), ys = new Float64Array(idx.length);
  for (const delta of candidates) {
    const dc = Math.cos(delta), ds = Math.sin(delta);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      xs[k] = dc * lx[i] + ds * ly[i];
      ys[k] = -ds * lx[i] + dc * ly[i];
    }
    const sx = sortedCopy(xs), sy = sortedCopy(ys);
    const x0 = quantile(sx, p), x1 = quantile(sx, 1 - p);
    const y0 = quantile(sy, p), y1 = quantile(sy, 1 - p);
    const spanX = x1 - x0, spanY = y1 - y0;
    if (spanX < 0.15 || spanY < 0.15) continue;
    const area = spanX * spanY;
    if (!best || area < best.area) best = { delta, spanX, spanY, mx: (x0 + x1) / 2, my: (y0 + y1) / 2, area };
  }
  if (!best) return fail(req, '候选朝向均无效', started, idx.length);

  const zs = new Float64Array(idx.length);
  for (let k = 0; k < idx.length; k++) zs[k] = lz[idx[k]];
  const sz = sortedCopy(zs);
  const z0 = quantile(sz, p), z1 = quantile(sz, 1 - p);
  const spanZ = Math.max(t.minSize, z1 - z0);
  const mz = (z0 + z1) / 2;

  // 候选系 -> 原 yaw 局部系 -> 全局系
  const dc = Math.cos(best.delta), ds = Math.sin(best.delta);
  const bx = dc * best.mx - ds * best.my;
  const by = ds * best.mx + dc * best.my;
  const gdx = cos * bx - sin * by;
  const gdy = sin * bx + cos * by;

  const fittedCenter: Vec3 = [cx + gdx, cy + gdy, cz + mz];
  let fittedSize: Vec3 = [best.spanX, best.spanY, spanZ];
  // 类别尺寸软钳制：避免把框撑爆或压得过小（只影响几何）
  if (t.useClassSizeClamp && Array.isArray(req.classSize) && req.classSize.length === 3) {
    const strength = clamp(t.clampStrength, 0, 1);
    fittedSize = [0, 1, 2].map((i) => {
      const prior = Math.max(t.minSize, Number(req.classSize![i]) || t.minSize);
      const bounded = clamp(fittedSize[i], prior * 0.6, prior * 1.4);
      return lerp(fittedSize[i], bounded, strength);
    }) as Vec3;
  }
  const fittedYaw = normAngle(yaw0 + best.delta);

  // 阈值越大越保守：只做部分收缩，且不允许明显膨胀
  const shrink = clamp(1 - clamp(req.threshold, 0, 1), t.shrinkFloor, 1);
  const center: Vec3 = [
    lerp(cx, fittedCenter[0], shrink),
    lerp(cy, fittedCenter[1], shrink),
    lerp(cz, fittedCenter[2], shrink),
  ];
  const size: Vec3 = [0, 1, 2].map((i) => clamp(
    lerp(req.size[i], fittedSize[i], shrink),
    t.minSize,
    Math.max(t.minSize * 2, req.size[i] * t.maxInflate),
  )) as Vec3;
  const yaw = normAngle(yaw0 + normAngle(fittedYaw - yaw0) * shrink);

  const density = idx.length / Math.max(1e-6, (size[0] * size[1] * size[2]));
  const score = clamp(Math.min(1, idx.length / 40) * clamp(density / 8, 0, 1), 0, 1);

  return {
    ...req, points: new Float32Array(0), ok: true, center, sizeOut: size, yawOut: yaw, score,
    pointCount: idx.length, elapsed: performance.now() - started,
  };
}

self.onmessage = (e: MessageEvent<{ seq: number; req: FitRequest }>) => {
  const { seq, req } = e.data || ({} as any);
  if (!req) return;
  let result: FitResult;
  try { result = solve(req); }
  catch (err: any) { result = fail(req, String(err?.message || err), performance.now()); }
  (self as any).postMessage({ seq, result });
};
