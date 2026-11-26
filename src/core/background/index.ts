import { unzipSync } from 'fflate';
import { DEFAULT_URL_RULES, MSG, STORAGE_KEYS } from '../../shared/constants';
import { isAssistUrl } from '../../shared/urlRules';
import { onMessage } from '../../shared/messages';
import { clearGuards, getConfig, getGuards, getStatus, putGuard, putGuards, setConfig, setStatus } from '../../shared/storage';
import type { AssistConfig, Box3D, Envelope } from '../../shared/types';

/** 帧点云 LRU 缓存：容量来自 AssistConfig.frameCacheLimit，不再写死 6 帧 */
const frameCache = new Map<string, Float32Array>();
let cacheLimit = 8;

function cacheSet(key: string, data: Float32Array) {
  if (frameCache.has(key)) frameCache.delete(key);
  frameCache.set(key, data);
  while (frameCache.size > cacheLimit)
    frameCache.delete(frameCache.keys().next().value as string);
}

/** 按任务实际页面 origin / 可配 base 推导绝对地址；不再写死 https://test.baidu.com/ */
function absoluteUrl(u: string, baseUrl?: string): string {
  if (!u) return '';
  const base = baseUrl && /^https?:\/\//i.test(baseUrl) ? baseUrl : 'https://test.baidu.com/';
  if (u.startsWith('//')) return new URL(u, base).toString();
  if (/^https?:\/\//i.test(u)) return u;
  return new URL(u, base).toString();
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

async function loadFramePoints(url: string, baseUrl?: string): Promise<Float32Array> {
  const key = url.split('?')[0];
  const hit = frameCache.get(key);
  if (hit) return hit;
  const cfg = await getConfig().catch(() => null as AssistConfig | null);
  if (cfg?.frameCacheLimit) cacheLimit = Math.max(2, Math.min(64, Number(cfg.frameCacheLimit) || 8));
  const resp = await fetch(absoluteUrl(url, baseUrl), { credentials: 'omit' });
  if (!resp.ok) throw new Error(`点云下载失败 ${resp.status}`);
  const buf = await resp.arrayBuffer();
  let points: Float32Array | null = null;
  try {
    const files = unzipSync(new Uint8Array(buf));
    const names = Object.keys(files).filter((n) => /\.(bin|pcd)$/i.test(n));
    names.sort((a, b) => (b.includes('velodyne') ? 1 : 0) - (a.includes('velodyne') ? 1 : 0) || files[b].length - files[a].length);
    for (const n of names) {
      points = parsePointBuffer(n, files[n]);
      if (points && points.length) break;
    }
  } catch {
    // 不是 zip 时可能是裸 .bin / .pcd
    points = parsePointBuffer('frame.bin', new Uint8Array(buf));
    if (!points?.length) points = parsePointBuffer('frame.pcd', new Uint8Array(buf));
  }
  if (!points || !points.length)
    throw new Error('zip 中未找到 .bin / .pcd 点云');
  cacheSet(key, points);
  return points;
}

/**
 * 全帧点云只建一次体素空间索引，多框共享：O(N) 建索引 + O(ΣROI) 查询。
 * 旧实现对每个框全量扫一遍帧点云，40 帧 × 60 框时开销翻倍。
 */
class VoxelIndex {
  private cells = new Map<string, number[]>();
  private n: number;

  constructor(private all: Float32Array, private voxel: number) {
    this.n = Math.floor(all.length / 3);
    this.voxel = Math.max(0.1, Math.min(4, Number(voxel) || 0.5));
    for (let i = 0; i < this.n; i++) {
      const x = all[i * 3], y = all[i * 3 + 1], z = all[i * 3 + 2];
      if (![x, y, z].every(Number.isFinite)) continue;
      const k = this.key(Math.floor(x / this.voxel), Math.floor(y / this.voxel), Math.floor(z / this.voxel));
      const arr = this.cells.get(k);
      if (arr) arr.push(i);
      else this.cells.set(k, [i]);
    }
  }

  private key(ix: number, iy: number, iz: number): string { return `${ix},${iy},${iz}`; }

  query(box: Box3D, margin: number, maxPoints: number): Float32Array {
    const [cx, cy, cz] = box.center;
    const [l, w, h] = box.size;
    const c = Math.abs(Math.cos(box.yaw)), s = Math.abs(Math.sin(box.yaw));
    const hx = (c * l + s * w) / 2 + margin;
    const hy = (s * l + c * w) / 2 + margin;
    const hz = h / 2 + margin;
    const x0 = Math.floor((cx - hx) / this.voxel), x1 = Math.floor((cx + hx) / this.voxel);
    const y0 = Math.floor((cy - hy) / this.voxel), y1 = Math.floor((cy + hy) / this.voxel);
    const z0 = Math.floor((cz - hz) / this.voxel), z1 = Math.floor((cz + hz) / this.voxel);
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);

    let candidates: number[];
    if (cells > 20000 || !Number.isFinite(cells) || cells <= 0) {
      candidates = Array.from({
        length: this.n
      }, (_, i) => i);
    } else {
      candidates = [];
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(this.key(ix, iy, iz));
        if (arr) for (const i of arr)
          candidates.push(i);
      }
    }

    const cos = Math.cos(box.yaw), sin = Math.sin(box.yaw);
    let picked: number[] = [];
    // 兼容「center.z 为底面中心」的模板：两种取点，取点多者
    for (const zMode of [0, 1] as const) {
      const zc = zMode ? cz + h / 2 : cz;
      const local: number[] = [];
      for (const i of candidates) {
        const x = this.all[i * 3], y = this.all[i * 3 + 1], z = this.all[i * 3 + 2];
        const dx = x - cx, dy = y - cy;
        const lx = cos * dx + sin * dy;
        if (lx < -hx || lx > hx) continue;
        const ly = -sin * dx + cos * dy;
        if (ly < -hy || ly > hy) continue;
        const lz = z - zc;
        if (lz < -hz || lz > hz) continue;
        local.push(x, y, z);
      }
      if (local.length > picked.length)
        picked = local;
    }
    const n = picked.length / 3;
    if (!n)
      return new Float32Array(0);
    const step = Math.max(1, Math.ceil(n / Math.max(1, maxPoints)));
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
}

async function fetchPcd(payload: any): Promise<any> {
  const {
    zipUrl,
    boxes,
    maxPoints = 12000,
    margin = 0.8,
    voxel = 0.5,
    baseUrl
  } = payload || {};
  if (!zipUrl) throw new Error('缺少 zipUrl');
  if (/framecamera|\.(jpg|jpeg|png|webp)$/i.test(String(zipUrl)))
    throw new Error('该地址是相机图片，不是点云');
  const all = await loadFramePoints(zipUrl, baseUrl);
  const index = new VoxelIndex(all, voxel);
  const groups = (boxes as Box3D[]).map((b) => {
    const pts = index.query(b, margin, maxPoints);
    return {
      boxId: b.id,
      buffer: pts.buffer,
      count: pts.length / 3
    };
  });
  return {
    groups,
    totalPoints: all.length / 3
  };
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
  const { zipUrl, maxPoints = 60000, baseUrl } = payload || {};
  if (!zipUrl) throw new Error('缺少 zipUrl');
  if (/framecamera|\.(jpg|jpeg|png|webp)$/i.test(String(zipUrl)))
    throw new Error('该地址是相机图片，不是点云');
  const all = await loadFramePoints(zipUrl, baseUrl);
  const thin = thinAll(all, maxPoints);
  return {
    buffer: thin.buffer,
    count: thin.length / 3,
    totalPoints: all.length / 3
  };
}

async function forwardToTab(tabId: number | undefined, msg: Envelope) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch { /* tab 已关闭 */ }
}

async function resolveTabId(tabId?: number, rules?: unknown): Promise<number | undefined> {
  if (tabId) return tabId;
  const list = Array.isArray(rules) && rules.length ? rules as any[] : DEFAULT_URL_RULES;
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  }).catch(() => []);
  return tabs?.find((t: any) => isAssistUrl(String(t?.url || ''), list as any))?.id ?? tabs?.[0]?.id;
}

onMessage(async (msg: Envelope, sender: any) => {
  const tabId = sender?.tab?.id ?? msg.tabId;
  switch (msg.type) {
    case MSG.PING: return { ok: true, at: Date.now() };

    case MSG.CONFIG_GET: return await getConfig();
    case MSG.CONFIG_SET: {
      const cfg = await setConfig(msg.payload ?? {});
      cacheLimit = Math.max(2, Math.min(64, Number(cfg.frameCacheLimit) || 8));
      await forwardToTab(tabId, {
        type: MSG.CONFIG_CHANGED,
        payload: cfg
      });
      return cfg;
    }
    case MSG.STATUS_GET:
      return await getStatus();
    case MSG.STATUS_SET:
      return await setStatus(msg.payload ?? {});

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
        files: ['js/inject.js'],
      }).catch(() => undefined);
      return true;
    }

    case MSG.FETCH_PCD:
      try {
        return {
          ok: true,
          data: await fetchPcd(msg.payload)
        };
      }
      catch (e: any) {
        return {
          ok: false,
          error: String(e?.message || e)
        };
      }

    case MSG.FETCH_FRAME_POINTS:
      try {
        return {
          ok: true,
          data: await fetchFramePoints(msg.payload)
        };
      }
      catch (e: any) {
        return {
          ok: false,
          error: String(e?.message || e)
        };
      }

    case MSG.UI_ACTION:
    case MSG.TOAST:
    case MSG.RELOAD:
    case MSG.CONFIG_CHANGED:
      await forwardToTab(await resolveTabId(tabId, msg.payload?.urlRules), msg);
      return true;

    case MSG.APPLY_PATCH: {
      await forwardToTab(tabId, msg);
      return true;
    }

    default: return undefined;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const cfg: AssistConfig = await getConfig();
  cacheLimit = Math.max(2, Math.min(64, Number(cfg.frameCacheLimit) || 8));
  await chrome.storage.local.set({
    [STORAGE_KEYS.config]: cfg,
    [STORAGE_KEYS.status]: await getStatus(),
  });
});

// 供调试：service worker 就绪
self.addEventListener('install', () => (self as any).skipWaiting?.());
