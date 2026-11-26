import { boxSignature } from '../../shared/hash';
import { clearApprovals, getApprovals, putApprovals } from '../../shared/storage';
import type { ApprovalEntry, ApprovalState, Box3D, CandidateBox } from '../../shared/types';

/** 审批状态只存在扩展自己的 storage，不往平台答案里塞私有字段 */
export class ApprovalManager {
  private entries: ApprovalEntry[] = [];
  private dirty = false;
  private taskKey = '';

  constructor(private markId = '', private pageId = '') { }

  async init() {
    this.entries = await getApprovals(this.markId, this.pageId);
  }

  setTask(markId: string, pageId: string) {
    const key = `${markId}:${pageId}`;
    if (key === this.taskKey) return;
    this.taskKey = key;
    this.markId = markId;
    this.pageId = pageId;
    this.entries = [];
  }

  get all(): ApprovalEntry[] {
    return [...this.entries];
  }
  pending(): ApprovalEntry[] {
    return this.entries.filter((e) => e.state === 'pending');
  }

  counts() {
    let pending = 0, approved = 0, rejected = 0;
    for (const e of this.entries) {
      if (e.state === 'pending')
        pending++;
      else if (e.state === 'approved')
        approved++;
      else
        rejected++;
    }
    return {
      pending,
      approved,
      rejected,
      total: this.entries.length
    };
  }

  /** 登记一批自动框选候选（默认待审批） */
  async register(candidates: CandidateBox[], paths: Map<string, (string | number)[]>): Promise<ApprovalEntry[]> {
    const now = Date.now();
    const add: ApprovalEntry[] = candidates.map((c) => ({
      boxId: c.id,
      frameId: c.frameId,
      trackId: c.trackId,
      state: 'pending' as ApprovalState,
      confidence: c.confidence,
      suggestedType: c.typeId,
      signature: boxSignature(c),
      path: paths.get(c.id),
      at: now,
      reason: c.reason,
    }));
    const map = new Map(this.entries.map((e) => [e.boxId, e]));
    for (const e of add) map.set(e.boxId, e);
    this.entries = Array.from(map.values()).slice(-900);
    this.dirty = true;
    await this.flush();
    return add;
  }

  async setStates(ids: string[] | undefined, state: ApprovalState, reason?: string, minConfidence = 0): Promise<ApprovalEntry[]> {
    const set = ids ? new Set(ids) : null;
    const changed: ApprovalEntry[] = [];
    this.entries = this.entries.map((e) => {
      if (e.state !== 'pending') return e;
      if (set && !set.has(e.boxId)) return e;
      if (e.confidence < minConfidence) return e;
      const next: ApprovalEntry = {
        ...e,
        state,
        at: Date.now(),
        reason: reason || e.reason
      };
      changed.push(next);
      return next;
    });
    if (changed.length) {
      this.dirty = true;
      await this.flush();
    }
    return changed;
  }

  /** 高置信度候选自动标记已审批（仍可被人工随时修改） */
  async approveHigh(threshold: number): Promise<ApprovalEntry[]> {
    return this.setStates(undefined, 'approved', '高置信度自动通过', threshold);
  }

  /** 人工动了哪个待审框，就等于审批通过并锁定该框 */
  async onManualEdits(boxes: Box3D[]): Promise<ApprovalEntry[]> {
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const changed: ApprovalEntry[] = [];
    this.entries = this.entries.map((e) => {
      if (e.state !== 'pending') return e;
      const box = byId.get(e.boxId);
      if (!box) return e;
      const sig = boxSignature(box);
      if (sig === e.signature) return e;
      const next: ApprovalEntry = {
        ...e,
        state: 'approved',
        signature: sig,
        at: Date.now(),
        reason: '人工调整即审批通过'
      };
      changed.push(next);
      return next;
    });
    if (changed.length) {
      this.dirty = true;
      await this.flush();
    }
    return changed;
  }

  find(id: string): ApprovalEntry | undefined {
    return this.entries.find((e) => e.boxId === id);
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    await putApprovals(this.markId, this.pageId, this.entries);
  }

  async reset() {
    this.entries = [];
    await clearApprovals(this.markId, this.pageId);
  }
}
