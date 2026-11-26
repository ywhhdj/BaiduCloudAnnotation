import type { FitRequest, FitResult } from '../shared/types';

/** 所有几何计算都在 Worker 里跑，主线程只负责消息与调度 */
export class FitClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, {
    resolve: (r: FitResult) => void;
    reject: (e: Error) => void;
    timer: number;
  }>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const url = chrome.runtime.getURL('js/fit.worker.js');
    const w = new Worker(url);
    w.onmessage = (e: MessageEvent<{ seq: number; result: FitResult }>) => {
      const { seq, result } = e.data || ({} as any);
      const p = this.pending.get(seq);
      if (!p) return;
      this.pending.delete(seq);
      clearTimeout(p.timer);
      p.resolve(result);
    };
    w.onerror = (e) => {
      const err = new Error(`贴合 Worker 异常：${e.message}`);
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
      this.pending.clear();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  fit(req: FitRequest, timeout = 4000): Promise<FitResult> {
    const w = this.ensure();
    const seq = ++this.seq;
    const points = req.points instanceof Float32Array ? req.points : new Float32Array(req.points);
    return new Promise<FitResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error('贴合计算超时'));
      }, timeout);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        w.postMessage({ seq, req: { ...req, points } }, [points.buffer]);
      } catch (e: any) {
        this.pending.delete(seq);
        clearTimeout(timer);
        reject(new Error(`Worker 投递失败：${e?.message || e}`));
      }
    });
  }

  dispose() {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('Worker 已释放')); }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
