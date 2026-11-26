import { CLASS_PRIORS, DEFAULT_CONFIG, DOM_SELECTORS, MSG, STORAGE_KEYS, UI_ACTION } from '../shared/constants';
import { onMessage, parseBridge, postToMain, send } from '../shared/messages';
import {
  clearAutoDetected, getBoxTemplate, getConfig, markAutoDetected, setBoxTemplate,
  setConfig, setStatus, wasAutoDetected,
} from '../shared/storage';
import type {
  AssistConfig, Box3D, CandidateBox, DetectRequest, FitRequest, RuntimeStatus, TaskInfo,
} from '../shared/types';
import {
  appendBoxes, applyDeltas, parseAnswer, removeBoxes,
  type BoxDelta, type NewBoxSpec,
} from './answerAdapter';
import { ApprovalManager } from './approval';
import { GuardManager } from './guard';
import { detectFrameIndex, groupBoxesByFrame, readTask, zipUrlOf } from './frameLink';
import { FitClient } from './fitClient';
import { DetectClient } from './detectClient';

type ParseResult = ReturnType<typeof parseAnswer>;
type Scope = 'current' | 'all';

const idle = (ms = 12) => new Promise<void>((resolve) => {
  const ric = (window as any).requestIdleCallback;
  if (ric) ric(() => resolve(), { timeout: ms * 8 });
  else window.setTimeout(resolve, ms);
});

/** 忽略朝向的 AABB IoU 近似，用于过滤与已有框重复的自动候选 */
function aabbIoU(a: { center: Box3D['center']; size: Box3D['size'] }, b: { center: Box3D['center']; size: Box3D['size'] }): number {
  let inter = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.center[i] - a.size[i] / 2, b.center[i] - b.size[i] / 2);
    const hi = Math.min(a.center[i] + a.size[i] / 2, b.center[i] + b.size[i] / 2);
    inter *= Math.max(0, hi - lo);
  }
  const va = a.size[0] * a.size[1] * a.size[2];
  const vb = b.size[0] * b.size[1] * b.size[2];
  return inter / Math.max(1e-6, va + vb - inter);
}

/** 相邻帧候选按中心距离 + 尺寸比贪心关联，给多帧模式生成 trackId */
function linkTracks(frames: CandidateBox[][]): CandidateBox[] {
  const flat: CandidateBox[] = [];
  let next = 1;
  let prev: CandidateBox[] = [];
  frames.forEach((list, frameIdx) => {
    const used = new Set<string>();
    for (const c of list) {
      let match: CandidateBox | undefined;
      let best = Infinity;
      for (const p of prev) {
        if (used.has(p.id) || !p.trackId) continue;
        const d = Math.hypot(c.center[0] - p.center[0], c.center[1] - p.center[1], c.center[2] - p.center[2]);
        if (d > 3.5) continue;
        const ratio = Math.max(
          c.size[0] / Math.max(0.1, p.size[0]), p.size[0] / Math.max(0.1, c.size[0]),
          c.size[1] / Math.max(0.1, p.size[1]), p.size[1] / Math.max(0.1, c.size[1]),
        );
        if (ratio > 1.7) continue;
        if (d < best) { best = d; match = p; }
      }
      if (match) { c.trackId = match.trackId; used.add(match.id); }
      else c.trackId = `pc_trk_${next++}`;
      c.reason = `${c.reason} · 第 ${frameIdx + 1} 帧`;
      flat.push(c);
    }
    prev = list;
  });
  return flat;
}

export class Assistant {
  private cfg: AssistConfig = DEFAULT_CONFIG;
  private task: TaskInfo = { markId: '', pageId: '1', frameCount: 5, frames: [], toolConfig: {} };
  private guard: GuardManager;
  private approval: ApprovalManager;
  private fitClient = new FitClient();
  private detectClient = new DetectClient();
  private latest: ParseResult | null = null;
  private currentIndex = 0;
  private hookReady = false;
  private busy = false;
  private statusDraft: Partial<RuntimeStatus> = {};
  private statusTimer: number | undefined;
  private lastHref = location.href;
  private started = false;
  private lastTaskKey = '';
  private autoDetectTried = false;
  private autoDetectDebounce: number | undefined;

  constructor() {
    this.guard = new GuardManager('', '1', () => this.cfg);
    this.approval = new ApprovalManager('', '1');
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.cfg = await getConfig();

    this.injectMain();
    window.addEventListener('message', this.onBridge, false);
    ['pointerdown', 'mousedown', 'keydown', 'input', 'wheel', 'touchstart'].forEach((t) => {
      document.addEventListener(t, () => this.guard.noteUserInteraction(), {
        capture: true,
        passive: true
      });
    });
    window.addEventListener('popstate', () => this.checkFrameChange(true));
    window.addEventListener('hashchange', () => this.checkFrameChange(true));
    document.addEventListener('click', (e) => {
      const t = e.target as Element | null;
      if (t?.closest?.(DOM_SELECTORS.frameItem)) window.setTimeout(() => this.checkFrameChange(true), 260);
    }, { capture: true, passive: true });

    onMessage((msg) => this.onRuntimeMessage(msg));
    chrome.storage.onChanged.addListener((changes: any, area: string) => {
      if (area === 'local' && changes[STORAGE_KEYS.config]?.newValue) {
        this.cfg = {
          ...DEFAULT_CONFIG,
          ...changes[STORAGE_KEYS.config].newValue
        };
      }
    });

    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', () => this.initTask(), { once: true });
    else this.initTask();

    window.setInterval(() => this.checkFrameChange(false), 1500);
    window.setTimeout(() => postToMain(window, 'READ_ANSWER'), 1200);
    window.setTimeout(() => postToMain(window, 'READ_ANSWER'), 4000);
    // 打开页面后的自动框选：2.6s 主触发 + 6.5s 兜底（等平台晚写入答案 / 钩子就绪）
    window.setTimeout(() => this.maybeAutoDetect(), 2600);
    window.setTimeout(() => this.maybeAutoDetect(), 6500);

    this.say('前辈，我先把大部分框自动圈好并贴边，你只管审批和微调就好～');
  }

  // ---------------------------------------------------------------- 注入
  private injectMain() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('js/inject.js');
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch { /* 由兜底通道处理 */ }
    window.setTimeout(() => {
      if (!this.hookReady) send({ type: MSG.MAIN_INJECT_FALLBACK, payload: {} });
    }, 420);
  }

  private patchPlatformConfig() {
    postToMain(window, 'PATCH_CONFIG', {
      autoFitBox: Boolean(this.cfg.enabled && this.cfg.nativeAutoFit),
      multiFrameMarkMode: Boolean(this.cfg.enabled && this.cfg.nativeMultiFrame),
    });
  }

  private onBridge = (e: MessageEvent) => {
    const m = parseBridge(e, 'toIsolated');
    if (!m) return;
    switch (m.type) {
      case 'HOOK_READY':
        this.hookReady = true;
        this.patchPlatformConfig();
        this.say(undefined, { hookReady: true });
        this.scheduleAutoDetect(400);
        break;
      case 'ANSWER_SNAPSHOT':
        this.onAnswer(String(m.payload?.id || ''), String(m.payload?.text || ''));
        break;
      case 'APPLY_RESULT':
        if (m.payload?.ok === false) {
          this.say('答案回写通道没命中（平台可能只把答案放在内存里）。先在平台手动拉一个框让我学一下答案格式，再点「自动框选」就好～');
        }
        break;
      default: break;
    }
  };

  // ---------------------------------------------------------------- 任务
  private async initTask() {
    try {
      const read = readTask(document, location);
      const key = `${read.markId}:${read.pageId}`;
      const same = key === this.lastTaskKey;
      this.lastTaskKey = key;
      this.task = read;
      this.currentIndex = detectFrameIndex(document, location, this.task);
      if (!same) {
        this.guard.setTask(this.task.markId, this.task.pageId);
        await this.guard.init();
        this.approval.setTask(this.task.markId, this.task.pageId);
        await this.approval.init();
        this.autoDetectTried = false;
      }
      const native = this.task.toolConfig?.autoFitBox;
      const lightTask: TaskInfo = {
        ...this.task,
        frames: this.task.frames.map((f) => ({ ...f, calib: undefined })),
      };
      this.say(undefined, {
        task: lightTask,
        frameIndex: this.currentIndex,
        ...this.approvalPatch(),
        nativeAutoFit: Boolean(this.cfg.nativeAutoFit && native !== false),
        enhancedFit: this.cfg.enhancedFit,
      });
      if (!same && this.task.frames.some((f) => !f.zipUrl)) {
        this.say('帧数据里没读到点云地址，自动框选会跳过这些帧；原生贴合与人工守护不受影响。');
      }
    } catch (err: any) {
      this.say(`题目解析遇到问题：${err?.message || err}`);
    }
  }

  private checkFrameChange(force: boolean) {
    const hrefChanged = location.href !== this.lastHref;
    if (hrefChanged) this.lastHref = location.href;
    const idx = detectFrameIndex(document, location, this.task);
    if (idx !== this.currentIndex) {
      this.currentIndex = idx;
      this.say(`切到第 ${idx + 1} 帧啦，审批名单和守护符都还在我手里。`, { frameIndex: idx });
      postToMain(window, 'READ_ANSWER');
    } else if (hrefChanged || force) {
      this.latest = null;
      postToMain(window, 'READ_ANSWER');
    }
    if (hrefChanged) this.initTask();
  }

  // ---------------------------------------------------------------- 答案
  private async onAnswer(id: string, text: string) {
    if (!this.cfg.enabled || !text || text.length < 2 || id === 'question_json') return;
    if (/topic-schema|toolConfig/.test(text.slice(0, 400)) && !/"(center|size|position)"/.test(text.slice(0, 2000))) return;
    const frameId = this.task.frames[this.currentIndex]?.frameId;
    try {
      const verdict = await this.guard.onSnapshot(text, frameId);
      if (!verdict.parsed.ok) return;
      this.latest = verdict.parsed;

      // 学一个平台真实框节点的样子：自动出框时按它克隆，结构才不会被平台拒绝
      const sample = verdict.boxes.find((b) => b.attrs?.__pcManual)?.raw ?? verdict.boxes[0]?.raw;
      if (sample) void setBoxTemplate(this.task.markId, this.task.pageId, sample);

      // 人工动了待审框 = 审批通过 + 加守护
      const edited = await this.approval.onManualEdits(verdict.boxes);
      if (edited.length) {
        for (const e of edited) {
          const box = verdict.boxes.find((b) => b.id === e.boxId);
          if (box) await this.guard.protect(box, '人工调整即审批通过');
        }
        this.say(`前辈亲手调了 ${edited.length} 个框，我记成「审批通过」并锁好啦，之后谁都不能自动动它们 ✧`, this.approvalPatch());
      }
      this.say(undefined, { boxCount: verdict.boxes.length, ...this.approvalPatch() });

      if (verdict.rollbackDeltas.length) {
        this.guard.markAssist(verdict.rollbackIds);
        const out = applyDeltas(verdict.parsed, verdict.rollbackDeltas);
        postToMain(window, 'APPLY_ANSWER', { text: out.text });
        this.latest = parseAnswer(out.text, frameId);
        this.say(`有 ${out.applied} 个人工守护框被平台的自动改动碰到了，我已经悄悄还原啦 ✧`, { skippedCount: out.applied });
      }
      if (verdict.manualCount) {
        this.say(`这个框是前辈亲手调过的，我给它贴上守护符啦（当前守护 ${this.guard.count} 个）`, this.approvalPatch());
      }
      this.scheduleAutoDetect(1400);
    } catch { /* 答案结构不认识时静默跳过，不干扰标注 */ }
  }

  private readAnswerFromDom(): string {
    for (const id of ['mark_answer_json', 'user_answer_temp_json', 'latest_answer_json', 'quality_answer_json']) {
      const v = (document.getElementById(id) as HTMLInputElement | null)?.value;
      if (v && v.length > 2) return v;
    }
    return '{}';
  }

  // ---------------------------------------------------------------- 自动框选
  private scheduleAutoDetect(delay = 1200) {
    if (this.autoDetectDebounce !== undefined) clearTimeout(this.autoDetectDebounce);
    this.autoDetectDebounce = window.setTimeout(() => { this.autoDetectDebounce = undefined; this.maybeAutoDetect(); }, delay);
  }

  /** 打开页面自动跑一次：只在答案基本为空、点云地址可用、钩子就绪时执行 */
  private async maybeAutoDetect() {
    if (!this.cfg.autoDetectOnOpen || !this.cfg.enabled || this.busy || this.autoDetectTried) return;
    if (!this.hookReady || !this.task.frames.some((f) => f.zipUrl)) return;
    if (await wasAutoDetected(this.task.markId, this.task.pageId)) { this.autoDetectTried = true; return; }
    const existing = this.latest?.ok ? this.latest.boxes.length : 0;
    if (existing >= this.cfg.autoDetectIfFewerThan) { this.autoDetectTried = true; return; }
    this.autoDetectTried = true;
    await this.autoDetect(this.cfg.autoDetectMultiFrame ? 'all' : 'current', true);
  }

  private async autoDetect(scope: Scope, fromOpen = false) {
    if (!this.cfg.enabled) { this.say('助手现在休息中，点一下「启用」我就回来～'); return; }
    if (this.busy) { this.say('上一轮框选还没跑完，稍等我一下下…'); return; }

    this.busy = true;
    this.say('正在看点云…我会把大部分目标先圈出来并贴好边，前辈稍等一下下～', { workerBusy: true });
    try {
      const indices = scope === 'all'
        ? this.task.frames.map((_, i) => i).filter((i) => zipUrlOf(this.task, i))
        : [this.currentIndex];
      if (!indices.length) { this.say('没有可用的点云帧地址，自动框选先跳过啦。'); return; }

      const byFrame: CandidateBox[][] = [];
      for (const idx of indices) {
        await idle(this.cfg.idleSliceMs);
        const zipUrl = zipUrlOf(this.task, idx);
        const pulled = await send({
          type: MSG.FETCH_FRAME_POINTS,
          payload: { zipUrl, maxPoints: this.cfg.detectMaxPoints },
        });
        if (!pulled?.ok) { this.say(`第 ${idx + 1} 帧点云没取到：${pulled?.error || '未知原因'}`); continue; }
        const req: DetectRequest = {
          points: new Float32Array(pulled.data.buffer),
          maxPoints: this.cfg.detectMaxPoints,
          voxel: this.cfg.detectVoxel,
          groundPercentile: this.cfg.detectGroundPercentile,
          minPoints: this.cfg.detectMinPoints,
          maxClusters: this.cfg.detectMaxClusters,
          confidenceMin: this.cfg.detectConfidenceMin,
          outlierPercentile: this.cfg.outlierPercentile,
          fitThreshold: this.cfg.fitThreshold,
          classPriors: this.cfg.detectClassPriors ? CLASS_PRIORS : [],
          idPrefix: `pc_${this.task.markId}_${idx}`,
        };
        const res = await this.detectClient.detect(req);
        if (!res.ok) { this.say(`第 ${idx + 1} 帧框选失败：${res.error || '未知原因'}`); continue; }
        const frameId = this.task.frames[idx].frameId;
        const stamp = Date.now().toString(36);
        byFrame.push(res.candidates.map((c, k) => ({
          ...c,
          id: `pc_auto_${stamp}_${idx}_${k}`,
          frameId,
        })));
      }

      const linked = linkTracks(byFrame);
      const existing = this.latest?.ok ? this.latest.boxes : [];
      // 与已有框（人工标注 / 平台预标注）重叠的候选直接丢掉
      const candidates = linked.filter((c) => !existing.some((b) => aabbIoU(c, b) > 0.35));
      if (!candidates.length) {
        this.say('这一轮没找到新的目标（可能点云没取到，或候选都和已有框重合）。把「候选最低置信度」调低一点再试试～');
        return;
      }

      const defaultFrameId = this.task.frames[this.currentIndex]?.frameId;
      const parsed = this.latest?.ok ? this.latest : parseAnswer(this.readAnswerFromDom(), defaultFrameId);
      const template = await getBoxTemplate(this.task.markId, this.task.pageId);
      const specs: NewBoxSpec[] = candidates.map((c) => ({
        id: c.id, frameId: c.frameId, trackId: c.trackId, typeId: c.typeId,
        center: c.center, size: c.size, yaw: c.yaw,
      }));
      const out = appendBoxes(parsed, specs, {
        template,
        defaultFrameId,
        frameIds: this.task.frames.map((f) => f.frameId),
      });
      await this.approval.register(candidates, out.paths);
      if (this.cfg.autoApproveHighConfidence) {
        await this.approval.approveHigh(this.cfg.autoApproveThreshold);
      }

      this.guard.markAssist(specs.map((s) => s.id));
      postToMain(window, 'APPLY_ANSWER', { text: out.text });
      this.latest = parseAnswer(out.text, defaultFrameId);
      if (fromOpen) await markAutoDetected(this.task.markId, this.task.pageId);

      const c = this.approval.counts();
      this.say(
        `我先圈好 ${out.appended} 个候选框啦（${byFrame.length} 帧）✧ 待审 ${c.pending} 个、已自动通过 ${c.approved} 个。` +
        `前辈点「全部通过」、或随手调两个框，我就记成审批通过并锁住～`,
        { workerBusy: false, autoDetected: true, boxCount: this.latest.boxes.length, ...this.approvalPatch() },
      );
    } catch (err: any) {
      this.say(`自动框选出了点小状况：${err?.message || err}`, { workerBusy: false });
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------------- 贴合
  private async fit(scope: Scope) {
    if (!this.cfg.enabled) { this.say('助手现在休息中，点一下「启用」我就回来～'); return; }
    if (this.busy) { this.say('上一轮贴合还没跑完，稍等我一下下…'); return; }

    this.patchPlatformConfig();
    if (!this.cfg.enhancedFit) {
      this.say(`原生自动贴合已开启：之后新拉的框由平台自己贴边，${this.guard.count} 个人工守护框一个都不动～要重算已有框，到设置开启「增强贴合」。`);
      return;
    }

    this.busy = true;
    this.say('开始取点云啦，稍微等一下…', { workerBusy: true });
    let fitCount = 0, skipped = 0, frameDone = 0;
    try {
      const frameId = this.task.frames[this.currentIndex]?.frameId;
      const parsed = this.latest?.ok ? this.latest : parseAnswer(this.readAnswerFromDom(), frameId);
      if (!parsed.ok || !parsed.boxes.length) {
        this.say('还没读到可处理的框，先点「自动框选」，或者让平台预标注出结果吧。');
        return;
      }
      const groups = groupBoxesByFrame(parsed.boxes, this.task, this.currentIndex);
      const targets: Array<[number, Box3D[]]> = scope === 'all'
        ? Array.from(groups.entries())
        : [[this.currentIndex, groups.get(this.currentIndex) || []]];
      const allDeltas: BoxDelta[] = [];

      for (const [idx, boxes] of targets) {
        const candidates = boxes.filter((b) => !this.guard.isGuarded(b));
        skipped += boxes.length - candidates.length;
        if (!candidates.length) continue;
        const zipUrl = zipUrlOf(this.task, idx);
        if (!zipUrl) { this.say(`第 ${idx + 1} 帧没有点云地址，跳过啦。`); continue; }
        await idle(this.cfg.idleSliceMs);

        const clean = candidates.map((b) => ({ id: b.id, center: b.center, size: b.size, yaw: b.yaw }));
        const pulled = await send({
          type: MSG.FETCH_PCD,
          payload: { zipUrl, boxes: clean, maxPoints: this.cfg.maxPointsPerBox, margin: 0.8 },
        });
        if (!pulled?.ok) { this.say(`第 ${idx + 1} 帧点云没取到：${pulled?.error || '未知原因'}`); continue; }

        const pool: Promise<void>[] = [];
        for (const g of pulled.data.groups as Array<{ boxId: string; buffer: ArrayBuffer; count: number }>) {
          if (!g.count) continue;
          const box = candidates.find((b) => b.id === g.boxId);
          if (!box) continue;
          const req: FitRequest = {
            boxId: box.id, center: box.center, size: box.size, yaw: box.yaw,
            points: new Float32Array(g.buffer),
            outlierPercentile: this.cfg.outlierPercentile,
            maxPoints: this.cfg.maxPointsPerBox,
            threshold: this.cfg.fitThreshold,
          };
          const job = (async () => {
            try {
              const res = await this.fitClient.fit(req);
              if (!res.ok || res.score < 0.05) return;
              allDeltas.push({ boxId: res.boxId, path: box.path, center: res.center, size: res.sizeOut, yaw: res.yawOut });
            } catch { /* 单框失败不影响整批 */ }
          })();
          pool.push(job);
          if (pool.length >= 2) { await Promise.all(pool); pool.length = 0; }
        }
        if (pool.length) await Promise.all(pool);
        frameDone++;
      }

      if (allDeltas.length) {
        this.guard.markAssist(allDeltas.map((d) => d.boxId));
        const out = applyDeltas(parsed, allDeltas);
        fitCount = out.applied;
        postToMain(window, 'APPLY_ANSWER', { text: out.text });
        this.latest = parseAnswer(out.text, this.task.frames[this.currentIndex]?.frameId);
      }
      const frameText = scope === 'all' ? `跨 ${frameDone}/${targets.length} 帧` : '当前帧';
      this.say(
        fitCount
          ? `${frameText}贴好 ${fitCount} 个框啦，人工守护的 ${skipped} 个一个都没动 ✧`
          : `${frameText}没有需要贴边的框（守护 ${skipped} 个），云点图很干净呢。`,
        { fitCount, skippedCount: skipped, workerBusy: false },
      );
    } catch (err: any) {
      this.say(`贴合过程出了点小状况：${err?.message || err}`, { workerBusy: false });
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------------- 审批
  private approvalPatch(): Partial<RuntimeStatus> {
    const c = this.approval.counts();
    return { candidateCount: c.total, pendingCount: c.pending, approvedCount: c.approved, guardCount: this.guard.count };
  }

  private async protectApproved(ids: string[]) {
    const boxes = this.latest?.ok ? this.latest.boxes : [];
    for (const id of ids) {
      const box = boxes.find((b) => b.id === id);
      if (box) await this.guard.protect(box, '人工审批通过');
    }
  }

  private async approve(state: 'approved', minConfidence = 0, label = '人工批量审批通过') {
    const changed = await this.approval.setStates(undefined, state, label, minConfidence);
    await this.protectApproved(changed.map((e) => e.boxId));
    this.say(changed.length ? `通过 ${changed.length} 个候选，已经给它们贴上守护符啦 ✧` : '当前没有待审批的候选哦。', this.approvalPatch());
  }

  private async rejectAll() {
    const changed = await this.approval.setStates(undefined, 'rejected', '人工批量拒绝');
    const boxes = this.latest?.ok ? this.latest.boxes : [];
    const paths = changed
      .map((e) => boxes.find((b) => b.id === e.boxId)?.path || e.path)
      .filter((p): p is (string | number)[] => Array.isArray(p));
    let removed = 0;
    if (paths.length && this.latest?.ok) {
      const out = removeBoxes(this.latest, paths);
      removed = out.removed;
      if (removed) {
        this.guard.markAssist(changed.map((e) => e.boxId));
        postToMain(window, 'APPLY_ANSWER', { text: out.text });
        this.latest = parseAnswer(out.text, this.task.frames[this.currentIndex]?.frameId);
      }
    }
    this.say(changed.length ? `已拒绝 ${changed.length} 个候选，删掉了答案里 ${removed} 个框。` : '当前没有待审批的候选哦。', {
      boxCount: this.latest?.boxes.length || 0, ...this.approvalPatch(),
    });
  }

  // ---------------------------------------------------------------- 消息
  private onRuntimeMessage(msg: { type: string; payload?: any }): any {
    switch (msg.type) {
      case MSG.CONFIG_CHANGED:
      case 'CONFIG_UPDATED':
        this.cfg = { ...this.cfg, ...(msg.payload || {}) };
        this.patchPlatformConfig();
        this.say(undefined, { nativeAutoFit: this.cfg.nativeAutoFit, enhancedFit: this.cfg.enhancedFit });
        return true;
      case MSG.TOAST:
        this.say(String(msg.payload?.text || ''));
        return true;
      case MSG.RELOAD:
        postToMain(window, 'RELOAD');
        return true;
      case MSG.UI_ACTION:
        this.handleAction(String(msg.payload?.action || ''), msg.payload);
        return true;
      default: return undefined;
    }
  }

  private async handleAction(action: string, payload: any = {}) {
    switch (action) {
      case UI_ACTION.fitCurrent: await this.fit('current'); break;
      case UI_ACTION.fitAllFrames: await this.fit('all'); break;
      case UI_ACTION.autoDetect:
      case UI_ACTION.autoDetectAllFrames:
        await clearAutoDetected(this.task.markId, this.task.pageId);
        this.autoDetectTried = false;
        await this.autoDetect(action === UI_ACTION.autoDetectAllFrames ? 'all' : 'current');
        break;
      case UI_ACTION.showGuards: {
        const list = this.guard.list();
        const head = list.slice(0, 5).map((g, i) => `${i + 1}. ${g.boxId}（${g.reason}）`).join('\n');
        this.say(list.length ? `守护名单（共 ${list.length} 个）：\n${head}${list.length > 5 ? '\n…' : ''}` : '现在还没有人工守护的框。');
        break;
      }
      case UI_ACTION.clearGuards:
        await this.guard.reset();
        this.say('守护名单已清空，之后所有框都可以自动贴边啦。', this.approvalPatch());
        break;
      case UI_ACTION.showApprovals: {
        const pending = this.approval.pending();
        const c = this.approval.counts();
        const head = pending.slice(0, 6).map((e, i) =>
          `${i + 1}. ${e.suggestedType || '通用'} · ${(e.confidence * 100).toFixed(0)}% · ${e.frameId || '-'}`).join('\n');
        this.say(pending.length
          ? `待审批 ${c.pending} 个 / 已通过 ${c.approved} 个：\n${head}${pending.length > 6 ? '\n…' : ''}\n微调任一框 = 自动通过；也可以点「全部通过」。`
          : `没有待审批的候选啦（已通过 ${c.approved} 个），前辈可以安心交卷～`);
        break;
      }
      case UI_ACTION.approveAll: await this.approve('approved'); break;
      case UI_ACTION.approveHigh: await this.approve('approved', this.cfg.autoApproveThreshold, '高置信度通过'); break;
      case UI_ACTION.rejectAll: await this.rejectAll(); break;
      case UI_ACTION.approveOne:
      case UI_ACTION.rejectOne: {
        const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
        if (!ids.length) break;
        if (action === UI_ACTION.approveOne) await this.approval.setStates(ids, 'approved', '人工单条通过');
        else await this.approval.setStates(ids, 'rejected', '人工单条拒绝');
        if (action === UI_ACTION.approveOne) await this.protectApproved(ids);
        this.say(`已处理 ${ids.length} 个候选。`, this.approvalPatch());
        break;
      }
      case UI_ACTION.clearApprovals:
        await this.approval.reset();
        this.say('审批记录已清空（答案里的框不会被删除）。', this.approvalPatch());
        break;
      case UI_ACTION.toggleEnabled:
      case UI_ACTION.toggleNative:
      case UI_ACTION.toggleEnhanced:
      case UI_ACTION.toggleMultiFrame: {
        const map: Record<string, keyof AssistConfig> = {
          [UI_ACTION.toggleEnabled]: 'enabled',
          [UI_ACTION.toggleNative]: 'nativeAutoFit',
          [UI_ACTION.toggleEnhanced]: 'enhancedFit',
          [UI_ACTION.toggleMultiFrame]: 'multiFrameBatch',
        };
        const key = map[action] as keyof AssistConfig;
        const next = await setConfig({ [key]: payload.value ?? !(this.cfg as any)[key] } as any);
        this.cfg = next;
        this.patchPlatformConfig();
        this.say(`设置更新：${key} = ${(this.cfg as any)[key] ? '开' : '关'}`, { nativeAutoFit: next.nativeAutoFit, enhancedFit: next.enhancedFit });
        break;
      }
      case UI_ACTION.reloadConfig:
        this.patchPlatformConfig();
        this.say('配置已重新下发，正在刷新页面让平台读取（记得先保存答案哦）…');
        window.setTimeout(() => postToMain(window, 'RELOAD'), 700);
        break;
      case UI_ACTION.collapse:
        await setConfig({ collapsed: Boolean(payload.value) });
        break;
      default: break;
    }
  }

  /** 台词 + 状态：合并写入，180ms 节流，避免 storage 高频抖动 */
  private say(text?: string, patch: Partial<RuntimeStatus> = {}) {
    Object.assign(this.statusDraft, patch);
    if (text) this.statusDraft.lastDetail = text;
    if (this.statusTimer !== undefined) return;
    this.statusTimer = window.setTimeout(async () => {
      this.statusTimer = undefined;
      const draft = this.statusDraft;
      this.statusDraft = {};
      try { await setStatus(draft); } catch { /* storage 不可用时静默 */ }
    }, 180);
  }
}


