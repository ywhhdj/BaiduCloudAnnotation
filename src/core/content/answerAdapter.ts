import { FIELD_ALIASES } from '../../shared/constants';
import { shortId } from '../../shared/hash';
import type { Box3D, Vec3 } from '../../shared/types';

export interface GeoMeta {
  centerKey?: string;
  centerIsArray: boolean;
  centerKeys?: string[];
  sizeKey?: string;
  sizeIsArray: boolean;
  sizeKeys?: string[];
  sizeSubKeys?: string[];
  yawKey?: string;
  yawMode: 'number' | 'y' | 'quat';
}

export interface ParseResult {
  ok: boolean;
  root: any;
  boxes: Box3D[];
  text: string;
}

const htmlDecode = (s: string) =>
  s.replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function tryParse(text: string): any | null {
  if (!text || text.length < 2) return null;
  const candidates = [
    text,
    htmlDecode(text)
  ];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch { /* next */ }
    // 请求体里带外层包装时，截取第一个平衡的 JSON 片段
    const start = c.search(/[{[]/);
    if (start >= 0) {
      const open = c[start], close = open === '{' ? '}' : ']';
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < c.length && i - start < 1_800_000; i++) {
        const ch = c[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close && --depth === 0) {
          try {
            return JSON.parse(c.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function pick(node: any, aliases: string[]): {
  key: string;
  value: any
} | null {
  for (const k of aliases) {
    if (node[k] !== undefined && node[k] !== null)
      return {
        key: k,
        value: node[k]
      };
  }
  // 大小写不敏感兜底
  const lower = new Map(Object.keys(node).map((k) => [k.toLowerCase(), k]));
  for (const a of aliases) {
    const k = lower.get(a.toLowerCase());
    if (k && node[k] !== undefined && node[k] !== null)
      return {
        key: k,
        value: node[k]
      };
  }
  return null;
}

function vec3Of(v: any): Vec3 | null {
  if (Array.isArray(v) && v.length >= 3) {
    const [a, b, c] = v.map(Number);
    return [
      Number.isFinite(a) ? a : 0,
      Number.isFinite(b) ? b : 0,
      Number.isFinite(c) ? c : 0
    ];
  }
  if (v && typeof v === 'object') {
    const x = Number(v.x ?? v.X ?? v[0] ?? v.l ?? v.L);
    const y = Number(v.y ?? v.Y ?? v[1] ?? v.w ?? v.W);
    const z = Number(v.z ?? v.Z ?? v[2] ?? v.h ?? v.H);
    if ([x, y, z].every(Number.isFinite)) return [x, y, z];
  }
  return null;
}

/** 记录对象型向量实际使用的键名（x/y/z、l/w/h、0/1/2…），回写时保持原结构 */
function vecKeys(v: any): string[] | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    return undefined;
  const find = (c: string[]) => c.find((k) => k in v) ?? c[0];
  return [
    find(['x', 'X', '0', 'l', 'L']),
    find(['y', 'Y', '1', 'w', 'W']),
    find(['z', 'Z', '2', 'h', 'H'])
  ];
}

function yawOf(v: any): { yaw: number; mode: GeoMeta['yawMode'] } {
  if (typeof v === 'number' && Number.isFinite(v))
    return {
      yaw: v,
      mode: 'number'
    };
  if (typeof v === 'string' && Number.isFinite(Number(v)))
    return {
      yaw: Number(v),
      mode: 'number'
    };
  if (v && typeof v === 'object') {
    if (v.y !== undefined && Number.isFinite(Number(v.y)) && v.w === undefined) {
      return {
        yaw: Number(v.y),
        mode: 'y'
      };
    }
    if (v.w !== undefined && v.z !== undefined) {
      return {
        yaw: 2 * Math.atan2(Number(v.z), Number(v.w)),
        mode: 'quat'
      };
    }
  }
  return {
    yaw: 0,
    mode: 'number'
  };
}

/** 平台答案里显式的人工/预标注字段 */
export function isManualBox(node: any): boolean {
  if (!node || typeof node !== 'object')
    return false;
  for (const k of FIELD_ALIASES.manual) {
    const v = node[k];
    if (v === true || v === 1 || v === 'true' || v === 'yes')
      return true;
  }
  const src = pick(node, FIELD_ALIASES.source);
  if (src && /(manual|human|user|edit|hand|人工|modify)/i.test(String(src.value)))
    return true;
  return false;
}

function extractBox(node: any, path: (string | number)[], defaultFrameId?: string): Box3D | null {
  const c = pick(node, FIELD_ALIASES.center);
  if (!c) return null;
  const center = vec3Of(c.value);
  if (!center) return null;

  const s = pick(node, FIELD_ALIASES.size);
  let size: Vec3 | null = s ? vec3Of(s.value) : null;
  let sizeKey = s?.key;
  let sizeIsArray = Array.isArray(s?.value);
  let sizeKeys: string[] | undefined;
  if (!size) {
    const l = pick(node, FIELD_ALIASES.length);
    const w = pick(node, FIELD_ALIASES.width);
    const h = pick(node, FIELD_ALIASES.height);
    if (l && w && h) {
      size = [Number(l.value), Number(w.value), Number(h.value)];
      sizeKeys = [l.key, w.key, h.key];
    }
  }
  if (!size || size.some((v) => !Number.isFinite(v) || v <= 0)) return null;

  const r = pick(node, FIELD_ALIASES.yaw);
  const { yaw, mode } = r ? yawOf(r.value) : { yaw: 0, mode: 'number' as const };

  const idPick = pick(node, FIELD_ALIASES.id);
  const trackPick = pick(node, FIELD_ALIASES.track);
  const framePick = pick(node, FIELD_ALIASES.frame);
  const typePick = pick(node, FIELD_ALIASES.type);
  const sourcePick = pick(node, FIELD_ALIASES.source);

  const geo: GeoMeta = {
    centerKey: c.key,
    centerIsArray: Array.isArray(c.value),
    centerKeys: vecKeys(c.value),
    sizeKey,
    sizeIsArray,
    sizeKeys,
    sizeSubKeys: s ? vecKeys(s.value) : undefined,
    yawKey: r?.key,
    yawMode: mode,
  };

  const id = String(idPick?.value ?? trackPick?.value ?? shortId(path.join('.')));
  return {
    id,
    frameId: String(framePick?.value ?? defaultFrameId ?? ''),
    trackId: trackPick ? String(trackPick.value) : undefined,
    typeId: typePick ? String(typePick.value) : undefined,
    center,
    size,
    yaw,
    source: sourcePick ? String(sourcePick.value) : undefined,
    attrs: { __pcGeo: geo, __pcManual: isManualBox(node) },
    raw: node,
    path,
  };
}

function looksLikeBox(node: any): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const c = pick(node, FIELD_ALIASES.center);
  if (!c || !vec3Of(c.value)) return false;
  return Boolean(pick(node, FIELD_ALIASES.size) ||
    (pick(node, FIELD_ALIASES.length) && pick(node, FIELD_ALIASES.width) && pick(node, FIELD_ALIASES.height)));
}

export function parseAnswer(text: string, defaultFrameId?: string): ParseResult {
  const root = tryParse(text);
  if (!root) return { ok: false, root: null, boxes: [], text };
  const boxes: Box3D[] = [];
  const seen = new Set<any>();
  const MAX = 4000;

  const walk = (node: any, path: (string | number)[], depth: number) => {
    if (boxes.length >= MAX || depth > 9 || node == null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], [...path, i], depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (looksLikeBox(node)) {
      const box = extractBox(node, path, defaultFrameId);
      if (box) boxes.push(box);
      return; // 框节点内部不再递归
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object')
        walk(v, [...path, k], depth + 1);
    }
  };
  walk(root, [], 0);
  return {
    ok: true,
    root,
    boxes,
    text
  };
}

function getByPath(root: any, path: (string | number)[]): any {
  let cur = root;
  for (const p of path) {
    if (cur == null) return null;
    cur = cur[p as any];
  }
  return cur;
}

function writeVec(target: any, key: string | undefined, isArray: boolean, keys: string[] | undefined, v: Vec3) {
  if (!key || !target) return;
  const cur = target[key];
  if (isArray || Array.isArray(cur)) {
    target[key] = [v[0], v[1], v[2]];
    return;
  }
  if (cur && typeof cur === 'object') {
    const ks = keys && keys.length >= 3 ? keys : ['x', 'y', 'z'];
    const hit = ks.some((k) => k in cur);
    if (hit) ks.forEach((k, i) => { if (k in cur) cur[k] = v[i]; });
    else target[key] = { x: v[0], y: v[1], z: v[2] };
  }
}

export interface BoxDelta {
  boxId: string;
  path?: (string | number)[];
  center: Vec3;
  size: Vec3;
  yaw: number;
}

/** 只改几何字段，保持平台原本的字段名与结构，属性/类别/来源一律不动 */
export function applyDeltas(parsed: ParseResult, deltas: BoxDelta[]): {
  text: string;
  applied: number
} {
  const byId = new Map(parsed.boxes.map((b) => [b.id, b]));
  const byPath = new Map(parsed.boxes.filter((b) => b.path).map((b) => [b.path!.join('.'), b]));
  let applied = 0;
  for (const d of deltas) {
    const box = d.path ? byPath.get(d.path.join('.')) : byId.get(d.boxId);
    if (!box?.path) continue;
    const node = getByPath(parsed.root, box.path);
    const geo: GeoMeta | undefined = box.attrs?.__pcGeo as any;
    if (!node || !geo) continue;
    writeVec(node, geo.centerKey, geo.centerIsArray, geo.centerKeys, d.center);
    if (geo.sizeKeys?.length === 3) {
      node[geo.sizeKeys[0]] = d.size[0];
      node[geo.sizeKeys[1]] = d.size[1];
      node[geo.sizeKeys[2]] = d.size[2];
    } else {
      writeVec(node, geo.sizeKey, geo.sizeIsArray, geo.sizeSubKeys, d.size);
    }
    if (geo.yawKey) {
      const cur = node[geo.yawKey];
      if (geo.yawMode === 'quat' && cur && typeof cur === 'object') {
        cur.z = Math.sin(d.yaw / 2);
        cur.w = Math.cos(d.yaw / 2);
      } else if (geo.yawMode === 'y' && cur && typeof cur === 'object') {
        cur.y = d.yaw;
      } else {
        node[geo.yawKey] = d.yaw;
      }
    }
    applied++;
  }
  return {
    text: JSON.stringify(parsed.root),
    applied
  };
}

// ============================================================================
// 自动框选：按平台「真实框节点」克隆出新框，避免往答案里塞平台不认识的结构
// ============================================================================

export interface NewBoxSpec {
  id: string;
  frameId?: string;
  trackId?: string;
  typeId?: string;
  center: Vec3;
  size: Vec3;
  yaw: number;
}

export interface AppendOptions {
  /** 平台真实框节点的模板（用户手动拉过框后自动学习） */
  template?: any | null;
  defaultFrameId?: string;
  /** 空答案时按这些帧建分组 */
  frameIds?: string[];
  /** 空答案容器的键名（按平台答案结构可配，绝不写 __pc* 私有字段） */
  framesKey?: string;
  frameKey?: string;
  boxKey?: string;
}

export interface AppendResult {
  text: string;
  appended: number;
  paths: Map<string, (string | number)[]>;
}

function defaultTemplate() {
  return {
    id: '',
    center: [0, 0, 0],
    size: [0, 0, 0],
    yaw: 0,
    typeId: '',
    frame_id: '',
    trackId: '',
    source: 'predict',
    manual: false,
    modified: false,
  };
}

function setAlias(node: any, aliases: string[], value: unknown, fallbackKey: string) {
  const hit = pick(node, aliases);
  if (hit) node[hit.key] = value;
  else node[fallbackKey] = value;
}

/** 用平台模板生成一个「自动预标注」框节点：保留字段结构，清掉人工标记，只写几何与身份 */
function makeNode(spec: NewBoxSpec, template: any | null): any {
  const node: any = template ? JSON.parse(JSON.stringify(template)) : defaultTemplate();

  // 自动生成的框绝不能被误判为人工修改
  for (const k of FIELD_ALIASES.manual) {
    if (k in node) node[k] = false;
  }
  setAlias(node, FIELD_ALIASES.source, 'predict', 'source');
  setAlias(node, FIELD_ALIASES.id, spec.id, 'id');
  if (spec.frameId) setAlias(node, FIELD_ALIASES.frame, spec.frameId, 'frame_id');
  if (spec.trackId) setAlias(node, FIELD_ALIASES.track, spec.trackId, 'trackId');
  if (spec.typeId) setAlias(node, FIELD_ALIASES.type, spec.typeId, 'typeId');

  const c = pick(node, FIELD_ALIASES.center);
  const s = pick(node, FIELD_ALIASES.size);
  const r = pick(node, FIELD_ALIASES.yaw);
  if (c) writeVec(node, c.key, Array.isArray(c.value), vecKeys(c.value), spec.center);
  if (s) {
    writeVec(node, s.key, Array.isArray(s.value), vecKeys(s.value), spec.size);
  } else {
    // 模板用 length/width/height 三个独立字段
    const l = pick(node, FIELD_ALIASES.length), w = pick(node, FIELD_ALIASES.width), h = pick(node, FIELD_ALIASES.height);
    if (l && w && h) {
      node[l.key] = spec.size[0];
      node[w.key] = spec.size[1];
      node[h.key] = spec.size[2];
    }
  }
  if (r) {
    const mode = yawOf(r.value).mode;
    const cur = r.value;
    if (mode === 'quat' && cur && typeof cur === 'object') {
      cur.z = Math.sin(spec.yaw / 2); cur.w = Math.cos(spec.yaw / 2);
    } else if (mode === 'y' && cur && typeof cur === 'object') {
      cur.y = spec.yaw;
    } else {
      node[r.key] = spec.yaw;
    }
  }
  return node;
}

interface BoxContainer {
  path: (string | number)[];
  arr: any[];
  frameId?: string
}

function collectContainers(root: any): BoxContainer[] {
  const out: BoxContainer[] = [];
  const aliases = FIELD_ALIASES.boxes.map((k) => k.toLowerCase());
  const walk = (node: any, path: (string | number)[], hint: string, depth: number) => {
    if (depth > 9 || node == null) return;
    if (Array.isArray(node)) {
      const isNamed = hint && aliases.includes(hint.toLowerCase());
      const looks = node.length > 0 && node.slice(0, 4).some((v) => looksLikeBox(v));
      if (isNamed || looks || node.length === 0 && isNamed) {
        const parent = path.length > 1 ? getByPath(root, path.slice(0, -1)) : null;
        const fp = parent && typeof parent === 'object' && !Array.isArray(parent) ? pick(parent, FIELD_ALIASES.frame) : null;
        out.push({
          path,
          arr: node,
          frameId: fp ? String(fp.value) : undefined
        });
      }
      for (let i = 0; i < Math.min(node.length, 40); i++)
        walk(node[i], [...path, i], '', depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    for (const k of Object.keys(node))
      walk(node[k], [...path, k], k, depth + 1);
  };
  walk(root, [], '', 0);
  // 去重（同一数组可能被多条路径命中）
  const seen = new Set<any>();
  return out.filter((c) => {
    if (seen.has(c.arr))
      return false;
    seen.add(c.arr);
    return true;
  });
}

/** 把自动框选候选按 frameId 追加进平台答案；空答案时按帧建分组 */
export function appendBoxes(
  parsed: ParseResult,
  specs: NewBoxSpec[],
  opts: AppendOptions = {}
): AppendResult {
  const paths = new Map<string, (string | number)[]>();
  if (!specs.length) return { text: JSON.stringify(parsed.root), appended: 0, paths };

  let containers = collectContainers(parsed.root);
  const solid = containers.filter((c) => c.arr.length > 0 && c.arr.slice(0, 4).some((v) => looksLikeBox(v)));
  if (solid.length) containers = solid;
  if (!containers.length) {
    // 空答案：只按平台既有字段命名习惯建最小容器，不改题目节点、不写扩展私有字段
    const frameIds = opts.frameIds?.length ? opts.frameIds : [opts.defaultFrameId || '0'];
    const rootObj = parsed.root && typeof parsed.root === 'object' && !Array.isArray(parsed.root) ? parsed.root : null;
    const framesKey = opts.framesKey || (rootObj && FIELD_ALIASES.boxes.find((k) => Array.isArray(rootObj[k]))) || 'frames';
    const frameKey = opts.frameKey || (rootObj && FIELD_ALIASES.frame.find((k) => k in rootObj)) || 'frame_id';
    const boxKey = opts.boxKey || FIELD_ALIASES.boxes.find((k) => /^(boxes|bbox|bboxes|objects|cubes|annotations)$/.test(k)) || 'boxes';
    const groups = frameIds.map((fid) => ({
      [String(frameKey)]: String(fid),
      [String(boxKey)]: [] as any[]
    }));
    if (rootObj) {
      rootObj[String(framesKey)] = groups;
    } else if (Array.isArray(parsed.root)) {
      parsed.root.push(...groups);
    } else {
      parsed.root = {
        [String(framesKey)]: groups
      };
    }
    containers = collectContainers(parsed.root);
  }

  const byFrame = new Map<string, BoxContainer>();
  for (const c of containers) if (c.frameId && !byFrame.has(c.frameId)) byFrame.set(c.frameId, c);
  const fallback = (opts.defaultFrameId && byFrame.get(opts.defaultFrameId)) || containers[0];

  for (const spec of specs) {
    const container = (spec.frameId && byFrame.get(spec.frameId)) || fallback;
    if (!container) break;
    const node = makeNode(spec, opts.template ?? null);
    const idx = container.arr.length;
    container.arr.push(node);
    paths.set(spec.id, [...container.path, idx]);
  }
  return {
    text: JSON.stringify(parsed.root),
    appended: paths.size,
    paths
  };
}

/**
 * 用户拉框差异：只返回「本次快照相对上一次新增」的框。
 * - prev 为空（首次快照）时返回空，避免把历史框当成用户刚拉的框
 * - 排除插件自己生成的自动候选框（id 前缀可配），避免自我触发贴边
 */
export function diffNewBoxes(
  prev: ParseResult | null,
  next: ParseResult,
  excludePrefixes: string[] = ['pc_auto_', 'pc_'],
): Box3D[] {
  if (!prev?.ok || !next?.ok) return [];
  const seen = new Set(prev.boxes.map((b) => b.id));
  return next.boxes.filter((b) =>
    b && b.id && !seen.has(b.id) &&
    !excludePrefixes.some((p) => p && String(b.id).startsWith(p)) &&
    Array.isArray(b.size) && b.size.every((v) => Number.isFinite(v) && v > 0)
  );
}

/** 审批拒绝：按节点路径从答案里删除（同一数组内倒序 splice） */
export function removeBoxes(parsed: ParseResult, paths: (string | number)[][]): {
  text: string;
  removed: number
} {
  const groups = new Map<any, Set<number>>();
  for (const p of paths) {
    if (!p?.length) continue;
    const arr = getByPath(parsed.root, p.slice(0, -1));
    const idx = Number(p[p.length - 1]);
    if (!Array.isArray(arr) || !Number.isInteger(idx) || idx < 0 || idx >= arr.length) continue;
    if (!groups.has(arr)) groups.set(arr, new Set());
    groups.get(arr)!.add(idx);
  }
  let removed = 0;
  for (const [arr, idxs] of groups) {
    for (const idx of Array.from(idxs).sort((a, b) => b - a)) {
      arr.splice(idx, 1);
      removed++;
    }
  }
  return {
    text: JSON.stringify(parsed.root),
    removed
  };
}

