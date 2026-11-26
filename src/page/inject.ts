/**
 * MAIN world 钩子
 * 职责：
 *  1. 在平台读取 .topic-schema 之前把 autoFitBox / multiFrameMarkMode 打开（原生贴边通道）
 *  2. 捕获平台答案的每一次写入（hidden input / XHR / fetch / IndexedDB），交给 ISOLATED world 判定人工修改
 *  3. 提供答案回写 API（增强贴合通道）
 * 所有重活都不在这里做：只做轻量拦截与转发。
 */
import { ANSWER_INPUT_IDS, BRIDGE_CHANNEL } from '../shared/constants';
import { parseBridge, postToIsolated } from '../shared/messages';

function boot() {
  if (window.__PC_ASSIST_HOOK__) return;
  window.__PC_ASSIST_HOOK__ = true;

  const ANSWER_IDS = new Set(ANSWER_INPUT_IDS);
  const pending = new Map<string, string>();
  let flushTimer: number | undefined;
  let currentPatch: Record<string, unknown> = { autoFitBox: true, multiFrameMarkMode: true };
  let patching = false;

  const htmlDecode = (s: string) =>
    s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  /** 兼容 JSON 文本在 HTML 属性 / 转义字符串里的多种形态 */
  function replaceBool(text: string, field: string, value: boolean): string {
    const q = '(?:\\\\?["\']|&quot;)';
    const re = new RegExp(`(${field}${q}\\s*:\\s*)(true|false)`, 'g');
    return text.replace(re, (_m, prefix) => `${prefix}${String(value)}`);
  }

  function patchConfigText(text: string): string {
    let out = text;
    for (const [k, v] of Object.entries(currentPatch)) {
      if (typeof v === 'boolean') out = replaceBool(out, k, v);
    }
    return out;
  }

  function patchSchemaNodes(): number {
    if (patching) return 0;
    patching = true;
    let n = 0;
    try {
      const nodes = document.querySelectorAll('.topic-schema, [class*="topic-schema"]');
      nodes.forEach((node) => {
        const raw = (node.textContent || '').trim();
        if (!raw.startsWith('{')) return;
        try {
          const obj = JSON.parse(htmlDecode(raw));
          if (!obj.toolConfig) return;
          let changed = false;
          for (const [k, v] of Object.entries(currentPatch)) {
            if (typeof v === 'boolean' && obj.toolConfig[k] !== v) {
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
    if (!text || text.length > 2_000_000) return;
    pending.set(id, text);
    if (flushTimer !== undefined) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = undefined;
      const items = Array.from(pending.entries());
      pending.clear();
      for (const [source, payload] of items) {
        postToIsolated(window, 'ANSWER_SNAPSHOT', { id: source, text: payload });
      }
    }, 110);
  }

  // ---- 1. 拦截 hidden input 的 value 写入 --------------------------------
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

  // ---- 2. 拦截网络提交（React 版不一定写 hidden input） ------------------
  try {
    const rawSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: any) {
      if (typeof body === 'string' && /(answer|annotation|bbox|boxes|mark_result)/i.test(body)) {
        scheduleSnapshot('xhr', body);
      }
      return rawSend.apply(this, arguments as any);
    };
  } catch { /* noop */ }

  try {
    const rawFetch = window.fetch;
    window.fetch = function (this: Window, ...args: any[]) {
      const init = args[1] as RequestInit | undefined;
      const body = init?.body;
      if (typeof body === 'string' && /(answer|annotation|bbox|boxes|mark_result)/i.test(body)) {
        scheduleSnapshot('fetch', body);
      }
      return rawFetch.apply(this, args as any);
    } as typeof fetch;
  } catch { /* noop */ }

  // ---- 3. 轻量捕获 IndexedDB 本地答案（Dexie / mark_data） ---------------
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
              if (s.length < 1_500_000) scheduleSnapshot('idb', s);
            }
          }
        } catch { /* noop */ }
        return raw.call(this, value, ...rest);
      };
    }
  } catch { /* noop */ }

  // ---- 4. 配置节点出现的第一时间改写（只检查新增节点，避免全文档扫描）----
  let obsTimer: number | undefined;
  const schemaSelector = '.topic-schema, [class*="topic-schema"]';
  const observer = new MutationObserver((records) => {
    if (patching || obsTimer !== undefined) return;
    let hit = false;
    for (const r of records) {
      for (const node of Array.from(r.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(schemaSelector) || node.querySelector?.(schemaSelector)) { hit = true; break; }
      }
      if (hit) break;
    }
    if (!hit) return;
    obsTimer = window.setTimeout(() => {
      obsTimer = undefined;
      patchSchemaNodes();
    }, 60);
  });
  observer.observe(document.documentElement || document, { childList: true, subtree: true, characterData: false });
  document.addEventListener('DOMContentLoaded', () => patchSchemaNodes(), { once: true });
  patchSchemaNodes();

  // ---- 5. ISOLATED -> MAIN 指令 ------------------------------------------
  window.addEventListener('message', (e) => {
    const msg = parseBridge(e, 'toMain');
    if (!msg) return;
    switch (msg.type) {
      case 'PATCH_CONFIG':
        currentPatch = { ...currentPatch, ...(msg.payload || {}) };
        patchSchemaNodes();
        break;
      case 'READ_ANSWER': {
        let text = '';
        for (const id of ANSWER_INPUT_IDS) {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (el?.value && el.value.length > 2 && el.id !== 'question_json') { text = el.value; break; }
        }
        postToIsolated(window, 'ANSWER_SNAPSHOT', { id: 'manual-read', text: text || '{}' });
        break;
      }
      case 'APPLY_ANSWER': {
        const text = String(msg.payload?.text || '');
        const written: string[] = [];
        for (const id of ['mark_answer_json', 'user_answer_temp_json', 'latest_answer_json', 'quality_answer_json']) {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (!el) continue;
          try {
            if (nativeInputSet) nativeInputSet.call(el, text);
            else el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            written.push(id);
          } catch { /* noop */ }
        }
        postToIsolated(window, 'APPLY_RESULT', { written, ok: written.length > 0 });
        break;
      }
      case 'RELOAD':
        location.reload();
        break;
      default:
        break;
    }
  });

  // ---- 6. 暴露给 content / 控制台的调试 API ------------------------------
  window.__PC_ASSIST_API__ = {
    version: '1.0.0',
    readAnswer: () => {
      for (const id of ANSWER_INPUT_IDS) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el?.value && el.id !== 'question_json') return el.value;
      }
      return '{}';
    },
    applyAnswer: (text: string) => {
      window.postMessage({ __pc: `${BRIDGE_CHANNEL}:main`, type: 'APPLY_ANSWER', payload: { text } }, location.origin);
      return true;
    },
    patchToolConfig: (patch: Record<string, unknown>) => {
      currentPatch = { ...currentPatch, ...patch };
      return patchSchemaNodes() > 0;
    },
    reload: () => location.reload(),
  };

  postToIsolated(window, 'HOOK_READY', { at: Date.now() });
}

boot();
