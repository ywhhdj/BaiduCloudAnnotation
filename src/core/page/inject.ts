/**
 * MAIN world 钩子（2.0）
 *  1. 平台读取 .topic-schema 之前，按可配白名单改写 toolConfig（L0）
 *  2. 捕获平台答案的每一次写入（hidden input / XHR / fetch / IndexedDB）
 *  3. 探测平台内核与「自动贴合」按钮，提供 L1 原生操作（fit / create / state）
 *  4. 发出点云初始化就绪信号 PLATFORM_READY（事件驱动，不再靠固定定时器盲等）
 *  5. 提供只改几何字段的答案回写 API（L2 兜底）
 * 所有重活都不在这里做：只做轻量拦截、探测与转发；绝不写题目数据、绝不提交答案。
 */
import {
  ANSWER_INPUT_IDS,
  BRIDGE_CHANNEL,
  DEFAULT_PLATFORM_API,
  DOM_SELECTORS,
  UNIQUE_FORMAT,
} from '../../shared/constants';
import {
  parseBridge,
  postToIsolated
} from '../../shared/messages';
import type {
  PlatformApiMap,
  PlatformProbe,
  ToolConfigField
} from '../../shared/types';

interface Spec {
  center: number[];
  size: number[];
  yaw: number;
  typeId?: string;
  frameId?: string;
}

function boot() {
  if (window.__PC_ASSIST_HOOK__) return;
  window.__PC_ASSIST_HOOK__ = true;

  const ANSWER_IDS = new Set(ANSWER_INPUT_IDS);
  const pending = new Map<string, string>();
  let flushTimer: number | undefined;
  let snapshotMaxBytes = 2_000_000;
  let currentPatch: Record<string, unknown> = { autoFitBox: true, multiFrameMarkMode: true };
  let currentApi: PlatformApiMap = DEFAULT_PLATFORM_API;
  let patching = false;
  let readyTimer: number | undefined;

  const htmlDecode = (s: string) =>
    s.replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'");

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** 支持 bool / 数值 / 字符串字段，且兼容 HTML 属性里的转义引号 */
  function patchScalar(text: string, field: string, value: unknown): string {
    const q = '(?:\\\\?["\']|&quot;)';
    const re = new RegExp(`(${q}${escapeRe(field)}${q}\\s*:\\s*)(true|false|-?\\d+(?:\\.\\d+)?|"[^"]*"|'[^']*')`, 'g');
    const rep = typeof value === 'string' ? JSON.stringify(value) : String(value);
    return text.replace(re, (_m, prefix) => `${prefix}${rep}`);
  }

  function patchConfigText(text: string): string {
    let out = text;
    for (const [k, v] of Object.entries(currentPatch)) {
      if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string')
        out = patchScalar(out, k, v);
    }
    return out;
  }

  function readSchemaObject(): any | null {
    const node = document.querySelector(DOM_SELECTORS.topicSchema);
    if (!node?.textContent) return null;
    try {
      return JSON.parse(htmlDecode(node.textContent.trim()));
    } catch {
      return null;
    }
  }

  function patchSchemaNodes(): number {
    if (patching) return 0;
    patching = true;
    let n = 0;
    try {
      const nodes = document.querySelectorAll(DOM_SELECTORS.topicSchema);
      nodes.forEach((node) => {
        const raw = (node.textContent || '').trim();
        if (!raw.startsWith('{')) return;
        try {
          const obj = JSON.parse(htmlDecode(raw));
          if (!obj?.toolConfig) return;
          let changed = false;
          for (const [k, v] of Object.entries(currentPatch)) {
            if (obj.toolConfig[k] !== v) {
              obj.toolConfig[k] = v;
              changed = true;
            }
          }
          if (changed) {
            node.textContent = JSON.stringify(obj);
            n++;
          }
        } catch { /* 非 JSON 配置节点 */ }
      });
      // question_json 的 cml / brief 里内嵌了同一份 schema 文本
      const q = document.getElementById('question_json') as HTMLInputElement | null;
      if (q && q.value) {
        const next = patchConfigText(q.value);
        if (next !== q.value) {
          nativeInputSet?.call(q, next);
          n++;
        }
      }
    } finally {
      patching = false;
    }
    return n;
  }

  function scheduleSnapshot(id: string, text: string) {
    if (!text || text.length > snapshotMaxBytes) return;
    pending.set(id, text);
    if (flushTimer !== undefined) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = undefined;
      const items = Array.from(pending.entries());
      pending.clear();
      for (const [source, payload] of items)
        postToIsolated(window, 'ANSWER_SNAPSHOT', {
          id: source,
          text: payload
        });
    }, 110);
  }

  // ---- 1. 拦截 hidden input 的 value 写入（只对答案/题目字段触发快照） --------
  let nativeInputSet: ((v: string) => void) | undefined;
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc?.set && desc?.get) {
      nativeInputSet = desc.set as any;
      Object.defineProperty(HTMLInputElement.prototype, 'value', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(v: string) {
          let next = String(v ?? '');
          if ((this as HTMLInputElement).id === 'question_json') next = patchConfigText(next);
          nativeInputSet!.call(this, next);
          const id = (this as HTMLInputElement).id;
          if (ANSWER_IDS.has(id)) scheduleSnapshot(id, next);
        },
      });
    }
  } catch { /* 平台可能已冻结原型 */ }

  // ---- 2. 拦截网络提交（React 版不一定写 hidden input） ----------------------
  try {
    const rawSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: any) {
      if (typeof body === 'string' && /(answer|annotation|bbox|boxes|mark_result)/i.test(body)) scheduleSnapshot('xhr', body);
      return rawSend.apply(this, arguments as any);
    };
  } catch { /* noop */ }

  try {
    const rawFetch = window.fetch;
    window.fetch = function (this: Window, ...args: any[]) {
      const init = args[1] as RequestInit | undefined;
      const body = init?.body;
      if (typeof body === 'string' && /(answer|annotation|bbox|boxes|mark_result)/i.test(body)) scheduleSnapshot('fetch', body);
      return rawFetch.apply(this, args as any);
    } as typeof fetch;
  } catch { /* noop */ }

  // ---- 3. 轻量捕获 IndexedDB 本地答案（Dexie / mark_data） -------------------
  try {
    const proto = IDBObjectStore.prototype as any;
    for (const method of ['put', 'add']) {
      const raw = proto[method];
      proto[method] = function (value: any, ...rest: any[]) {
        try {
          if (value && typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.some((k) => /(answer|box|result|annotation|question)/i.test(k))) {
              const s = JSON.stringify(value);
              if (s.length < snapshotMaxBytes) scheduleSnapshot('idb', s);
            }
          }
        } catch { /* noop */ }
        return raw.call(this, value, ...rest);
      };
    }
  } catch { /* noop */ }

  // ---- 4. 平台原生能力探测（L1） ---------------------------------------------
  function resolvePath(root: any, path: string): any {
    let cur = root;
    for (const part of String(path || '').split('.')) {
      if (cur == null) return undefined;
      const call = part.endsWith('()');
      const key = call ? part.slice(0, -2) : part;
      const v = cur[key];
      cur = call && typeof v === 'function' ? v.call(cur) : v;
    }
    return cur;
  }

  function findKernel(api: PlatformApiMap): { kernel: any; globalName?: string; kernelPath?: string } {
    for (const g of api?.globals || []) {
      if (g === '__PC_ASSIST_API__') continue;
      const obj = (window as any)[g];
      if (obj && typeof obj === 'object') return {
        kernel: obj,
        globalName: g
      };
    }
    for (const p of api?.kernelPaths || []) {
      const v = resolvePath(window, p);
      if (v && typeof v === 'object') return {
        kernel: v,
        kernelPath: p
      };
    }
    return { kernel: null };
  }

  function methodOf(host: any, names: string[]): { name: string; fn: (...a: any[]) => any } | null {
    if (!host) return null;
    for (const name of names || []) {
      const fn = host[name];
      if (typeof fn === 'function') return { name, fn: fn.bind(host) };
    }
    return null;
  }

  function probePlatform(api: PlatformApiMap): PlatformProbe {
    const a = api && api.globals?.length ? api : DEFAULT_PLATFORM_API;
    const { kernel, globalName, kernelPath } = findKernel(a);
    const fit = methodOf(kernel, a.fitMethodNames) || methodOf(window, a.fitMethodNames);
    const create = methodOf(kernel, a.createMethodNames) || methodOf(window, a.createMethodNames);
    let frameCount: number | undefined;
    for (const p of a.frameCountPaths || []) {
      const v = Number(resolvePath(kernel || window, p));
      if (Number.isFinite(v) && v > 0) { frameCount = v; break; }
    }
    let frames: number | undefined;
    for (const p of a.framesPaths || []) {
      const v = resolvePath(kernel || window, p);
      if (Array.isArray(v)) { frames = v.length; break; }
    }
    let fitButton: string | undefined;
    for (const sel of a.fitButtonSelectors || []) {
      try { if (document.querySelector(sel)) { fitButton = sel; break; } } catch { /* 非法选择器跳过 */ }
    }
    const ok = Boolean(kernel || fit || fitButton);
    return {
      ok,
      globalName,
      kernelPath,
      fitMethod: fit?.name,
      createMethod: create?.name,
      frameCount,
      frames,
      fitButton,
      level: fit || fitButton ? 'L1' : 'L2',
    };
  }

  function nativeFit(api: PlatformApiMap, boxIds: string[]): boolean {
    const a = api && api.globals?.length ? api : DEFAULT_PLATFORM_API;
    // 优先点平台自己的「自动贴合」UI（最贴近平台本身操作）
    for (const sel of a.fitButtonSelectors || []) {
      try {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) { el.click(); return true; }
      } catch { /* noop */ }
    }
    const { kernel } = findKernel(a);
    const fit = methodOf(kernel, a.fitMethodNames) || methodOf(window, a.fitMethodNames);
    if (!fit) return false;
    const attempts: Array<() => void> = [
      () => fit.fn(),
      () => fit.fn({ boxIds }),
      () => fit.fn(boxIds),
      () => fit.fn(boxIds?.[0]),
    ];
    for (const run of attempts) {
      try { run(); return true; } catch { /* 换一种签名 */ }
    }
    return false;
  }

  /** 可选：调用平台自己的新建框方法；默认编排层不启用，避免破坏平台原数据 */
  function createBoxes(api: PlatformApiMap, specs: Spec[]): boolean {
    const a = api && api.globals?.length ? api : DEFAULT_PLATFORM_API;
    const { kernel } = findKernel(a);
    const create = methodOf(kernel, a.createMethodNames) || methodOf(window, a.createMethodNames);
    if (!create || !Array.isArray(specs) || !specs.length) return false;
    let all = true;
    for (const s of specs) {
      let ok = false;
      const attempts: Array<() => void> = [
        () => create.fn(s),
        () => create.fn(s.center, s.size, s.yaw, s.typeId),
        () => create.fn({
          center: s.center,
          size: s.size,
          yaw: s.yaw,
          typeId: s.typeId,
          frameId: s.frameId
        }),
      ];
      for (const run of attempts) {
        try {
          run();
          ok = true;
          break;
        } catch { /* 换一种签名 */ }
      }
      if (!ok) all = false;
    }
    return all;
  }

  function getPlatformState(api: PlatformApiMap): Record<string, unknown> {
    const a = api && api.globals?.length ? api : DEFAULT_PLATFORM_API;
    const { kernel } = findKernel(a);
    const state: Record<string, unknown> = {};
    const idxPaths = [
      'state.use().current.frameIndex',
      'state.current.frameIndex',
      'state.use().frameIndex',
      'frameIndex'
    ];
    for (const p of idxPaths) {
      const v = Number(resolvePath(kernel || window, p));
      if (Number.isFinite(v) && v >= 0) { state.frameIndex = v; break; }
    }
    for (const p of a.frameCountPaths || []) {
      const v = Number(resolvePath(kernel || window, p));
      if (Number.isFinite(v) && v > 0) { state.frameCount = v; break; }
    }
    return state;
  }

  // ---- 5. 点云初始化就绪信号（事件驱动） ------------------------------------
  function countFrameUrls(): { frameCount: number; frameUrls: number; schemaOk: boolean; canvas: boolean } {
    let uniqueCount = 0, zipCount = 0, domCount = 0, declared = 0;
    try {
      const q = document.getElementById('question_json') as HTMLInputElement | null;
      const obj = q?.value ? JSON.parse(q.value) : {};
      const parts = String(obj.unique || '').split(UNIQUE_FORMAT.segmentSeparator);
      const first = (parts[0] || '').split(UNIQUE_FORMAT.itemSeparator).filter(Boolean);
      uniqueCount = first.length;
      zipCount = first.filter((u: string) => /\.zip|framelidar/i.test(u)).length;
    } catch { /* ignore */ }
    try {
      const el = document.querySelector(DOM_SELECTORS.frameUrlDom);
      domCount = el?.textContent ? el.textContent.split(UNIQUE_FORMAT.itemSeparator).filter(Boolean).length : 0;
    } catch { /* ignore */ }
    try {
      const schema = readSchemaObject();
      declared = Number(schema?.toolConfig?.frameCount) || 0;
    } catch { /* ignore */ }
    let canvas = false;
    try { canvas = document.querySelectorAll('canvas').length > 0; } catch { /* ignore */ }
    return {
      frameCount: Math.max(uniqueCount, domCount, declared),
      frameUrls: Math.max(zipCount, domCount),
      schemaOk: Boolean(readSchemaObject()?.toolConfig),
      canvas,
    };
  }

  function frameIndexFromDom(): number | undefined {
    try {
      const items = Array.from(document.querySelectorAll(DOM_SELECTORS.frameItem));
      const idx = items.findIndex((el) => el.className?.includes?.('FramePagination_active'));
      return idx >= 0 ? idx : undefined;
    } catch {
      return undefined;
    }
  }

  function emitReady() {
    if (readyTimer !== undefined) return;
    readyTimer = window.setTimeout(() => {
      readyTimer = undefined;
      const c = countFrameUrls();
      postToIsolated(window, 'PLATFORM_READY', {
        at: Date.now(),
        frameCount: c.frameCount,
        frameUrls: c.frameUrls,
        schemaOk: c.schemaOk,
        canvas: c.canvas,
        frameIndex: frameIndexFromDom(),
      });
    }, 180);
  }

  const readyObserver = new MutationObserver((records) => {
    let hit = false;
    for (const r of records) {
      for (const node of Array.from(r.addedNodes)) {
        if (!(node instanceof Element)) continue;
        try {
          if (
            node.matches?.(DOM_SELECTORS.cloudRoot) ||
            node.matches?.(DOM_SELECTORS.topicSchema) ||
            node.matches?.(DOM_SELECTORS.frameList) ||
            node.matches?.('canvas') ||
            node.querySelector?.(DOM_SELECTORS.cloudRoot) ||
            node.querySelector?.(DOM_SELECTORS.topicSchema)
          ) {
            hit = true; break;
          }
        } catch { /* noop */ }
      }
      if (hit) break;
    }
    if (hit) emitReady();
  });
  try {
    readyObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
  } catch { /* noop */ }
  document.addEventListener('DOMContentLoaded', () => {
    patchSchemaNodes();
    emitReady();
  }, { once: true });

  // 帧列表点击后同步平台帧号（page_id 是题目页码，不是帧号）
  document.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (!t?.closest?.(DOM_SELECTORS.frameItem)) return;
    window.setTimeout(() => {
      const idx = frameIndexFromDom();
      if (idx !== undefined) postToIsolated(window, 'FRAME_CHANGED', {
        frameIndex: idx,
        at: Date.now()
      });
    }, 220);
  }, true);

  patchSchemaNodes();
  emitReady();

  // ---- 6. ISOLATED -> MAIN 指令 ---------------------------------------------
  window.addEventListener('message', (e) => {
    const msg = parseBridge(e, 'toMain', location.origin);
    if (!msg) return;
    switch (msg.type) {
      case 'PATCH_CONFIG': {
        const p = msg.payload || {};
        if (Array.isArray(p.api?.globals)) currentApi = p.api as PlatformApiMap;
        if (Number(p.snapshotMaxBytes) > 0) snapshotMaxBytes = Number(p.snapshotMaxBytes);
        const fields = Array.isArray(p.fields) ? (p.fields as ToolConfigField[]) : [];
        const next: Record<string, unknown> = {};
        if (p.enabled === false) {
          // 关闭助手时不改写平台配置，保持原数据
          currentPatch = {};
        } else {
          for (const f of fields) if (f?.enabled && typeof f.key === 'string') next[f.key] = f.value;
          if (!fields.length) {
            if (typeof p.autoFitBox === 'boolean') next.autoFitBox = p.autoFitBox;
            if (typeof p.multiFrameMarkMode === 'boolean') next.multiFrameMarkMode = p.multiFrameMarkMode;
          }
          currentPatch = Object.keys(next).length ? next : currentPatch;
        }
        patchSchemaNodes();
        emitReady();
        break;
      }
      case 'READ_ANSWER': {
        let text = '';
        for (const id of ANSWER_INPUT_IDS) {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (el?.value && el.value.length > 2 && el.id !== 'question_json') {
            text = el.value;
            break;
          }
        }
        postToIsolated(window, 'ANSWER_SNAPSHOT', {
          id: 'manual-read',
          text: text || '{}'
        });
        break;
      }
      case 'APPLY_ANSWER': {
        const text = String(msg.payload?.text || '');
        const written: string[] = [];
        for (const id of [
          'mark_answer_json',
          'user_answer_temp_json',
          'latest_answer_json',
          'quality_answer_json'
        ]) {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (!el) continue;
          try {
            if (nativeInputSet) nativeInputSet.call(el, text);
            else el.value = text;
            el.dispatchEvent(new Event('input', {
              bubbles: true
            }));
            el.dispatchEvent(new Event('change', {
              bubbles: true
            }));
            written.push(id);
          } catch { /* noop */ }
        }
        postToIsolated(window, 'APPLY_RESULT', {
          written,
          ok: written.length > 0
        });
        break;
      }
      case 'NATIVE_OPS': {
        const p = msg.payload || {};
        const seq = Number(p.seq) || 0;
        const api = (p.api as PlatformApiMap) || currentApi;
        if (p.action === 'probe') {
          postToIsolated(window, 'PLATFORM_PROBE', {
            seq,
            probe: probePlatform(api)
          });
        } else if (p.action === 'fit') {
          postToIsolated(window, 'NATIVE_OPS_RESULT', {
            seq,
            ok: nativeFit(api, Array.isArray(p.boxIds) ? p.boxIds : [])
          });
        } else if (p.action === 'create') {
          postToIsolated(window, 'NATIVE_OPS_RESULT', {
            seq,
            ok: createBoxes(api, Array.isArray(p.specs) ? p.specs : [])
          });
        } else if (p.action === 'state') {
          postToIsolated(window, 'NATIVE_OPS_RESULT', {
            seq,
            ok: true,
            data: getPlatformState(api)
          });
        } else {
          postToIsolated(window, 'NATIVE_OPS_RESULT', {
            seq,
            ok: false
          });
        }
        break;
      }
      case 'RELOAD':
        location.reload();
        break;
      default:
        break;
    }
  });

  // ---- 7. 暴露给 content / 控制台的调试 API ---------------------------------
  window.__PC_ASSIST_API__ = {
    version: '2.0.0',
    readAnswer: () => {
      for (const id of ANSWER_INPUT_IDS) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el?.value && el.id !== 'question_json') return el.value;
      }
      return '{}';
    },
    applyAnswer: (text: string) => {
      window.postMessage({
        __pc: `${BRIDGE_CHANNEL}:main`,
        type: 'APPLY_ANSWER',
        payload: { text }
      }, location.origin);
      return true;
    },
    patchToolConfig: (patch: Record<string, unknown>) => {
      currentPatch = {
        ...currentPatch,
        ...patch
      };
      return patchSchemaNodes() > 0;
    },
    probePlatform: () => probePlatform(currentApi) as unknown as Record<string, unknown>,
    nativeFit: (boxIds?: string[]) => nativeFit(currentApi, boxIds || []),
    callPlatform: (method: string, args: unknown[] = []) => {
      const { kernel } = findKernel(currentApi);
      const fn = methodOf(kernel, [method]) || methodOf(window, [method]);
      return fn ? fn.fn(...args) : undefined;
    },
    getPlatformState: () => getPlatformState(currentApi),
    reload: () => location.reload(),
  };

  postToIsolated(window, 'HOOK_READY', {
    at: Date.now(),
    version: '2.0.0'
  });
}

boot();
