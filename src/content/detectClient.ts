import type { DetectRequest, DetectResult } from '../shared/types';

/** 自动框选计算全部在 Worker 里，主线程零拷贝传入点云 */
export class DetectClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, {
    resolve: (r: DetectResult) => void;
    reject: (e: Error) => void;
    timer: number;
  }>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(chrome.runtime.getURL('js/detect.worker.js'), { type: 'module' });
    w.onmessage = (e: MessageEvent<{
      seq: number;
      result: DetectResult
    }>) => {
      const { seq, result } = e.data || ({} as any);
      const p = this.pending.get(seq);
      if (!p) return;
      this.pending.delete(seq);
      clearTimeout(p.timer);
      p.resolve(result);
    };
    w.onerror = (e) => {
      const err = new Error(`框选 Worker 异常：${e.message}`);
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
      this.pending.clear();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  detect(req: DetectRequest, timeout = 12000): Promise<DetectResult> {
    const w = this.ensure();
    const seq = ++this.seq;
    const points = req.points instanceof Float32Array ? req.points : new Float32Array(req.points);
    return new Promise<DetectResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error('自动框选计算超时'));
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
