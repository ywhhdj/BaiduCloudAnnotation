import { BRIDGE_CHANNEL } from './constants';
import type { Envelope } from './types';

export interface BridgeMessage extends Envelope {
  __pc?: string;
}

/** MAIN world -> ISOLATED world */
export function postToIsolated(win: Window, type: string, payload?: any): void {
  win.postMessage({
    __pc: BRIDGE_CHANNEL,
    type, payload
  }, win.location?.origin || '*');
}

/** ISOLATED world -> MAIN world */
export function postToMain(win: Window, type: string, payload?: any): void {
  win.postMessage({
    __pc: `${BRIDGE_CHANNEL}:main`,
    type, payload
  }, win.location?.origin || '*');
}

/**
 * 只接受同页面、同 origin、同通道方向的消息。
 * origin 由调用方传入 location.origin；不传时保持旧行为（兼容调试控制台）。
 */
export function parseBridge(e: MessageEvent, direction: 'toIsolated' | 'toMain', origin?: string): BridgeMessage | null {
  if (!e || !e.source) return null;
  if (origin && e.origin && e.origin !== origin) return null;
  const data = e.data;
  if (!data || typeof data !== 'object') return null;
  const expect = direction === 'toIsolated' ? BRIDGE_CHANNEL : `${BRIDGE_CHANNEL}:main`;
  if (data.__pc !== expect || typeof data.type !== 'string') return null;
  return data as BridgeMessage;
}

export async function send(msg: Envelope): Promise<any> {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    return undefined;
  }
}

export function onMessage(handler: (msg: Envelope, sender: any) => any): void {
  chrome.runtime.onMessage.addListener((msg: Envelope, sender: any, reply: (v: any) => void) => {
    const ret = handler(msg, sender);
    if (ret && typeof ret.then === 'function') {
      ret.then((v: any) => reply(v)).catch(() => reply(undefined));
      return true;
    }
    if (ret !== undefined) reply(ret);
    return false;
  });
}

export function broadcastStatusChange(): void {
  // 状态写入 storage 后由 storage.onChanged 驱动 UI，避免额外广播风暴
}
