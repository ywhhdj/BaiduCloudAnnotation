import { MSG } from '../../shared/constants';
import { matchClassProfile } from '../../shared/classify';
import type { AssistConfig, Box3D, TaskInfo } from '../../shared/types';
import type { BoxDelta, ParseResult } from './answerAdapter';
import type { FitClient } from './fitClient';
import type { NativeOpsAdapter } from './nativeOps';

export interface NewBoxContext {
  cfg: AssistConfig;
  parsed: ParseResult;
  task: TaskInfo;
  currentIndex: number;
  isGuarded: (box: Box3D) => boolean;
  zipUrlFor: (index: number) => string;
  send: (msg: any) => Promise<any>;
  applyAnswer: (text: string) => void;
  applyDeltas: (parsed: ParseResult, deltas: BoxDelta[]) => {
    text: string; applied: number
  };
  fitClient: FitClient;
  nativeOps: NativeOpsAdapter;
  onStatus: (text?: string, patch?: any) => void;
}

export interface NewBoxAssistResult {
  found: number;
  native: number;
  fitted: number;
  suggestions: string[];
  level: 'L1' | 'L2' | 'none';
}

/**
 * 用户绘制拉框（Ctrl+拖拽 / 右键新建）后的自动后置动作：
 * 参考 SUSTechPOINTS「生成 box 并尝试自动旋转角度和调整 box 大小」+「自动贴边」。
 * 优先让平台自己做（L1），失败才用 ROI+PCA/OBB 只改几何（L2）。
 * 默认不改写平台类别字段，只给建议，保持原数据不变。
 */
export async function assistNewBoxes(newBoxes: Box3D[], ctx: NewBoxContext): Promise<NewBoxAssistResult> {
  const result: NewBoxAssistResult = {
    found: newBoxes.length,
    native: 0,
    fitted: 0,
    suggestions: [],
    level: 'none'
  };
  const cfg = ctx.cfg;
  if (!cfg.enabled || !newBoxes.length) return result;

  const targets = newBoxes.filter((b) =>
    b && Array.isArray(b.center) && Array.isArray(b.size) && b.size.every((v) => Number.isFinite(v) && v > 0) && !ctx.isGuarded(b));
  if (!targets.length) return result;

  // 1) 尺寸近似判定：只做建议 / 软尺寸约束，不写平台类别
  const classSize = new Map<string, [number, number, number]>();
  for (const b of targets) {
    const m = matchClassProfile(b.size, 0, cfg.classProfiles, cfg.detection, ctx.task.platformTypes || [], cfg.autoMapPlatformTypes);
    if (m.profile) {
      classSize.set(b.id, [...m.profile.size] as [number, number, number]);
      if (cfg.classifyOnUserDraw) {
        result.suggestions.push(`${m.name || m.typeId || '通用'} · 尺寸相似度 ${(m.score * 100).toFixed(0)}%`);
      }
    }
  }

  // 2) L1：平台原生自动贴合（自动旋转角度 + 调整大小/贴边）
  if (cfg.nativeOpsPrefer && (cfg.autoFitOnUserDraw || cfg.autoRotateOnUserDraw) && ctx.nativeOps.canFit) {
    const ok = await ctx.nativeOps.fit(targets.map((b) => b.id));
    if (ok) {
      result.native = targets.length;
      result.level = 'L1';
      ctx.onStatus(`新拉的 ${targets.length} 个框已交给平台自己旋转贴边 ✧（原数据一个字段没动）`, {
        nativeOpsLevel: 'L1',
        lastNewBoxCount: targets.length,
      });
      return result;
    }
  }

  // 3) L2：ROI 点云 + PCA/OBB，只回写几何字段
  if (!cfg.autoFitOnUserDraw && !cfg.autoRotateOnUserDraw) return result;
  const zipUrl = ctx.zipUrlFor(ctx.currentIndex);
  if (!zipUrl) {
    ctx.onStatus('当前帧没有点云地址，新框的自动贴边先跳过（平台原生贴合仍可用）。', {
      nativeOpsLevel: 'none'
    });
    return result;
  }
  const clean = targets.map((b) => ({
    id: b.id,
    center: b.center,
    size: b.size,
    yaw: b.yaw
  }));
  const pulled = await ctx.send({
    type: MSG.FETCH_PCD,
    payload: {
      zipUrl,
      boxes: clean,
      maxPoints: cfg.maxPointsPerBox,
      margin: 0.8,
      voxel: cfg.roiVoxel
    },
  });
  if (!pulled?.ok) {
    ctx.onStatus(`新框贴边取点失败：${pulled?.error || '未知原因'}`, {
      nativeOpsLevel: 'L2'
    });
    return result;
  }

  const deltas: BoxDelta[] = [];
  const groups = (pulled.data?.groups || []) as Array<{
    boxId: string;
    buffer: ArrayBuffer;
    count: number
  }>;
  for (const g of groups) {
    if (!g?.count) continue;
    const box = targets.find((b) => b.id === g.boxId);
    if (!box) continue;
    try {
      const res = await ctx.fitClient.fit({
        boxId: box.id,
        center: box.center,
        size: box.size,
        yaw: box.yaw,
        points: new Float32Array(g.buffer),
        outlierPercentile: cfg.outlierPercentile,
        maxPoints: cfg.maxPointsPerBox,
        threshold: cfg.fitThreshold,
        fitTuning: cfg.fitTuning,
        classSize: cfg.fitTuning.useClassSizeClamp ? classSize.get(box.id) || null : null,
      }, cfg.workerTimeouts.fit);
      if (!res.ok || res.score < 0.05) continue;
      deltas.push({
        boxId: box.id,
        path: box.path,
        center: res.center,
        size: res.sizeOut,
        yaw: res.yawOut
      });
    } catch { /* 单框失败不影响其它框 */ }
  }
  if (deltas.length) {
    const out = ctx.applyDeltas(ctx.parsed, deltas);
    ctx.applyAnswer(out.text);
    result.fitted = out.applied;
    result.level = 'L2';
    ctx.onStatus(`新拉的 ${out.applied} 个框已自动旋转贴边 ✧（只改了几何，类别/属性/来源不动）`, {
      nativeOpsLevel: 'L2',
      lastNewBoxCount: targets.length,
      fitCount: out.applied,
    });
  }
  return result;
}
