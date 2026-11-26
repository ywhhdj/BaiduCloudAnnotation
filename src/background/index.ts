import { unzipSync } from 'fflate';
import { MSG, STORAGE_KEYS } from '../shared/constants';
import { onMessage } from '../shared/messages';
import { clearGuards, getConfig, getGuards, getStatus, putGuard, putGuards, setConfig, setStatus } from '../shared/storage';
import type { AssistConfig, Box3D, Envelope, FitDelta, Vec3 } from '../shared/types';

/** 帧点云缓存：避免多帧批量时重复下载/解压 zip */
const frameCache = new Map<string, Float32Array>();
const CACHE_LIMIT = 6;

function cacheSet(key: string, data: Float32Array) {
  if (frameCache.has(key)) frameCache.delete(key);
  frameCache.set(key, data);
  while (frameCache.size > CACHE_LIMIT) frameCache.delete(frameCache.keys().next().value as string);
}

function absoluteUrl(u: string): string {
  if (!u) return '';
  // service worker 的 location.protocol 是 chrome-extension:，必须显式用 https
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('http')) return u;
  return new URL(u, 'https://test.baidu.com/').toString();
}

function decodeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** KITTI .bin：float32 x,y,z[,intensity]；也兼容 ASCII PCD */
function parsePointBuffer(name: string, bytes: Uint8Array): Float32Array | null {
  if (/\.bin$/i.test(name)) {
    const stride = bytes.byteLength % 16 === 0 ? 4 : bytes.byteLength % 12 === 0 ? 3 : 4;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.floor(bytes.byteLength / (stride * 4));
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const b = i * stride * 4;
      out[i * 3] = view.getFloat32(b, true);
      out[i * 3 + 1] = view.getFloat32(b + 4, true);
      out[i * 3 + 2] = view.getFloat32(b + 8, true);
    }
    return out;
  }
  if (/\.pcd$/i.test(name)) {
    const text = new TextDecoder().decode(bytes);
    const head = text.indexOf('DATA ascii');
    if (head < 0) return null;
    const lines = text.slice(head).split(/\r?\n/).slice(1);
    const coords: number[] = [];
    for (const line of lines) {
      const p = line.trim().split(/\s+/);
      if (p.length >= 3) {
        const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) coords.push(x, y, z);
      }
    }
    return new Float32Array(coords);
  }
  return null;
}

async function loadFramePoints(url: string): Promise<Float32Array> {
  const key = url.split('?')[0];
  const hit = frameCache.get(key);
  if (hit) return hit;
  const resp = await fetch(absoluteUrl(url), { credentials: 'omit' });
  if (!resp.ok) throw new Error(`点云下载失败 ${resp.status}`);
  const buf = await resp.arrayBuffer();
  let points: Float32Array | null = null;
  try {
    const files = unzipSync(new Uint8Array(buf));
    const names = Object.keys(files).filter((n) => /\.(bin|pcd)$/i.test(n));
    // 优先 velodyne / points 目录里的主点云
    names.sort((a, b) => (b.includes('velodyne') ? 1 : 0) - (a.includes('velodyne') ? 1 : 0) || files[b].length - files[a].length);
    for (const n of names) {
      points = parsePointBuffer(n, files[n]);
      if (points && points.length) break;
    }
  } catch {
    // 不是 zip 时可能是裸 .bin
    points = parsePointBuffer('frame.bin', new Uint8Array(buf));
  }
  if (!points || !points.length) throw new Error('zip 中未找到 .bin / .pcd 点云');
  cacheSet(key, points);
  return points;
}

/** 把全局点变换到框的局部坐标，做 OBB 粗筛 + 均匀抽稀 */
function roiOf(all: Float32Array, box: Box3D, margin: number, maxPoints: number): Float32Array {
  const [cx, cy, cz] = box.center;
  const [l, w, h] = box.size;
  const cos = Math.cos(box.yaw), sin = Math.sin(box.yaw);
  const hx = l / 2 + margin, hy = w / 2 + margin, hz = h / 2 + margin;
  let picked: number[] = [];
  // 兼容「center.z 为底面中心」的模板：两种取点，取点多者
  for (const zMode of [0, 1] as const) {
    const zc = zMode ? cz + h / 2 : cz;
    const local: number[] = [];
    for (let i = 0; i < all.length; i += 3) {
      const dx = all[i] - cx, dy = all[i + 1] - cy;
      const lx = cos * dx + sin * dy;
      if (lx < -hx || lx > hx) continue;
      const ly = -sin * dx + cos * dy;
      if (ly < -hy || ly > hy) continue;
      const lz = all[i + 2] - zc;
      if (lz < -hz || lz > hz) continue;
      local.push(all[i], all[i + 1], all[i + 2]);
    }
    if (local.length > picked.length) picked = local;
  }
  const n = picked.length / 3;
  if (!n) return new Float32Array(0);
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const keep = Math.ceil(n / step);
  const out = new Float32Array(keep * 3);
  for (let k = 0, i = 0; k < n; k += step, i++) {
    const s = k * 3;
    out[i * 3] = picked[s];
    out[i * 3 + 1] = picked[s + 1];
    out[i * 3 + 2] = picked[s + 2];
  }
  return out;
}

async function fetchPcd(payload: any): Promise<any> {
  const { zipUrl, boxes, maxPoints = 12000, margin = 0.8 } = payload || {};
  if (!zipUrl) throw new Error('缺少 zipUrl');
  const all = await loadFramePoints(zipUrl);
  const groups = (boxes as Box3D[]).map((b) => {
    const pts = roiOf(all, b, margin, maxPoints);
    return { boxId: b.id, buffer: pts.buffer, count: pts.length / 3 };
  });
  return { groups, totalPoints: all.length / 3 };
}

/** 全帧点云均匀抽稀：自动框选只需要能聚类的密度，不需要百万级原始点 */
function thinAll(all: Float32Array, maxPoints: number): Float32Array {
  const n = Math.floor(all.length / 3);
  const step = Math.max(1, Math.ceil(n / Math.max(1000, maxPoints)));
  const keep = Math.ceil(n / step);
  const out = new Float32Array(keep * 3);
  for (let k = 0, i = 0; k < n; k += step, i++) {
    out[i * 3] = all[k * 3];
    out[i * 3 + 1] = all[k * 3 + 1];
    out[i * 3 + 2] = all[k * 3 + 2];
  }
  return out;
}

async function fetchFramePoints(payload: any): Promise<any> {
  const { zipUrl, maxPoints = 60000 } = payload || {};
  if (!zipUrl) throw new Error('缺少 zipUrl');
  const all = await loadFramePoints(zipUrl);
  const thin = thinAll(all, maxPoints);
  return { buffer: thin.buffer, count: thin.length / 3, totalPoints: all.length / 3 };
}

async function forwardToTab(tabId: number | undefined, msg: Envelope) {
  if (!tabId) return;
  try { await chrome.tabs.sendMessage(tabId, msg); } catch { /* tab 已关闭 */ }
}

async function resolveTabId(tabId?: number): Promise<number | undefined> {
  if (tabId) return tabId;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tabs?.find((t: any) => /test\.baidu\.com\/mark\//.test(t?.url || ''))?.id ?? tabs?.[0]?.id;
}

onMessage(async (msg: Envelope, sender: any) => {
  const tabId = sender?.tab?.id ?? msg.tabId;
  switch (msg.type) {
    case MSG.PING: return { ok: true, at: Date.now() };

    case MSG.CONFIG_GET: return await getConfig();
    case MSG.CONFIG_SET: {
      const cfg = await setConfig(msg.payload ?? {});
      await forwardToTab(tabId, { type: MSG.CONFIG_CHANGED, payload: cfg });
      return cfg;
    }
    case MSG.STATUS_GET: return await getStatus();
    case MSG.STATUS_SET: return await setStatus(msg.payload ?? {});

    case MSG.GUARD_LIST: {
      const { markId = '', pageId = '' } = msg.payload ?? {};
      return await getGuards(markId, pageId);
    }
    case MSG.GUARD_ADD: {
      const { markId = '', pageId = '', entry } = msg.payload ?? {};
      return await putGuard(markId, pageId, entry);
    }
    case MSG.GUARD_CLEAR: {
      const { markId = '', pageId = '' } = msg.payload ?? {};
      await clearGuards(markId, pageId);
      return true;
    }

    case MSG.MAIN_INJECT_FALLBACK: {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['inject.js'],
      }).catch(() => undefined);
      return true;
    }

    case MSG.FETCH_PCD:
      try { return { ok: true, data: await fetchPcd(msg.payload) }; }
      catch (e: any) { return { ok: false, error: String(e?.message || e) }; }

    case MSG.FETCH_FRAME_POINTS:
      try { return { ok: true, data: await fetchFramePoints(msg.payload) }; }
      catch (e: any) { return { ok: false, error: String(e?.message || e) }; }

    case MSG.UI_ACTION:
    case MSG.TOAST:
    case MSG.RELOAD:
    case MSG.CONFIG_CHANGED:
      await forwardToTab(await resolveTabId(tabId), msg);
      return true;

    case MSG.APPLY_PATCH: {
      // 保留：若未来需要由后台统一回写答案，可在此扩展
      await forwardToTab(tabId, msg);
      return true;
    }

    default: return undefined;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const cfg: AssistConfig = await getConfig();
  await chrome.storage.local.set({
    [STORAGE_KEYS.config]: cfg,
    [STORAGE_KEYS.status]: await getStatus()
  });
});

// 供调试：service worker 就绪
self.addEventListener('install', () => (self as any).skipWaiting?.());
