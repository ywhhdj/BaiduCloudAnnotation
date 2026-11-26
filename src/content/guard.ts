import { parseAnswer, type BoxDelta, type ParseResult } from './answerAdapter';
import { boxKey, boxSignature } from '../shared/hash';
import { clearGuards, getGuards, putGuards } from '../shared/storage';
import type { AssistConfig, Box3D, GuardEntry } from '../shared/types';

export interface SnapshotVerdict {
  parsed: ParseResult;
  boxes: Box3D[];
  manualCount: number;
  rollbackDeltas: BoxDelta[];
  rollbackIds: string[];
}

/**
 * 判定规则（核心约束：人工修改过的框永远不再被自动改动）
 *  - 平台答案里带 manual/edited/source=manual 字段 → 直接守护
 *  - 用户交互窗口内（pointer/key/input 后 1.6s）发生的框参数变化 → 人工修改，守护「改动后的参数」
 *  - 插件自己贴边产生的变化 → 用 recentAssist 排除，不算人工
 *  - 已守护的框若被平台自动贴合/插值改动（无用户交互）→ 生成回滚 delta，写回守护参数
 */
export class GuardManager {
  private snapshots = new Map<string, string>();
  private guards: GuardEntry[] = [];
  private recentAssist = new Map<string, number>();
  private lastUserInteraction = 0;
  private dirty = false;

  constructor(
    private markId: string,
    private pageId: string,
    private config: () => AssistConfig,
  ) {}

  async init() {
    this.guards = await getGuards(this.markId, this.pageId);
  }

  setTask(markId: string, pageId: string) {
    if (markId === this.markId && pageId === this.pageId) return;
    this.markId = markId;
    this.pageId = pageId;
    this.snapshots.clear();
    this.recentAssist.clear();
    this.guards = [];
  }

  noteUserInteraction() {
    this.lastUserInteraction = Date.now();
  }

  /** 插件即将写回这些框，短时间内不把它们的变化当作人工修改 */
  markAssist(ids: string[]) {
    const now = Date.now();
    for (const id of ids) this.recentAssist.set(id, now);
    if (this.recentAssist.size > 200) {
      for (const [k, t] of this.recentAssist) if (now - t > 3000) this.recentAssist.delete(k);
    }
  }

  private isRecentAssist(id: string): boolean {
    const t = this.recentAssist.get(id);
    if (!t) return false;
    if (Date.now() - t > 2600) { this.recentAssist.delete(id); return false; }
    return true;
  }

  private guardIndex(box: Box3D): number {
    const key = boxKey(box);
    return this.guards.findIndex((g) => g.boxId === key || (g.boxId === box.id && g.frameId === box.frameId));
  }

  isGuarded(box: Box3D): boolean {
    const cfg = this.config();
    if (!cfg.guardManual) return false;
    if (this.guardIndex(box) >= 0) return true;
    if (cfg.guardWholeTrack && box.trackId) {
      return this.guards.some((g) => g.trackId === box.trackId);
    }
    return false;
  }

  /** 外部显式守护（例如人工审批通过）：以当前参数为准，之后永不自动改动 */
  async protect(box: Box3D, reason: string): Promise<number> {
    const key = boxKey(box);
    const entry: GuardEntry = {
      boxId: key,
      trackId: box.trackId,
      frameId: box.frameId,
      signature: boxSignature(box),
      params: { center: [...box.center] as any, size: [...box.size] as any, yaw: box.yaw },
      reason,
      at: Date.now(),
    };
    const idx = this.guardIndex(box);
    if (idx >= 0) this.guards[idx] = entry;
    else this.guards.push(entry);
    this.dirty = true;
    return this.guards.length;
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    await putGuards(this.markId, this.pageId, this.guards);
  }

  async onSnapshot(text: string, defaultFrameId?: string): Promise<SnapshotVerdict> {
    const parsed = parseAnswer(text, defaultFrameId);
    const verdict: SnapshotVerdict = { parsed, boxes: parsed.boxes, manualCount: 0, rollbackDeltas: [], rollbackIds: [] };
    if (!parsed.ok) return verdict;

    const cfg = this.config();
    const now = Date.now();
    const userWindow = now - this.lastUserInteraction < 1600;
    const touchedTracks = new Set<string>();

    for (const box of parsed.boxes) {
      const key = boxKey(box);
      const sig = boxSignature(box);
      const prev = this.snapshots.get(key);
      this.snapshots.set(key, sig);

      if (prev === undefined) {
        if (cfg.guardManual && (box.attrs?.__pcManual || userWindow)) {
          await this.protect(box, box.attrs?.__pcManual ? '平台字段标记为人工' : '交互窗口内的初始编辑');
          verdict.manualCount++;
        }
        continue;
      }
      if (prev === sig) continue;
      if (this.isRecentAssist(box.id) || this.isRecentAssist(key)) continue;

      const idx = this.guardIndex(box);
      if (cfg.guardManual && (userWindow || box.attrs?.__pcManual)) {
        // 用户亲手改过：以「改动后」的参数作为新的守护基准
        await this.protect(box, userWindow ? '用户交互修改' : '平台字段标记为人工');
        verdict.manualCount++;
        if (box.trackId) touchedTracks.add(box.trackId);
        continue;
      }

      if (idx >= 0 && cfg.guardManual) {
        // 平台自动贴合/插值把人工框改了 → 回滚
        const g = this.guards[idx];
        verdict.rollbackDeltas.push({ boxId: box.id, path: box.path, center: g.params.center, size: g.params.size, yaw: g.params.yaw });
        verdict.rollbackIds.push(key);
        this.snapshots.set(key, boxSignature({ ...box, ...g.params } as Box3D));
      }
    }

    if (cfg.guardWholeTrack && touchedTracks.size) {
      for (const box of parsed.boxes) {
        if (box.trackId && touchedTracks.has(box.trackId) && this.guardIndex(box) < 0) {
          await this.protect(box, '整轨守护');
        }
      }
    }
    await this.flush();
    return verdict;
  }

  get count(): number { return this.guards.length; }

  list(): GuardEntry[] { return [...this.guards]; }

  async reset() {
    this.guards = [];
    this.snapshots.clear();
    await clearGuards(this.markId, this.pageId);
  }
}
