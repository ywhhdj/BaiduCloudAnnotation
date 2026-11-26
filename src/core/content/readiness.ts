import { DOM_SELECTORS } from '../../shared/constants';
import type { AssistConfig, PlatformReady } from '../../shared/types';

export interface ReadinessInputs {
  urlMatched: boolean;
  hookReady: boolean;
  schemaOk: boolean;
  frameCount: number;
  frameUrls: number;
  doc: Document;
}

export interface ReadinessCallbacks {
  onTick?: (state: PlatformReady) => void;
  onReady: (state: PlatformReady) => void;
  onTimeout?: (state: PlatformReady) => void;
}

/**
 * 点云初始化完毕判定（事件驱动）：
 * URL 命中 ∧ 钩子就绪 ∧ schema 可读 ∧ 组件根/canvas 出现 ∧ 帧数据可读 ∧ 答案快照稳定 ∧ 稳定窗口。
 * 不再用固定 2.6s / 6.5s 盲等；定时器只作 maxWaitMs 兜底。
 */
export class ReadinessController {
  private cfg: AssistConfig;
  private cb: ReadinessCallbacks;
  private startedAt = Date.now();
  private lastMutationAt = Date.now();
  private lastAnswerAt = Date.now();
  private answerRounds = 0;
  private done = false;
  private timedOut = false;
  private timer: number | undefined;
  private observer: MutationObserver | undefined;
  private lastInputs: ReadinessInputs | null = null;

  constructor(cfg: AssistConfig, cb: ReadinessCallbacks) {
    this.cfg = cfg;
    this.cb = cb;
  }

  setConfig(cfg: AssistConfig) {
    this.cfg = cfg;
  }

  /** 每次答案快照到达时调用：答案还在写入，稳定计数清零 */
  noteAnswer() {
    this.lastAnswerAt = Date.now();
    this.answerRounds = 0;
  }

  /** 每次 DOM 变化调用（由 MutationObserver 过滤后的有效变化） */
  noteMutation() {
    this.lastMutationAt = Date.now();
  }

  start(doc: Document, inputs: ReadinessInputs) {
    this.lastInputs = inputs;
    this.startedAt = Date.now();
    this.lastMutationAt = Date.now();
    this.lastAnswerAt = Date.now();
    this.answerRounds = 0;
    this.done = false;
    this.timedOut = false;
    this.stop();

    // 只关心配置节点 / 点云根 / 帧列表 / canvas 的新增，避免全文档无差别扫描
    const watch = `${DOM_SELECTORS.topicSchema}, ${DOM_SELECTORS.cloudRoot}, ${DOM_SELECTORS.frameList}, ${DOM_SELECTORS.frameItem}, canvas`;
    try {
      this.observer = new MutationObserver((records) => {
        let hit = false;
        for (const r of records) {
          for (const node of Array.from(r.addedNodes)) {
            if (!(node instanceof Element)) continue;
            try {
              if (node.matches?.(watch) || node.querySelector?.(watch)) { hit = true; break; }
            } catch { /* 选择器兼容性兜底 */ }
          }
          if (hit) break;
        }
        if (hit) this.noteMutation();
      });
      this.observer.observe(doc.documentElement || doc, {
        childList: true,
        subtree: true
      });
    } catch { /* MutationObserver 不可用时仅靠轮询 */ }

    this.timer = window.setInterval(() => this.tick(), Math.max(60, Number(this.cfg.readiness.pollMs) || 240));
    this.tick();
  }

  stop() {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private canvasOk(doc: Document): boolean {
    if (!this.cfg.readiness.requireCanvas) return true;
    try {
      return doc.querySelectorAll('canvas').length > 0;
    } catch { return false; }
  }

  private readySelectorsOk(doc: Document): boolean {
    const list = this.cfg.readiness.readySelectors?.length ? this.cfg.readiness.readySelectors : [DOM_SELECTORS.cloudRoot, 'canvas'];
    for (const sel of list) {
      try {
        if (doc.querySelector(sel)) return true;
      } catch { /* 非法选择器跳过 */ }
    }
    return false;
  }

  private answerStableOk(): boolean {
    if (!this.cfg.readiness.requireAnswerStable) return true;
    const stableMs = Math.max(0, Number(this.cfg.readiness.stableMs) || 0);
    if (Date.now() - this.lastAnswerAt >= stableMs) this.answerRounds += 1;
    return this.answerRounds >= Math.max(1, Number(this.cfg.readiness.answerStableRounds) || 1);
  }

  evaluate(inputs: ReadinessInputs = this.lastInputs as ReadinessInputs): PlatformReady {
    const now = Date.now();
    const reasons: string[] = [];
    if (!inputs?.urlMatched) reasons.push('URL 未命中规则');
    if (!inputs?.hookReady) reasons.push('页面钩子未就绪');
    if (!inputs?.schemaOk) reasons.push('topic-schema 未读到');
    if (!this.readySelectorsOk(inputs?.doc || document)) reasons.push('点云组件根/canvas 未出现');
    if (this.cfg.readiness.requireFrameUrls && !(inputs?.frameUrls > 0)) reasons.push('没有可用点云帧地址');
    if (this.cfg.readiness.requireFrameUrls && !(inputs?.frameCount > 0)) reasons.push('帧数未获取');
    if (!this.answerStableOk()) reasons.push('答案快照仍在写入');
    const stableMs = Math.max(0, Number(this.cfg.readiness.stableMs) || 0);
    if (now - this.lastMutationAt < stableMs) reasons.push('页面仍在变化（稳定窗口未满）');
    if (now - this.startedAt < stableMs) reasons.push('初始化稳定窗口未满');

    const ready = reasons.length === 0;
    return {
      ready,
      at: now,
      reasons,
      frameCount: inputs?.frameCount || 0,
      frameUrls: inputs?.frameUrls || 0,
      canvas: this.canvasOk(inputs?.doc || document),
      answerStable: this.cfg.readiness.requireAnswerStable ? this.answerRounds >= Math.max(1, Number(this.cfg.readiness.answerStableRounds) || 1) : true,
      detail: ready
        ? `点云已就绪：${inputs?.frameCount} 帧 / ${inputs?.frameUrls} 个点云地址`
        : `等待点云初始化：${reasons.join('、')}`,
    };
  }

  private tick() {
    if (!this.lastInputs || this.done) return;
    const state = this.evaluate(this.lastInputs);
    this.cb.onTick?.(state);
    if (state.ready) {
      this.done = true;
      this.stop();
      this.cb.onReady(state);
      return;
    }
    const maxWait = Math.max(1000, Number(this.cfg.readiness.maxWaitMs) || 20000);
    if (!this.timedOut && Date.now() - this.startedAt >= maxWait) {
      this.timedOut = true;
      this.cb.onTimeout?.(state);
    }
  }

  updateInputs(inputs: ReadinessInputs) {
    this.lastInputs = inputs;
  }
}
