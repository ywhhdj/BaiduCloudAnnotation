import type { ClassProfile, DetectionTuning, PlatformTypeHint, Vec3 } from './types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export interface ClassMatch {
  profile?: ClassProfile;
  score: number;
  typeId?: string;
  name?: string;
}

/** 规范化字符串：大小写、空格、下划线、连字符、斜杠一律忽略 */
const norm = (s: string) => String(s || '').toLowerCase().replace(/[\s_\-/]/g, '');

/** 把 profile 的 platformTypeId / aliases 对齐平台 topic-schema.typeConfig */
export function mapPlatformTypeId(
  platformTypes: PlatformTypeHint[],
  profile: Pick<ClassProfile, 'id' | 'name' | 'platformTypeId' | 'aliases'>,
): string | undefined {
  if (!platformTypes.length)
    return profile.platformTypeId || profile.id;
  const wanted = [
    profile.platformTypeId,
    profile.id,
    profile.name,
    ...(profile.aliases || [])
  ]
    .map((x) => norm(String(x || ''))).filter(Boolean);
  for (const w of wanted) {
    const hit = platformTypes.find((t) => norm(t.typeId) === w || norm(t.name) === w);
    if (hit) return hit.typeId;
  }
  for (const w of wanted) {
    const hit = platformTypes.find((t) =>
      norm(t.typeId).includes(w) ||
      norm(t.name).includes(w) ||
      w.includes(norm(t.name))
    );
    if (hit) return hit.typeId;
  }
  return profile.platformTypeId || undefined;
}

/** 平台长边约定：size[0] 为长；若不是，按水平面较大值作为长 */
export function normalizedSize(size: Vec3): Vec3 {
  const l = Math.max(Math.abs(size[0]), Math.abs(size[1]));
  const w = Math.min(Math.abs(size[0]), Math.abs(size[1]));
  return [
    l,
    w,
    Math.abs(size[2])
  ];
}

/**
 * 按长宽高近似判定类别（参考 SUSTechPOINTS obj_cfg.guess_obj_type_by_dimension，全部参数化）。
 * 只返回「建议」，不写平台类别字段；调用方决定是否用于自动出框。
 */
export function matchClassProfile(
  size: Vec3,
  pointCount: number,
  profiles: ClassProfile[],
  tuning: DetectionTuning,
  platformTypes: PlatformTypeHint[],
  autoMap: boolean,
): ClassMatch {
  const [l, w, h] = normalizedSize(size);
  let best: ClassProfile | undefined;
  let bestScore = 0;
  for (const p of profiles || []) {
    if (!p?.enabled || !Array.isArray(p.size) || p.size.length < 3) continue;
    if (p.sizeRange) {
      const r = p.sizeRange;
      if (l < r.l[0] || l > r.l[1] || w < r.w[0] || w > r.w[1] || h < r.h[0] || h > r.h[1]) continue;
    }
    const ratio = l / Math.max(0.1, w);
    if (p.aspectRatio && (ratio < p.aspectRatio[0] || ratio > p.aspectRatio[1])) continue;
    if (p.minPoints && pointCount < p.minPoints) continue;
    const prior = normalizedSize(p.size);
    let err = 0;
    for (let i = 0; i < 3; i++)
      err += Math.abs([l, w, h][i] - prior[i]) / Math.max(0.1, prior[i]);
    err /= 3;
    const tol = clamp(Number(p.tolerance) || 0.45, 0.05, 2);
    const raw = clamp(1 - err / (2 * tol), 0, 1);
    const score = raw * clamp(Number(p.weight) || 1, 0.05, 5);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) return {
    score: tuning.unknownPriorScore
  };
  const score = clamp(bestScore, 0, 1);
  return {
    profile: best,
    score,
    name: best.name,
    typeId: autoMap ? mapPlatformTypeId(platformTypes, best) : (best.platformTypeId || best.id),
  };
}
