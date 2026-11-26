import type { AssistConfig, NewBoxEvent, PlatformProbe } from '../../shared/types';

interface Pending {
  resolve: (v: any) => void;
  timer: number;
  action: string;
}

/**
 * L1：平台原生操作适配。
 * content(ISOLATED) 不能直接访问页面 MAIN world 的对象，所有调用通过桥消息交给 inject.ts 执行；
 * 探测不到 / 调用失败时返回 false，由编排层降级到 L2（只改几何字段）。
 */
export class NativeOpsAdapter {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private cachedProbe: PlatformProbe | null = null;

  constructor(
    private cfg: () => AssistConfig,
    private post: (type: string, payload: any) => void,
  ) { }

  private request(action: string, payload: Record<string, unknown> = {}, timeoutMs = 1500): Promise<any> {
    const seq = ++this.seq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(seq);
        resolve(null);
      }, Math.max(200, timeoutMs));
      this.pending.set(seq, {
        resolve,
        timer,
        action
      });
      this.post('NATIVE_OPS', {
        seq,
        action,
        api: this.cfg().platformApi,
        ...payload,
      });
    });
  }

  /** inject.ts 回传的 PLATFORM_PROBE / NATIVE_OPS_RESULT */
  handleBridge(type: string, payload: any): boolean {
    const seq = Number(payload?.seq);
    const p = this.pending.get(seq);
    if (!p) return false;
    window.clearTimeout(p.timer);
    this.pending.delete(seq);
    if (type === 'PLATFORM_PROBE') {
      const probe = (payload?.probe || null) as PlatformProbe | null;
      this.cachedProbe = probe;
      p.resolve(probe);
    } else {
      p.resolve({
        ok: Boolean(payload?.ok),
        data: payload?.data
      });
    }
    return true;
  }

  get probe(): PlatformProbe | null { return this.cachedProbe; }

  async probePlatform(): Promise<PlatformProbe | null> {
    const r = await this.request('probe', {}, 1600);
    return (r as PlatformProbe | null) || null;
  }

  /** 让平台自己完成「自动旋转角度 + 贴边」（方法或 UI 按钮） */
  async fit(boxIds?: string[]): Promise<boolean> {
    const r = await this.request('fit', {
      boxIds: boxIds || []
    }, 1800);
    return Boolean(r?.ok);
  }

  /** 可选：调用平台自己的新建框方法；默认不启用，避免破坏平台原数据 */
  async createBoxes(specs: Array<{
    center: number[];
    size: number[];
    yaw: number;
    typeId?: string;
    frameId?: string
  }>): Promise<boolean> {
    const r = await this.request('create', { specs }, 2200);
    return Boolean(r?.ok);
  }

  async platformState(): Promise<Record<string, unknown>> {
    const r = await this.request('state', {}, 1200);
    return (r?.data as Record<string, unknown>) || {};
  }

  /** 平台是否具备可用的原生贴合能力 */
  get canFit(): boolean {
    const p = this.cachedProbe;
    return Boolean(p?.ok && (p.fitMethod || p.fitButton));
  }

  dispose() {
    for (const [, p] of this.pending) {
      window.clearTimeout(p.timer);
      p.resolve(null);
    }
    this.pending.clear();
  }
}

/** 新框几何描述，供 newBoxAssist 使用 */
export function toNewBoxEvent(boxId: string, center: number[], size: number[], yaw: number, frameId?: string): NewBoxEvent {
  return {
    boxId,
    frameId,
    center: center as [number, number, number],
    size: size as [number, number, number],
    yaw,
    at: Date.now()
  };
}
