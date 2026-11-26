import {
  DEFAULT_CONFIG, DEFAULT_DELAYS, DEFAULT_DETECTION, DEFAULT_FIT_TUNING,
  DEFAULT_PATCH_FIELDS, DEFAULT_PLATFORM_API, DEFAULT_READINESS, DEFAULT_URL_RULES,
  EMPTY_STATUS, STORAGE_KEYS,
} from './constants';
import type {
  ApprovalEntry, AssistConfig, ClassProfile, GuardEntry, RuntimeStatus, UrlRule,
} from './types';

const store = (): any => (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);

async function read<T>(key: string, fallback: T): Promise<T> {
  const s = store();
  if (!s) return fallback;
  const obj = await s.get(key);
  return (obj?.[key] ?? fallback) as T;
}

async function write(key: string, value: unknown): Promise<void> {
  const s = store();
  if (!s) return;
  await s.set({ [key]: value });
}

const cloneVec = (v: any): [number, number, number] => [
  Number(v?.[0]) || 0, Number(v?.[1]) || 0, Number(v?.[2]) || 0,
];

/** 类别表归一化：新增物体只要填 name + size 即可，其余字段自动补默认 */
export function normalizeClassProfiles(input: unknown, fallback: ClassProfile[]): ClassProfile[] {
  if (!Array.isArray(input)) return fallback.map((p) => ({
    ...p,
    size: cloneVec(p.size),
    aliases: [...(p.aliases || [])]
  }));
  const out: ClassProfile[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as any;
    const size = Array.isArray(r.size) && r.size.length >= 3 ? cloneVec(r.size) : null;
    if (!size || size.some((v) => !Number.isFinite(v) || v <= 0)) continue;
    const id = String(r.id || r.name || `profile_${out.length}`).trim();
    if (!id) continue;
    out.push({
      id,
      name: String(r.name || id),
      platformTypeId: r.platformTypeId ? String(r.platformTypeId) : undefined,
      aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [String(r.name || id)],
      size,
      tolerance: Number.isFinite(Number(r.tolerance)) ? Math.max(0.05, Number(r.tolerance)) : 0.45,
      sizeRange: r.sizeRange && typeof r.sizeRange === 'object' ? r.sizeRange : undefined,
      aspectRatio: Array.isArray(r.aspectRatio) && r.aspectRatio.length === 2 ? r.aspectRatio : undefined,
      minPoints: Number.isFinite(Number(r.minPoints)) ? Number(r.minPoints) : undefined,
      minConfidence: Number.isFinite(Number(r.minConfidence)) ? Number(r.minConfidence) : undefined,
      weight: Number.isFinite(Number(r.weight)) ? Number(r.weight) : 1,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

function normalizeRules(input: unknown): UrlRule[] {
  if (!Array.isArray(input) || !input.length) return DEFAULT_URL_RULES.map((r) => ({ ...r }));
  return input
    .filter((r: any) => r && typeof r.pattern === 'string' && r.pattern)
    .map((r: any) => ({
      id: String(r.id || r.pattern),
      pattern: String(r.pattern),
      enabled: r.enabled !== false,
      description: r.description ? String(r.description) : undefined
    }));
}

function normalizeFields(input: unknown): typeof DEFAULT_PATCH_FIELDS {
  if (!Array.isArray(input) || !input.length) return DEFAULT_PATCH_FIELDS.map((f) => ({ ...f }));
  return input
    .filter((f: any) => f && typeof f.key === 'string')
    .map((f: any) => ({
      key: String(f.key),
      value: typeof f.value === 'boolean' || typeof f.value === 'number' ? f.value : String(f.value),
      enabled: f.enabled !== false
    }));
}

/** 深合并默认配置：任何新增字段在旧存档里都不会导致 undefined */
export function normalizeConfig(saved: Partial<AssistConfig>): AssistConfig {
  const s = (saved || {}) as any;
  return {
    ...DEFAULT_CONFIG,
    ...s,
    urlRules: normalizeRules(s.urlRules),
    classProfiles: normalizeClassProfiles(s.classProfiles, DEFAULT_CONFIG.classProfiles),
    frameSources: Array.isArray(s.frameSources) && s.frameSources.length ? s.frameSources : [...DEFAULT_CONFIG.frameSources],
    readiness: {
      ...DEFAULT_READINESS,
      ...(s.readiness || {}),
      readySelectors: s.readiness?.readySelectors?.length ? s.readiness.readySelectors : [...DEFAULT_READINESS.readySelectors]
    },
    delays: {
      ...DEFAULT_DELAYS,
      ...(s.delays || {}),
      answerReadMs: Array.isArray(s.delays?.answerReadMs) ? s.delays.answerReadMs : [...DEFAULT_DELAYS.answerReadMs]
    },
    detection: {
      ...DEFAULT_DETECTION,
      ...(s.detection || {}),
      scoreWeights: {
        ...DEFAULT_DETECTION.scoreWeights,
        ...(s.detection?.scoreWeights || {})
      },
      ratioRange: Array.isArray(s.detection?.ratioRange) ? s.detection.ratioRange : [...DEFAULT_DETECTION.ratioRange] as [number, number]
    },
    fitTuning: {
      ...DEFAULT_FIT_TUNING,
      ...(s.fitTuning || {})
    },
    platformApi: {
      ...DEFAULT_PLATFORM_API,
      ...(s.platformApi || {}),
      globals: s.platformApi?.globals?.length ? s.platformApi.globals : [...DEFAULT_PLATFORM_API.globals],
      fitMethodNames: s.platformApi?.fitMethodNames?.length ? s.platformApi.fitMethodNames : [...DEFAULT_PLATFORM_API.fitMethodNames],
      fitButtonSelectors: s.platformApi?.fitButtonSelectors?.length ? s.platformApi.fitButtonSelectors : [...DEFAULT_PLATFORM_API.fitButtonSelectors],
    },
    patchableToolConfigFields: normalizeFields(s.patchableToolConfigFields),
    workerTimeouts: {
      ...DEFAULT_CONFIG.workerTimeouts,
      ...(s.workerTimeouts || {})
    },
  };
}

export async function getConfig(): Promise<AssistConfig> {
  const saved = await read<Partial<AssistConfig>>(STORAGE_KEYS.config, {});
  return normalizeConfig(saved);
}

export async function setConfig(patch: Partial<AssistConfig>): Promise<AssistConfig> {
  const next = normalizeConfig({
    ...(await getConfig()),
    ...patch
  });
  await write(STORAGE_KEYS.config, next);
  return next;
}

export async function getStatus(): Promise<RuntimeStatus> {
  return {
    ...EMPTY_STATUS,
    ...(await read<Partial<RuntimeStatus>>(STORAGE_KEYS.status, {}))
  };
}

export async function setStatus(patch: Partial<RuntimeStatus>): Promise<RuntimeStatus> {
  const next = {
    ...(await getStatus()),
    ...patch,
    updatedAt: Date.now()
  };
  await write(STORAGE_KEYS.status, next);
  return next;
}

/** 守护表 / 审批表按 任务+页 分片，避免不同题目互相污染 */
export async function guardKeyOf(markId: string, pageId: string): Promise<string> {
  return `${STORAGE_KEYS.guards}:${markId || 'unknown'}:${pageId || '0'}`;
}

export async function approvalKeyOf(markId: string, pageId: string): Promise<string> {
  return `${STORAGE_KEYS.approvals}:${markId || 'unknown'}:${pageId || '0'}`;
}

export async function getGuards(markId: string, pageId: string): Promise<GuardEntry[]> {
  return await read<GuardEntry[]>(await guardKeyOf(markId, pageId), []);
}

export async function putGuard(markId: string, pageId: string, entry: GuardEntry): Promise<GuardEntry[]> {
  const key = await guardKeyOf(markId, pageId);
  const list = await read<GuardEntry[]>(key, []);
  const idx = list.findIndex((g) => g.boxId === entry.boxId && g.frameId === entry.frameId);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  if (list.length > 600) list.splice(0, list.length - 600);
  await write(key, list);
  return list;
}

export async function putGuards(markId: string, pageId: string, entries: GuardEntry[]): Promise<GuardEntry[]> {
  const key = await guardKeyOf(markId, pageId);
  const list = await read<GuardEntry[]>(key, []);
  const map = new Map(list.map((g) => [`${g.boxId}|${g.frameId ?? ''}`, g]));
  for (const e of entries) map.set(`${e.boxId}|${e.frameId ?? ''}`, e);
  const merged = Array.from(map.values()).slice(-600);
  await write(key, merged);
  return merged;
}

export async function clearGuards(markId: string, pageId: string): Promise<void> {
  await write(await guardKeyOf(markId, pageId), []);
}

// ---------------------------------------------------------------- 审批表

export async function getApprovals(markId: string, pageId: string): Promise<ApprovalEntry[]> {
  return await read<ApprovalEntry[]>(await approvalKeyOf(markId, pageId), []);
}

export async function putApprovals(markId: string, pageId: string, entries: ApprovalEntry[]): Promise<ApprovalEntry[]> {
  const key = await approvalKeyOf(markId, pageId);
  const list = await read<ApprovalEntry[]>(key, []);
  const map = new Map(list.map((a) => [a.boxId, a]));
  for (const e of entries) map.set(e.boxId, e);
  const merged = Array.from(map.values()).slice(-900);
  await write(key, merged);
  return merged;
}

export async function clearApprovals(markId: string, pageId: string): Promise<void> {
  await write(await approvalKeyOf(markId, pageId), []);
}

// ---------------------------------------------------------------- 答案框模板

/** 记录平台「一个真实框节点」长什么样，自动出框时按它克隆，避免结构不被平台识别 */
export async function getBoxTemplate(markId: string, pageId: string): Promise<any | null> {
  return await read<any | null>(`${STORAGE_KEYS.boxTemplate}:${markId || 'unknown'}:${pageId || '0'}`, null);
}

export async function setBoxTemplate(markId: string, pageId: string, node: any): Promise<void> {
  if (!node || typeof node !== 'object') return;
  await write(`${STORAGE_KEYS.boxTemplate}:${markId || 'unknown'}:${pageId || '0'}`, JSON.parse(JSON.stringify(node)));
}

// ---------------------------------------------------------------- 自动检测去重

export async function wasAutoDetected(markId: string, pageId: string, ttlHours = 12): Promise<boolean> {
  const done = await read<Record<string, number>>(STORAGE_KEYS.autoDetectDone, {});
  const v = done[`${markId}:${pageId}`];
  const ttl = Math.max(0, Number(ttlHours) || 0) * 3600 * 1000;
  return Boolean(v && Date.now() - v < ttl);
}

export async function markAutoDetected(markId: string, pageId: string): Promise<void> {
  const done = await read<Record<string, number>>(STORAGE_KEYS.autoDetectDone, {});
  done[`${markId}:${pageId}`] = Date.now();
  await write(STORAGE_KEYS.autoDetectDone, done);
}

export async function clearAutoDetected(markId: string, pageId: string): Promise<void> {
  const done = await read<Record<string, number>>(STORAGE_KEYS.autoDetectDone, {});
  delete done[`${markId}:${pageId}`];
  await write(STORAGE_KEYS.autoDetectDone, done);
}

/** 配置/类别变更时让「已自动检测」失效，下一次可直接重跑 */
export async function invalidateAutoDetected(markId: string, pageId: string): Promise<void> {
  await clearAutoDetected(markId, pageId);
}
